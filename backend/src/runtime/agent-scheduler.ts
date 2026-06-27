import { KeyPool } from "./agent-keys";
import { llmFailureCount, LLM_CIRCUIT_BREAKER_THRESHOLD, LLM_CIRCUIT_BREAKER_COOLDOWN } from "./agent-types";
import { MAX_CONCURRENT_LLM, MIN_LLM_INTERVAL_MS, MAX_LLM_RETRIES, LLM_RETRY_BASE_MS, LLM_REQUEST_TIMEOUT_MS } from "./agent-constants";

export const llmScheduler = {
  active: 0,
  queue: [] as Array<() => void>,
  lastCallTime: 0,

  async acquire(): Promise<void> {
    // Wait for the concurrency slot (FIFO queue)
    if (this.active >= MAX_CONCURRENT_LLM || this.queue.length > 0) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }
    this.active++;

    // Enforce minimum inter-request delay
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    if (elapsed < MIN_LLM_INTERVAL_MS) {
      const wait = MIN_LLM_INTERVAL_MS - elapsed;
      await new Promise((r) => setTimeout(r, wait));
    }
    this.lastCallTime = Date.now();
  },

  release(): void {
    this.active--;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      // Small delay before waking the next waiter to avoid back-to-back releases
      setImmediate(next);
    }
  },
};

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string = "LLM",
  options?: { backupModel?: string; modelSwapFn?: (body: string, model: string) => string; keyPool?: KeyPool }
): Promise<Response> {
  let lastResponse: Response | null = null;
  let switchedModel = false;

  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    // On 429 retry (not first attempt), try next available key before waiting
    if (attempt > 0 && options?.keyPool) {
      const nextKey = options.keyPool.getNext();
      if (nextKey) {
        // Replace API key in request headers
        if (init.headers && typeof init.headers === "object") {
          const headers = init.headers as Record<string, string>;
          if (headers["Authorization"]) {
            headers["Authorization"] = `Bearer ${nextKey}`;
          }
          if (headers["x-api-key"]) {
            headers["x-api-key"] = nextKey;
          }
        }
        console.warn(`[fetchWithRetry] ${label} rotating to next key in pool (${options.keyPool.size()} keys)`);
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);
    const resp = await fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
    if (resp.status !== 429) return resp;

    lastResponse = resp;
    const retryAfter = resp.headers.get("retry-after");
    const baseDelay = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : LLM_RETRY_BASE_MS * Math.pow(2, attempt);
    // Add 0-1500ms random jitter to avoid all agents retrying simultaneously
    const jitter = Math.floor(Math.random() * 1500);
    const delayMs = baseDelay + jitter;

    // On first 429, switch to backup model if available
    if (!switchedModel && options?.backupModel && options?.modelSwapFn && init.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        if (body.model && body.model !== options.backupModel) {
          const oldModel = body.model;
          body.model = options.backupModel;
          init.body = JSON.stringify(body);
          switchedModel = true;
          console.warn(`[fetchWithRetry] ${label} got 429, switching from ${oldModel} to ${options.backupModel}`);
        }
      } catch {
        // body parse failed, continue with original retry logic
      }
    }

    // Mark current key as rate-limited if we have a key pool
    if (options?.keyPool && init.headers && typeof init.headers === "object") {
      const headers = init.headers as Record<string, string>;
      const currentKey = headers["x-api-key"] ?? headers["Authorization"]?.replace("Bearer ", "") ?? "";
      if (currentKey) {
        options.keyPool.mark429(currentKey, delayMs);
      }
    }

    console.warn(`[fetchWithRetry] ${label} got 429, attempt ${attempt + 1}/${MAX_LLM_RETRIES}, retrying in ${delayMs}ms`);
    await new Promise(r => setTimeout(r, delayMs));
  }

  console.error(`[fetchWithRetry] ${label} exhausted ${MAX_LLM_RETRIES + 1} attempts, all 429`);
  // Return the last 429 response to let the caller handle the error
  return lastResponse!;
}

/** Wrapper: acquires the global rate-limited scheduler slot before calling fetchWithRetry,
 *  then releases. Ensures LLM calls are paced (~50 QPM max) to avoid 429 throttling. */
export async function llmFetch(
  url: string,
  init: RequestInit,
  label: string = "LLM",
  options?: { backupModel?: string; modelSwapFn?: (body: string, model: string) => string; keyPool?: KeyPool }
): Promise<Response> {
  await llmScheduler.acquire();
  try {
    return await fetchWithRetry(url, init, label, options);
  } finally {
    llmScheduler.release();
  }
}

export function isLlmCircuitOpen(): boolean {
  const state = llmFailureCount.get("global");
  if (!state || state.count < LLM_CIRCUIT_BREAKER_THRESHOLD) return false;
  if (Date.now() - state.lastFailure < LLM_CIRCUIT_BREAKER_COOLDOWN) {
    return true;  // still in cooldown
  }
  // cooldown expired — reset
  llmFailureCount.delete("global");
  return false;
}

export function recordLlmFailure() {
  const state = llmFailureCount.get("global") ?? { count: 0, lastFailure: 0 };
  state.count++;
  state.lastFailure = Date.now();
  llmFailureCount.set("global", state);
}

export function recordLlmSuccess() {
  llmFailureCount.delete("global");

}

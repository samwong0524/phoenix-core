import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Use fake timers for rate-limit / retry tests
vi.useFakeTimers();

// vi.hoisted() lets us define values that are available inside hoisted vi.mock factories
const { llFailureCount } = vi.hoisted(() => {
  return { llFailureCount: new Map<string, { count: number; lastFailure: number }>() };
});

vi.mock("@/runtime/agent-types", () => ({
  llmFailureCount: llFailureCount,
  LLM_CIRCUIT_BREAKER_THRESHOLD: 3,
  LLM_CIRCUIT_BREAKER_COOLDOWN: 5 * 60 * 1000,
}));

vi.mock("@/runtime/agent-constants", () => ({
  MAX_CONCURRENT_LLM: 2,
  MIN_LLM_INTERVAL_MS: 100,
  MAX_LLM_RETRIES: 2,
  LLM_RETRY_BASE_MS: 50,
  LLM_REQUEST_TIMEOUT_MS: 5000,
}));

vi.mock("@/runtime/agent-keys", () => ({
  KeyPool: class {
    private keys: string[];
    constructor(keys: string[]) { this.keys = keys; }
    getNext() { return this.keys[0] ?? null; }
    mark429() {}
    size() { return this.keys.length; }
    hasKeys() { return this.keys.length > 0; }
    hasAvailable() { return this.keys.length > 0; }
  },
}));

import {
  llmScheduler,
  fetchWithRetry,
  llmFetch,
  isLlmCircuitOpen,
  recordLlmFailure,
  recordLlmSuccess,
} from "@/runtime/agent-scheduler";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResponse(status: number, headers: Record<string, string> = {}): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
  } as Response;
}

// ─── llmScheduler ────────────────────────────────────────────────────────────

describe("llmScheduler", () => {
  beforeEach(() => {
    llmScheduler.active = 0;
    llmScheduler.queue = [];
    llmScheduler.lastCallTime = 0;
  });

  it("acquire increments active count", async () => {
    await llmScheduler.acquire();
    expect(llmScheduler.active).toBe(1);
    llmScheduler.release();
  });

  it("release decrements active count", async () => {
    await llmScheduler.acquire();
    expect(llmScheduler.active).toBe(1);
    llmScheduler.release();
    expect(llmScheduler.active).toBe(0);
  });

  it("queues when MAX_CONCURRENT_LLM is reached", async () => {
    // Directly test the queue mechanism by manipulating state
    // MAX_CONCURRENT_LLM = 2
    llmScheduler.active = 2;
    llmScheduler.lastCallTime = -1_000_000; // far past, so interval check passes

    let resolved = false;
    const third = llmScheduler.acquire().then(() => { resolved = true; });

    // Give microtasks a chance to run
    await Promise.resolve();
    await Promise.resolve();
    // The third acquire should be queued since active >= MAX
    expect(llmScheduler.queue.length).toBe(1);
    expect(resolved).toBe(false);

    // Release one slot → setImmediate wakes the queued resolver
    llmScheduler.release();
    expect(llmScheduler.active).toBe(1);

    // Advance past setImmediate + interval timer
    await vi.advanceTimersByTimeAsync(500);
    expect(resolved).toBe(true);
    expect(llmScheduler.active).toBe(2);

    llmScheduler.release();
    llmScheduler.release();
  });

  it("enforces MIN_LLM_INTERVAL_MS between calls", async () => {
    llmScheduler.lastCallTime = Date.now();
    let acquired = false;
    const p = llmScheduler.acquire().then(() => { acquired = true; });

    // Should not resolve immediately (within interval)
    await vi.advanceTimersByTimeAsync(50);
    expect(acquired).toBe(false);

    // After interval passes, should resolve
    await vi.advanceTimersByTimeAsync(200);
    expect(acquired).toBe(true);
    llmScheduler.release();
  });
});

// ─── fetchWithRetry ──────────────────────────────────────────────────────────

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns response immediately on non-429 status", async () => {
    const resp = makeResponse(200);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(resp));

    const result = await fetchWithRetry("https://api.example.com", {});
    expect(result.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and returns non-429 response", async () => {
    const retry429 = makeResponse(429, { "retry-after": "0" });
    const ok200 = makeResponse(200);

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? retry429 : ok200;
    }));

    const promise = fetchWithRetry("https://api.example.com", {});
    // Advance past retry delay
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    expect(result.status).toBe(200);
    expect(callCount).toBe(2);
  });

  it("returns last 429 after exhausting all retries", async () => {
    const retry429 = makeResponse(429, { "retry-after": "0" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(retry429));

    // MAX_LLM_RETRIES = 2 → 3 total attempts (0, 1, 2)
    const promise = fetchWithRetry("https://api.example.com", {});
    // Advance through all retry delays
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(5000);
    }
    const result = await promise;
    expect(result.status).toBe(429);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("switches to backup model on first 429", async () => {
    const retry429 = makeResponse(429, { "retry-after": "0" });
    const ok200 = makeResponse(200);

    let callCount = 0;
    let lastBody = "";
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      callCount++;
      lastBody = init.body as string;
      return callCount === 1 ? retry429 : ok200;
    }));

    const init: RequestInit = {
      method: "POST",
      body: JSON.stringify({ model: "primary-model", messages: [] }),
    };

    const promise = fetchWithRetry("https://api.example.com", init, "LLM", {
      backupModel: "backup-model",
      modelSwapFn: (body: string, model: string) => {
        const parsed = JSON.parse(body);
        parsed.model = model;
        return JSON.stringify(parsed);
      },
    });

    await vi.advanceTimersByTimeAsync(2000);
    await promise;

    // After the first 429, the body should have been swapped to backup-model
    const parsed = JSON.parse(lastBody);
    expect(parsed.model).toBe("backup-model");
  });

  it("uses exponential backoff when no retry-after header", async () => {
    const retry429 = makeResponse(429); // no retry-after header
    const ok200 = makeResponse(200);

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      return callCount <= 2 ? retry429 : ok200;
    }));

    const promise = fetchWithRetry("https://api.example.com", {});
    // LLM_RETRY_BASE_MS=50, attempt 0: 50*2^0=50 + jitter, attempt 1: 50*2^1=100 + jitter
    // Advance enough for both retries
    await vi.advanceTimersByTimeAsync(10000);
    const result = await promise;
    expect(result.status).toBe(200);
    expect(callCount).toBe(3);
  });
});

// ─── llmFetch ────────────────────────────────────────────────────────────────

describe("llmFetch", () => {
  beforeEach(() => {
    llmScheduler.active = 0;
    llmScheduler.queue = [];
    llmScheduler.lastCallTime = 0;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeResponse(200)));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("acquires and releases scheduler slot", async () => {
    const promise = llmFetch("https://api.example.com", {});
    // Let scheduler interval pass
    await vi.advanceTimersByTimeAsync(500);
    const result = await promise;
    expect(result.status).toBe(200);
    // After completion, active should be back to 0
    expect(llmScheduler.active).toBe(0);
  });

  it("releases scheduler slot even on fetch error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));

    const promise = llmFetch("https://api.example.com", {}).catch(() => makeResponse(500));
    await vi.advanceTimersByTimeAsync(500);
    await promise;
    expect(llmScheduler.active).toBe(0);
  });
});

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

describe("circuit breaker", () => {
  beforeEach(() => {
    llFailureCount.clear();
    vi.useRealTimers(); // circuit breaker uses Date.now()
  });

  afterEach(() => {
    vi.useFakeTimers();
  });

  it("isLlmCircuitOpen returns false when no failures", () => {
    expect(isLlmCircuitOpen()).toBe(false);
  });

  it("isLlmCircuitOpen returns false when count is below threshold", () => {
    recordLlmFailure();
    recordLlmFailure();
    // threshold = 3
    expect(isLlmCircuitOpen()).toBe(false);
  });

  it("isLlmCircuitOpen returns true when threshold reached and within cooldown", () => {
    recordLlmFailure();
    recordLlmFailure();
    recordLlmFailure();
    // count = 3 = threshold, lastFailure is now → within cooldown
    expect(isLlmCircuitOpen()).toBe(true);
  });

  it("isLlmCircuitOpen returns false after cooldown expires (resets state)", () => {
    recordLlmFailure();
    recordLlmFailure();
    recordLlmFailure();
    expect(isLlmCircuitOpen()).toBe(true);

    // Manually expire the cooldown by setting lastFailure to the past
    const state = llFailureCount.get("global")!;
    state.lastFailure = Date.now() - (6 * 60 * 1000); // 6 min ago, cooldown is 5 min
    llFailureCount.set("global", state);

    expect(isLlmCircuitOpen()).toBe(false);
    // State should be reset
    expect(llFailureCount.has("global")).toBe(false);
  });

  it("recordLlmSuccess resets failure count", () => {
    recordLlmFailure();
    recordLlmFailure();
    expect(llFailureCount.get("global")!.count).toBe(2);

    recordLlmSuccess();
    expect(llFailureCount.has("global")).toBe(false);
  });

  it("recordLlmFailure increments count correctly", () => {
    recordLlmFailure();
    expect(llFailureCount.get("global")!.count).toBe(1);
    recordLlmFailure();
    expect(llFailureCount.get("global")!.count).toBe(2);
    recordLlmFailure();
    expect(llFailureCount.get("global")!.count).toBe(3);
  });

  it("recordLlmFailure updates lastFailure timestamp", () => {
    recordLlmFailure();
    const first = llFailureCount.get("global")!.lastFailure;

    // Small delay to ensure different timestamp
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }

    recordLlmFailure();
    const second = llFailureCount.get("global")!.lastFailure;
    expect(second).toBeGreaterThanOrEqual(first);
  });
});

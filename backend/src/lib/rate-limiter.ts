/**
 * Phoenix-Core Rate Limiter — In-memory per-user + per-workspace rate limiting
 *
 * Design decisions:
 * - No Redis dependency — single-instance in-memory store
 * - Per-user limits (api, llm) and per-workspace limits (workspace)
 * - Returns remaining count and reset timestamp for client headers
 * - Periodic cleanup of expired entries to prevent memory leaks
 * - DEV_MODE: rate limiting is still active but uses a shared "dev" key
 */

// ─── Types ────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

// ─── Store ────────────────────────────────────────────

const store = new Map<string, RateLimitEntry>();

// ─── Default Limits ───────────────────────────────────

export const RATE_LIMITS = {
  /** 100 requests/min per user — general API calls */
  api: { maxRequests: 100, windowMs: 60_000 } as RateLimitConfig,
  /** 20 LLM calls/min per workspace — expensive operations */
  llm: { maxRequests: 20, windowMs: 60_000 } as RateLimitConfig,
  /** 200 requests/min per workspace — workspace-wide cap */
  workspace: { maxRequests: 200, windowMs: 60_000 } as RateLimitConfig,
};

// ─── Core ─────────────────────────────────────────────

/**
 * Check if a request is allowed under the given key and config.
 * Returns { allowed, remaining, resetAt } for response headers.
 */
export function checkRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  // No entry or window expired — start fresh
  if (!entry || now >= entry.resetAt) {
    const resetAt = now + config.windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: config.maxRequests - 1, resetAt };
  }

  // Window still active but quota exhausted
  if (entry.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  // Increment within window
  entry.count++;
  return { allowed: true, remaining: config.maxRequests - entry.count, resetAt: entry.resetAt };
}

// ─── Helpers ──────────────────────────────────────────

/**
 * Add rate limit headers to a response.
 * Call this before returning from API handlers.
 */
export function withRateLimitHeaders(
  response: Response,
  limit: RateLimitResult
): Response {
  response.headers.set("X-RateLimit-Remaining", String(limit.remaining));
  response.headers.set("X-RateLimit-Reset", String(limit.resetAt));
  return response;
}

/**
 * Build a 429 Too Many Requests response with Retry-After header.
 */
export function rateLimitExceededResponse(limit: RateLimitResult): Response {
  const retryAfterSec = Math.ceil((limit.resetAt - Date.now()) / 1000);
  return Response.json(
    { error: "Rate limit exceeded", retryAfter: retryAfterSec },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(limit.resetAt),
      },
    }
  );
}

// ─── Cleanup ──────────────────────────────────────────

// Periodically remove expired entries to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) store.delete(key);
  }
}, 60_000).unref();

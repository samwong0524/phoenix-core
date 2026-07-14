/**
 * Standardized API response helpers (Contract 3).
 *
 * Response shapes:
 * - Single resource: direct object
 * - List (no pagination): direct array
 * - List (paginated): { items, total, offset, limit }
 * - Write success: full resource object
 * - Error: { error: { code, message } }
 * - Timestamps: ISO-8601
 */

import { NextResponse } from "next/server";

// ── Error response ──────────────────────────────────────────────

type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "DB_ERROR"
  | "LLM_CONNECTION_FAILED"
  | "WORKSPACE_NOT_FOUND"
  | "AGENT_NOT_FOUND"
  | "WORKFLOW_NOT_FOUND";

/**
 * Build a standardized error response.
 *
 * @example
 *   return apiError("NOT_FOUND", "Agent abc123 does not exist", 404);
 *   // → { error: { code: "NOT_FOUND", message: "Agent abc123 does not exist" } }
 */
export function apiError(
  code: ErrorCode,
  message: string,
  status: number = 500,
): NextResponse {
  return NextResponse.json(
    { error: { code, message } },
    { status },
  );
}

/**
 * Convert an unknown error into a safe API error response.
 * Recognizes AuthError / RbacError instances when available.
 */
export function apiErrorFromCatch(e: unknown, fallbackCode: ErrorCode = "INTERNAL_ERROR"): NextResponse {
  // AuthError
  if (e instanceof Error && "status" in e && typeof (e as any).status === "number") {
    const status = (e as any).status as number;
    const code: ErrorCode =
      status === 401 ? "UNAUTHORIZED" :
      status === 403 ? "FORBIDDEN" :
      fallbackCode;
    return apiError(code, e.message, status);
  }

  // Generic error
  const message = e instanceof Error ? e.message : String(e);
  return apiError(fallbackCode, message, 500);
}

// ── Success responses ───────────────────────────────────────────

/**
 * Return a single resource (no wrapper).
 */
export function apiOk<T>(data: T, status: number = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/**
 * Return a created resource (201).
 */
export function apiCreated<T>(data: T): NextResponse {
  return NextResponse.json(data, { status: 201 });
}

/**
 * Return a paginated list.
 *
 * @example
 *   return apiList(workflows, { total: 42, offset: 0, limit: 20 });
 *   // → { items: [...], total: 42, offset: 0, limit: 20 }
 */
export function apiList<T>(
  items: T[],
  pagination: { total: number; offset: number; limit: number },
): NextResponse {
  return NextResponse.json({
    items,
    total: pagination.total,
    offset: pagination.offset,
    limit: pagination.limit,
  });
}

// ── Timestamp helper ────────────────────────────────────────────

/**
 * Returns the current time as an ISO-8601 string.
 * Use this everywhere a timestamp is needed in API responses.
 */
export function nowISO(): string {
  return new Date().toISOString();
}

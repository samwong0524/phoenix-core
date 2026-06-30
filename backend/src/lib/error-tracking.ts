/**
 * Phoenix-Core Error Tracking
 *
 * Lightweight error tracking with optional Sentry integration.
 * When SENTRY_DSN is set, errors are reported to Sentry.
 * Otherwise, errors are logged via pino structured logger.
 *
 * This module provides:
 * - captureException(): Report an error
 * - captureMessage(): Report an informational message
 * - withErrorTracking(): Higher-order function to wrap API handlers
 */

import { logger } from "./logger";

// ─── Sentry lazy loader ──────────────────────────────

let sentryInitialized = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SentryLike = any;

async function loadSentry(): Promise<SentryLike | null> {
  if (!process.env.SENTRY_DSN) return null;

  if (!sentryInitialized) {
    try {
      const Sentry = await import(/* webpackIgnore: true */ "@sentry/nextjs" as string);
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV ?? "development",
        tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
        enabled: process.env.NODE_ENV === "production",
      });
      sentryInitialized = true;
      logger.info("Sentry initialized");
    } catch (e) {
      logger.debug({ err: e }, "Sentry SDK not available, using logger only");
      return null;
    }
  }

  try {
    return await import(/* webpackIgnore: true */ "@sentry/nextjs" as string);
  } catch {
    return null;
  }
}

// ─── Public API ──────────────────────────────────────

export async function captureException(
  error: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  const err = error instanceof Error ? error : new Error(String(error));

  // Always log locally
  logger.error({ err, ...context }, "Captured exception");

  // Report to Sentry if available
  const Sentry = await loadSentry();
  if (Sentry) {
    try {
      if (context) Sentry.setExtras(context);
      Sentry.captureException(err);
    } catch {
      // Sentry call failed — already logged above
    }
  }
}

export async function captureMessage(
  message: string,
  level: "info" | "warn" | "error" = "info",
  context?: Record<string, unknown>
): Promise<void> {
  // Always log locally
  const logFn = level === "warn" ? logger.warn.bind(logger) : logger[level].bind(logger);
  logFn({ ...context }, message);

  // Report to Sentry if available
  const Sentry = await loadSentry();
  if (Sentry) {
    try {
      if (context) Sentry.setExtras(context);
      Sentry.captureMessage(message, level);
    } catch {
      // Sentry call failed — already logged above
    }
  }
}

/**
 * Wrap a Next.js API route handler with error tracking.
 * Catches unhandled errors and reports them.
 */
export function withErrorTracking<T extends (...args: unknown[]) => Promise<Response>>(
  handler: T,
  componentName?: string
): T {
  return (async (...args: unknown[]) => {
    try {
      return await handler(...args);
    } catch (error) {
      await captureException(error, { component: componentName ?? "unknown" });
      throw error;
    }
  }) as T;
}

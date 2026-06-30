/**
 * Phoenix-Core Structured Logger
 *
 * Uses pino for structured JSON logging in production,
 * and pino-pretty for human-readable output in development.
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.info({ userId: "123", action: "login" }, "User logged in");
 *   logger.error({ err, requestId: "456" }, "Request failed");
 *   logger.warn({ component: "llm-scheduler" }, "Rate limit approaching");
 */

import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),

  // Base fields added to every log entry
  base: {
    service: "phoenix-core",
    environment: process.env.NODE_ENV ?? "development",
  },

  // Timestamp in ISO format
  timestamp: pino.stdTimeFunctions.isoTime,

  // Production: JSON lines (for log aggregation)
  // Development: pretty-printed via pino-pretty
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss.l",
            ignore: "pid,hostname,service,environment",
            singleLine: true,
          },
        },
      }),

  // Redact sensitive fields
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "passwordHash",
      "AUTH_SECRET",
      "DATABASE_URL",
      "REDIS_URL",
    ],
    censor: "[REDACTED]",
  },
});

/**
 * Create a child logger with bound context.
 * Useful for per-component logging:
 *   const log = logger.child({ component: "agent-runtime" });
 *   log.info("Starting agent loop");
 */
export function createLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}

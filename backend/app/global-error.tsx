"use client";

import { useEffect } from "react";

/**
 * Global error boundary for the Next.js App Router.
 * Catches rendering errors and provides a fallback UI.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report error to error tracking
    console.error("[GlobalError]", error);
    // In production, this would call captureException from error-tracking.ts
  }, [error]);

  return (
    <html>
      <body
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "#0a0a0a",
          color: "#e2e8f0",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: 32 }}>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              marginBottom: 8,
              color: "#f87171",
            }}
          >
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: "#94a3b8", marginBottom: 24 }}>
            {error.message || "An unexpected error occurred"}
          </p>
          <button
            onClick={reset}
            style={{
              padding: "10px 24px",
              borderRadius: 8,
              border: "1px solid rgba(56, 189, 248, 0.3)",
              background: "rgba(56, 189, 248, 0.1)",
              color: "#38bdf8",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

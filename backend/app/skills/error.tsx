"use client";

import { useEffect } from "react";
import { ErrorBoundary } from "../_components/error-boundary";

export default function SkillsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Skills Route Error]", error);
  }, [error]);

  return (
    <ErrorBoundary name="Skills" fallback={<RouteErrorCard name="Skills" error={error} reset={reset} />}>
      <RouteErrorCard name="Skills" error={error} reset={reset} />
    </ErrorBoundary>
  );
}

function RouteErrorCard({
  name,
  error,
  reset,
}: {
  name: string;
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message = error.message || `An unexpected error occurred in the ${name} module`;
  const truncated = message.length > 200 ? message.slice(0, 200) + "..." : message;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        padding: 24,
        background: "var(--bg-void)",
      }}
    >
      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "24px 28px",
          maxWidth: 480,
          width: "100%",
          boxShadow: "0 0 24px rgba(255, 59, 59, 0.08)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "rgba(255, 59, 59, 0.12)",
              border: "1px solid rgba(255, 59, 59, 0.25)",
              color: "var(--red)",
              fontSize: 16,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            !
          </span>
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text-primary)",
              fontFamily: "var(--font-mono)",
            }}
          >
            {name} Module Error
          </span>
        </div>

        <div
          style={{
            fontSize: 13,
            color: "var(--text-secondary)",
            fontFamily: "var(--font-mono)",
            lineHeight: 1.6,
            padding: "12px 14px",
            background: "rgba(255, 59, 59, 0.04)",
            border: "1px solid rgba(255, 59, 59, 0.1)",
            borderRadius: 8,
            marginBottom: 20,
            wordBreak: "break-word",
          }}
        >
          {truncated}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={reset}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              border: "1px solid rgba(0, 240, 255, 0.3)",
              background: "rgba(0, 240, 255, 0.08)",
              color: "var(--text-primary)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
            }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "transparent",
              color: "var(--text-secondary)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              fontFamily: "var(--font-mono)",
            }}
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

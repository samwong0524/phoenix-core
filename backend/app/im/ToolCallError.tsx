"use client";

import { memo, useState } from "react";
import type { ToolError } from "./types";

export interface ToolCallErrorProps {
  errors: ToolError[];
  onDismiss: () => void;
  onRetry: (error: ToolError) => void;
}

/**
 * Collapsible error panel for failed tool calls.
 * Rendered above the input bar when tool execution fails with ok:false.
 */
export const ToolCallError = memo(function ToolCallError({
  errors,
  onDismiss,
  onRetry,
}: ToolCallErrorProps) {
  const [expanded, setExpanded] = useState(false);

  if (errors.length === 0) return null;

  const latestError = errors[errors.length - 1];
  const hasMultiple = errors.length > 1;

  return (
    <div
      style={{
        margin: "0 12px 4px",
        padding: "10px 14px",
        borderRadius: 8,
        border: "1px solid var(--danger, #ef4444)",
        background: "rgba(239, 68, 68, 0.08)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
          <span style={{ fontSize: 14 }} aria-hidden="true">
            ❌
          </span>
          <span style={{ fontWeight: 600, fontSize: 13, color: "var(--danger, #ef4444)" }}>
            工具调用失败
            {hasMultiple && ` (${errors.length})`}
          </span>
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={() => onRetry(latestError)}
            style={{
              padding: "3px 10px",
              borderRadius: 4,
              border: "none",
              background: "var(--danger, #ef4444)",
              color: "#fff",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            重试
          </button>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            style={{
              padding: "3px 10px",
              borderRadius: 4,
              border: "1px solid var(--border, #3a3a4a)",
              background: "transparent",
              color: "var(--text-secondary, #aaa)",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {expanded ? "收起" : "详情"}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              padding: "3px 10px",
              borderRadius: 4,
              border: "none",
              background: "transparent",
              color: "var(--text-tertiary, #888)",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Summary (always visible) */}
      <div
        style={{
          marginTop: 6,
          fontSize: 12,
          color: "var(--text-secondary, #aaa)",
          fontFamily: "var(--font-mono, monospace)",
        }}
      >
        {latestError.toolName}: {latestError.error.length > 80 ? `${latestError.error.slice(0, 80)}...` : latestError.error}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ marginTop: 10 }}>
          {errors.map((err, idx) => (
            <div
              key={err.toolCallId + idx}
              style={{
                marginBottom: idx < errors.length - 1 ? 10 : 0,
                padding: "8px 10px",
                borderRadius: 4,
                background: "var(--surface-code, #1e1e2e)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-dim, #666)",
                  marginBottom: 4,
                }}
              >
                [{new Date(err.timestamp).toLocaleTimeString()}] {err.toolName}
              </div>
              <pre
                style={{
                  margin: 0,
                  fontSize: 12,
                  fontFamily: "var(--font-mono, monospace)",
                  color: "var(--text-primary, #e2e8f0)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {err.error}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

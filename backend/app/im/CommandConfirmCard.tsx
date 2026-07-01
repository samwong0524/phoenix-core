"use client";

import { memo } from "react";

export interface CommandConfirmCardProps {
  command: string;
  kind: "dangerous" | "git";
  onApprove: () => void;
  onReject: () => void;
}

/**
 * Confirmation card for blocked dangerous / git commands.
 * Rendered above the input bar when the backend blocks a command
 * and the agent relays the block to the user.
 */
export const CommandConfirmCard = memo(function CommandConfirmCard({
  command,
  kind,
  onApprove,
  onReject,
}: CommandConfirmCardProps) {
  const isDangerous = kind === "dangerous";
  const accentColor = isDangerous
    ? "var(--danger, #ef4444)"
    : "var(--warning, #f59e0b)";
  const icon = isDangerous ? "\u26A0\uFE0F" : "\uD83D\uDD12";
  const title = isDangerous
    ? "\u9AD8\u5371\u547D\u4EE4\u5DF2\u62E6\u622A"
    : "Git \u64CD\u4F5C\u9700\u786E\u8BA4";
  const subtitle = isDangerous
    ? "\u8BE5\u547D\u4EE4\u53EF\u80FD\u9020\u6210\u4E0D\u53EF\u9006\u7684\u7834\u574F\uFF0C\u8BF7\u786E\u8BA4\u662F\u5426\u6267\u884C"
    : "\u8BF7\u786E\u8BA4\u662F\u5426\u63D0\u4EA4\u6216\u63A8\u9001\u4EE3\u7801";

  return (
    <div
      style={{
        margin: "0 12px 4px",
        padding: "10px 14px",
        borderRadius: 8,
        border: `1px solid ${accentColor}`,
        background: isDangerous
          ? "rgba(239, 68, 68, 0.08)"
          : "rgba(245, 158, 11, 0.08)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 6,
        }}
      >
        <span style={{ fontSize: 14 }} aria-hidden="true">{icon}</span>
        <span style={{ fontWeight: 600, fontSize: 13, color: accentColor }}>
          {title}
        </span>
      </div>

      {/* Command preview */}
      <pre
        style={{
          margin: "0 0 4px",
          padding: "6px 10px",
          borderRadius: 4,
          background: "var(--surface-code, #1e1e2e)",
          color: "var(--text-primary, #e2e8f0)",
          fontSize: 12,
          fontFamily: "var(--font-mono, monospace)",
          overflowX: "auto",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          maxHeight: 120,
        }}
      >
        {command}
      </pre>

      <div
        style={{
          fontSize: 11,
          color: "var(--text-tertiary, #888)",
          marginBottom: 8,
        }}
      >
        {subtitle}
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onApprove}
          style={{
            padding: "5px 16px",
            borderRadius: 6,
            border: "none",
            background: accentColor,
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {isDangerous ? "\u786E\u8BA4\u6267\u884C" : "\u786E\u8BA4\u63D0\u4EA4"}
        </button>
        <button
          type="button"
          onClick={onReject}
          style={{
            padding: "5px 16px",
            borderRadius: 6,
            border: "1px solid var(--border, #3a3a4a)",
            background: "transparent",
            color: "var(--text-secondary, #aaa)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          \u8DF3\u8FC7
        </button>
      </div>
    </div>
  );
});

"use client";

import { memo } from "react";

export interface PlanApprovalCardProps {
  /** Whether the plan has already been approved (disables buttons). */
  approved: boolean;
  onApprove: () => void;
  onModify: () => void;
}

/**
 * Approval card rendered when the Coordinator outputs a task decomposition plan.
 * Shows approve / modify buttons; disabled after the user responds.
 */
export const PlanApprovalCard = memo(function PlanApprovalCard({
  approved,
  onApprove,
  onModify,
}: PlanApprovalCardProps) {
  return (
    <div
      style={{
        marginTop: 10,
        padding: "10px 14px",
        borderRadius: 8,
        border: "1px solid var(--cyan-500, #06b6d4)",
        background: "rgba(6, 182, 212, 0.06)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 14 }} aria-hidden="true">
          {approved ? "\u2705" : "\uD83D\uDCCB"}
        </span>
        <span
          style={{
            fontWeight: 600,
            fontSize: 13,
            color: approved
              ? "var(--success, #22c55e)"
              : "var(--cyan-500, #06b6d4)",
          }}
        >
          {approved ? "\u65B9\u6848\u5DF2\u6279\u51C6" : "\u65B9\u6848\u5F85\u786E\u8BA4"}
        </span>
      </div>

      <div
        style={{
          fontSize: 11,
          color: "var(--text-tertiary, #888)",
          marginBottom: 8,
        }}
      >
        {approved
          ? "Coordinator \u5C06\u6309\u65B9\u6848\u6267\u884C\u4EFB\u52A1\u5206\u914D"
          : "\u8BF7\u786E\u8BA4\u6216\u8C03\u6574\u4EFB\u52A1\u5206\u89E3\u65B9\u6848\u540E\u518D\u6267\u884C"}
      </div>

      {!approved && (
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onApprove}
            style={{
              padding: "5px 16px",
              borderRadius: 6,
              border: "none",
              background: "var(--cyan-500, #06b6d4)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {"\u6279\u51C6\u65B9\u6848"}
          </button>
          <button
            type="button"
            onClick={onModify}
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
            {"\u8C03\u6574\u65B9\u6848"}
          </button>
        </div>
      )}
    </div>
  );
});

import React from "react";

type EmptyStateProps = {
  icon?: React.ReactNode;
  message: string;
  hint?: string;
  action?: React.ReactNode;
  padding?: string;
};

export function EmptyState({
  icon,
  message,
  hint,
  action,
  padding = "3rem 0",
}: EmptyStateProps) {
  return (
    <div
      style={{
        textAlign: "center",
        padding,
        color: "var(--text-dim)",
      }}
    >
      {icon && (
        <div style={{ fontSize: 32, marginBottom: 12 }}>{icon}</div>
      )}
      <div style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: hint ? 4 : 0 }}>
        {message}
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
          {hint}
        </div>
      )}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}

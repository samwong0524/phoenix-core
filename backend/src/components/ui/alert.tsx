import React from "react";

type AlertVariant = "info" | "success" | "warning" | "error";

type AlertProps = {
  variant?: AlertVariant;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

const variantStyles: Record<AlertVariant, { bg: string; border: string; color: string }> = {
  info: { bg: "var(--blue-soft)", border: "var(--blue-muted)", color: "var(--blue-text)" },
  success: { bg: "var(--green-soft)", border: "var(--green-muted)", color: "var(--green-text)" },
  warning: { bg: "var(--yellow-soft)", border: "var(--border)", color: "var(--yellow-text)" },
  error: { bg: "var(--red-soft)", border: "var(--red-muted)", color: "var(--red-text)" },
};

export function Alert({ variant = "info", children, style }: AlertProps) {
  const v = variantStyles[variant];
  return (
    <div
      style={{
        padding: "10px 16px",
        borderRadius: "var(--radius-md)",
        background: v.bg,
        border: `1px solid ${v.border}`,
        color: v.color,
        fontSize: 13,
        lineHeight: 1.5,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

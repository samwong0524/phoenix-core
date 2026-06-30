"use client";

import React from "react";

type TagVariant = "default" | "primary" | "success" | "warning" | "error" | "info";
type TagSize = "sm" | "md";

type TagProps = {
  variant?: TagVariant;
  size?: TagSize;
  closable?: boolean;
  onClose?: () => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
};

const variantStyles: Record<TagVariant, { bg: string; color: string; border: string }> = {
  default: { bg: "var(--slate-soft)", color: "var(--text-secondary)", border: "var(--border)" },
  primary: { bg: "var(--color-primary-soft)", color: "var(--color-primary)", border: "var(--color-primary-dim)" },
  success: { bg: "var(--green-soft)", color: "var(--green-text)", border: "var(--green-muted)" },
  warning: { bg: "var(--yellow-soft)", color: "var(--yellow-text)", border: "var(--border)" },
  error: { bg: "var(--red-soft)", color: "var(--red-text)", border: "var(--red-muted)" },
  info: { bg: "var(--blue-soft)", color: "var(--blue-text)", border: "var(--blue-muted)" },
};

const sizeStyles: Record<TagSize, React.CSSProperties> = {
  sm: { padding: "2px 8px", fontSize: 11, fontFamily: "var(--font-mono)" },
  md: { padding: "4px 12px", fontSize: 12 },
};

const baseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  borderRadius: "var(--radius-full)",
  border: "1px solid",
  whiteSpace: "nowrap",
};

const closeButtonStyle: React.CSSProperties = {
  cursor: "pointer",
  background: "none",
  border: "none",
  color: "inherit",
  fontSize: 14,
  marginLeft: 2,
  padding: 0,
  lineHeight: 1,
  display: "inline-flex",
  alignItems: "center",
};

export function Tag({
  variant = "default",
  size = "sm",
  closable = false,
  onClose,
  children,
  style,
}: TagProps) {
  const v = variantStyles[variant];

  return (
    <span
      style={{
        ...baseStyle,
        ...sizeStyles[size],
        background: v.bg,
        color: v.color,
        borderColor: v.border,
        ...style,
      }}
    >
      {children}
      {closable && (
        <button
          onClick={onClose}
          style={closeButtonStyle}
          aria-label="Close"
        >
          ×
        </button>
      )}
    </span>
  );
}

"use client";

import React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
type ButtonSize = "sm" | "md";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
};

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: "4px 10px", fontSize: 12 },
  md: { padding: "8px 16px", fontSize: 13 },
};

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: "var(--cyan)",
    color: "var(--bg-void)",
    border: "1px solid var(--cyan)",
    fontWeight: 600,
  },
  secondary: {
    background: "var(--bg-card)",
    color: "var(--cyan)",
    border: "1px solid var(--border-bright)",
  },
  ghost: {
    background: "transparent",
    color: "var(--text-secondary)",
    border: "1px solid var(--border)",
  },
  danger: {
    background: "var(--red)",
    color: "var(--text-primary)",
    border: "1px solid var(--red)",
  },
  success: {
    background: "var(--green)",
    color: "var(--bg-void)",
    border: "1px solid var(--green)",
    fontWeight: 600,
  },
};

const baseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  borderRadius: "var(--radius-sm)",
  cursor: "pointer",
  fontFamily: "var(--font-body)",
  transition: "all 0.2s cubic-bezier(0.2, 0, 0, 1)",
  whiteSpace: "nowrap",
};

const disabledStyle: React.CSSProperties = {
  opacity: 0.5,
  cursor: "not-allowed",
};

export function Button({
  variant = "ghost",
  size = "md",
  loading = false,
  icon,
  disabled,
  children,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      className={`phx-btn phx-btn-${variant}`}
      disabled={isDisabled}
      style={{
        ...baseStyle,
        ...sizeStyles[size],
        ...variantStyles[variant],
        ...(isDisabled ? disabledStyle : {}),
        ...style,
      }}
      {...rest}
    >
      {loading ? (
        <span
          style={{
            display: "inline-block",
            width: 14,
            height: 14,
            border: "2px solid currentColor",
            borderTopColor: "transparent",
            borderRadius: "50%",
            animation: "phx-spin 0.6s linear infinite",
          }}
        />
      ) : icon ? (
        <>{icon}</>
      ) : null}
      {children}
    </button>
  );
}

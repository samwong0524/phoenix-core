"use client";

import React from "react";

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  variant?: "default" | "mono";
  fullWidth?: boolean;
};

const baseStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 14px",
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text-primary)",
  fontSize: 13,
  fontFamily: "var(--font-body)",
  outline: "none",
  transition: "border-color 0.2s ease, box-shadow 0.2s ease",
  boxSizing: "border-box",
};

const variantOverrides: Record<string, React.CSSProperties> = {
  mono: {
    fontFamily: "var(--font-mono)",
  },
};

export function Input({ variant = "default", fullWidth = true, style, className, ...rest }: InputProps) {
  return (
    <input
      className={`phx-input ${className ?? ""}`}
      style={{
        ...baseStyle,
        ...(fullWidth ? { width: "100%" } : {}),
        ...variantOverrides[variant],
        ...style,
      }}
      {...rest}
    />
  );
}

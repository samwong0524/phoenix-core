"use client";

import React, { useEffect } from "react";

type AlertDialogVariant = "danger" | "warning" | "info";

type AlertDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: AlertDialogVariant;
  onConfirm: () => void;
  loading?: boolean;
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--bg-overlay)",
  backdropFilter: "blur(4px)",
  zIndex: "var(--z-modal)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const panelStyle: React.CSSProperties = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: 24,
  maxWidth: 420,
  width: "100%",
  boxShadow: "var(--shadow-glow-lg)",
};

const titleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: "var(--text-primary)",
  marginBottom: 8,
};

const descriptionStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-secondary)",
  lineHeight: 1.6,
  marginBottom: 24,
};

const actionsRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "var(--space-3)",
};

const cancelButtonStyle: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
  fontSize: 13,
};

const variantStyles: Record<AlertDialogVariant, React.CSSProperties> = {
  danger: { background: "var(--red)", color: "#fff" },
  warning: { background: "var(--yellow)", color: "var(--bg-void)" },
  info: { background: "var(--color-primary)", color: "#fff" },
};

const confirmButtonBase: React.CSSProperties = {
  padding: "8px 16px",
  borderRadius: "var(--radius-sm)",
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

const disabledStyle: React.CSSProperties = {
  opacity: 0.5,
  cursor: "not-allowed",
};

export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  onConfirm,
  loading = false,
}: AlertDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div style={overlayStyle} onClick={() => onOpenChange(false)}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={titleStyle}>{title}</div>
        <div style={descriptionStyle}>{description}</div>
        <div style={actionsRowStyle}>
          <button
            style={cancelButtonStyle}
            onClick={() => onOpenChange(false)}
          >
            {cancelText}
          </button>
          <button
            style={{
              ...confirmButtonBase,
              ...variantStyles[variant],
              ...(loading ? disabledStyle : {}),
            }}
            onClick={onConfirm}
            disabled={loading}
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
            ) : null}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

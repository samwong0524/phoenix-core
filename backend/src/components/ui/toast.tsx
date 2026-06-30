"use client";

import React, { useEffect, useState } from "react";

type ToastType = "success" | "error" | "warning" | "info";

type ToastItem = {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
};

const toastStyles: Record<ToastType, { bg: string; border: string; color: string; icon: string }> = {
  success: { bg: "var(--green-soft)", border: "var(--green-muted)", color: "var(--green-text)", icon: "\u2713" },
  error: { bg: "var(--red-soft)", border: "var(--red-muted)", color: "var(--red-text)", icon: "\u2717" },
  warning: { bg: "var(--yellow-soft)", border: "var(--border)", color: "var(--yellow-text)", icon: "\u26A0" },
  info: { bg: "var(--blue-soft)", border: "var(--blue-muted)", color: "var(--blue-text)", icon: "\u2139" },
};

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: string) => void }) {
  const v = toastStyles[item.type];
  return (
    <div
      style={{
        padding: "12px 16px",
        borderRadius: "var(--radius-md)",
        border: `1px solid ${v.border}`,
        background: v.bg,
        color: v.color,
        fontSize: 13,
        lineHeight: 1.5,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        transition: "opacity 0.2s ease-out, transform 0.2s ease-out",
      }}
    >
      <span>{v.icon}</span>
      <span>{item.message}</span>
      <button
        style={{
          marginLeft: "auto",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "inherit",
          opacity: 0.6,
          fontSize: 16,
          padding: 0,
          lineHeight: 1,
        }}
        onClick={() => onDismiss(item.id)}
      >
        ×
      </button>
    </div>
  );
}

// Simple pub-sub for toasts
let listeners: Array<() => void> = [];
let toastItems: ToastItem[] = [];

function emit() {
  listeners.forEach((l) => l());
}

function showToast(type: ToastType, message: string, duration = 4000) {
  const id = crypto.randomUUID();
  toastItems = [...toastItems, { id, type, message, duration }];
  emit();
  if (duration > 0) {
    setTimeout(() => {
      dismissToast(id);
    }, duration);
  }
}

function dismissToast(id: string) {
  toastItems = toastItems.filter((t) => t.id !== id);
  emit();
}

export function ToastContainer() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, []);

  if (toastItems.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: "var(--z-toast)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-2)",
        maxWidth: 380,
      }}
    >
      {toastItems.map((item) => (
        <Toast key={item.id} item={item} onDismiss={dismissToast} />
      ))}
    </div>
  );
}

export const toast = {
  success: (msg: string) => showToast("success", msg),
  error: (msg: string) => showToast("error", msg),
  warning: (msg: string) => showToast("warning", msg),
  info: (msg: string) => showToast("info", msg),
};

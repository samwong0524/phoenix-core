"use client";

import { useState, useCallback, useRef, useEffect, createContext, useContext } from "react";

// ─── Types ────────────────────────────────────────────

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  variant?: "warning" | "danger" | "critical";
  /** If set, user must type this text to enable the confirm button */
  typeToConfirm?: string;
};

type ConfirmState = ConfirmOptions & {
  open: boolean;
  resolve: ((value: boolean) => void) | null;
};

// ─── Context ──────────────────────────────────────────

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) {
    // Fallback to window.confirm if provider is not mounted
    return async (options: ConfirmOptions) => {
      return window.confirm(options.message);
    };
  }
  return fn;
}

// ─── Provider ─────────────────────────────────────────

const VARIANT_STYLES = {
  warning: {
    borderColor: "rgba(234, 179, 8, 0.5)",
    bgGlow: "rgba(234, 179, 8, 0.08)",
    btnBg: "linear-gradient(135deg, #eab308, #f59e0b)",
    icon: "⚠",
  },
  danger: {
    borderColor: "rgba(239, 68, 68, 0.5)",
    bgGlow: "rgba(239, 68, 68, 0.08)",
    btnBg: "linear-gradient(135deg, #ef4444, #dc2626)",
    icon: "⛔",
  },
  critical: {
    borderColor: "rgba(239, 68, 68, 0.8)",
    bgGlow: "rgba(239, 68, 68, 0.15)",
    btnBg: "linear-gradient(135deg, #dc2626, #991b1b)",
    icon: "🔥",
  },
};

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState>({
    open: false,
    message: "",
    resolve: null,
  });
  const [typed, setTyped] = useState("");
  const [loading, setLoading] = useState(false);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Focus trap: save previous focus, focus dialog on open, restore on close
  useEffect(() => {
    if (!state.open) return;

    previousFocusRef.current = document.activeElement as HTMLElement;

    // Defer to next tick so the dialog DOM is mounted
    const timer = setTimeout(() => {
      if (!dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        dialogRef.current.focus();
      }
    }, 0);

    return () => {
      clearTimeout(timer);
      // Restore focus on unmount
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === "function") {
        previousFocusRef.current.focus();
      }
    };
  }, [state.open]);

  // Tab key focus trap
  const handleDialogKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !dialogRef.current) return;

    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState({
        ...options,
        open: true,
        resolve: null,
      });
      setTyped("");
      setLoading(false);
    });
  }, []);

  function handleResolve(value: boolean) {
    if (resolveRef.current) {
      resolveRef.current(value);
      resolveRef.current = null;
    }
    setState((prev) => ({ ...prev, open: false, resolve: null }));
    setTyped("");
  }

  const styles = VARIANT_STYLES[state.variant ?? "warning"];
  const canConfirm = state.typeToConfirm
    ? typed === state.typeToConfirm
    : true;

  if (!state.open) return <>{children}</>;

  return (
    <>
      {children}

      {/* Overlay */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={state.title ?? "Confirm Action"}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0, 0, 0, 0.6)",
          backdropFilter: "blur(4px)",
        }}
        onClick={() => !loading && handleResolve(false)}
      >
        {/* Dialog */}
        <div
          ref={dialogRef}
          onKeyDown={handleDialogKeyDown}
          onClick={(e) => e.stopPropagation()}
          tabIndex={-1}
          style={{
            width: "100%",
            maxWidth: 420,
            margin: "0 16px",
            borderRadius: 12,
            border: `1px solid ${styles.borderColor}`,
            background: "var(--bg-card, #0f172a)",
            boxShadow: `0 0 40px ${styles.bgGlow}, 0 20px 60px rgba(0,0,0,0.5)`,
            padding: "24px",
          }}
        >
          {/* Icon + Title */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>{styles.icon}</span>
            <h3
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                color: "var(--text-primary, #e2e8f0)",
              }}
            >
              {state.title ?? "Confirm Action"}
            </h3>
          </div>

          {/* Message */}
          <p
            aria-live="polite"
            style={{
              margin: "0 0 16px",
              fontSize: 14,
              lineHeight: 1.6,
              color: "var(--text-secondary, #94a3b8)",
            }}
          >
            {state.message}
          </p>

          {/* Type-to-confirm input */}
          {state.typeToConfirm && (
            <div style={{ marginBottom: 16 }}>
              <p
                style={{
                  margin: "0 0 6px",
                  fontSize: 12,
                  color: "var(--text-secondary, #94a3b8)",
                }}
              >
                Type <strong style={{ color: "#f87171" }}>{state.typeToConfirm}</strong> to confirm
              </p>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={state.typeToConfirm}
                autoFocus
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: `1px solid ${canConfirm ? "rgba(34, 197, 94, 0.5)" : "rgba(239, 68, 68, 0.3)"}`,
                  background: "var(--bg-elevated, rgba(30, 41, 59, 0.8))",
                  color: "var(--text-primary, #e2e8f0)",
                  fontSize: 14,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}

          {/* Buttons */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button
              onClick={() => !loading && handleResolve(false)}
              disabled={loading}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid var(--border, rgba(148, 163, 184, 0.2))",
                background: "transparent",
                color: "var(--text-secondary, #94a3b8)",
                fontSize: 13,
                fontWeight: 500,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.5 : 1,
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setLoading(true);
                handleResolve(true);
              }}
              disabled={!canConfirm}
              style={{
                padding: "8px 20px",
                borderRadius: 8,
                border: "none",
                background: canConfirm ? styles.btnBg : "rgba(100, 116, 139, 0.3)",
                color: canConfirm ? "#fff" : "rgba(148, 163, 184, 0.5)",
                fontSize: 13,
                fontWeight: 600,
                cursor: canConfirm ? "pointer" : "not-allowed",
                transition: "all 0.15s",
              }}
            >
              {state.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

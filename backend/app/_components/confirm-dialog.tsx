"use client";

import { useState, useCallback, useRef, useEffect, createContext, useContext } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { corporateVariants } from "@/lib/motion";

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

  return (
    <>
      {children}

      <AnimatePresence>
        {state.open && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={state.title ?? "Confirm Action"}
            variants={corporateVariants.modalOverlay}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => !loading && handleResolve(false)}
          >
            <motion.div
              ref={dialogRef}
              onKeyDown={handleDialogKeyDown}
              onClick={(e) => e.stopPropagation()}
              tabIndex={-1}
              variants={corporateVariants.modalPanel}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="w-full max-w-[420px] mx-4 rounded-xl bg-card p-6"
              style={{
                border: `1px solid ${styles.borderColor}`,
                boxShadow: `0 0 40px ${styles.bgGlow}, 0 20px 60px rgba(0,0,0,0.5)`,
              }}
            >
          {/* Icon + Title */}
          <div className="flex items-center gap-2.5 mb-3">
            <span className="text-xl">{styles.icon}</span>
            <h3
              className="text-base font-semibold text-text"
            >
              {state.title ?? "Confirm Action"}
            </h3>
          </div>

          {/* Message */}
          <p
            aria-live="polite"
            className="mb-4 text-sm leading-relaxed text-text-secondary"
          >
            {state.message}
          </p>

          {/* Type-to-confirm input */}
          {state.typeToConfirm && (
            <div className="mb-4">
              <p
                className="mb-1.5 text-xs text-text-secondary"
              >
                Type <strong className="text-red-text">{state.typeToConfirm}</strong> to confirm
              </p>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={state.typeToConfirm}
                autoFocus
                className={`w-full px-3 py-2 rounded-lg bg-elevated text-text text-sm outline-none ${
                  canConfirm ? "border border-green-500/50" : "border border-red-500/30"
                }`}
              />
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2.5 justify-end">
            <button
              onClick={() => !loading && handleResolve(false)}
              disabled={loading}
              className={`px-4 py-2 rounded-lg border border-border bg-transparent text-text-secondary text-[13px] font-medium ${
                loading ? "cursor-not-allowed opacity-50" : "cursor-pointer"
              }`}
            >
              Cancel
            </button>
            <button
              onClick={() => {
                setLoading(true);
                handleResolve(true);
              }}
              disabled={!canConfirm}
              className={`px-5 py-2 rounded-lg border-0 text-[13px] font-semibold transition-all duration-150 ${
                canConfirm
                  ? "cursor-pointer text-white"
                  : "cursor-not-allowed bg-slate-500/30 text-text-secondary/50"
              }`}
              style={canConfirm ? { background: styles.btnBg } : undefined}
            >
              {state.confirmLabel ?? "Confirm"}
            </button>
          </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

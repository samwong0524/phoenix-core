"use client";

import React, { useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform } from "framer-motion";
import { X } from "lucide-react";

type BottomSheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  /** Max height as CSS value, default "60vh" */
  maxHeight?: string;
  /** Show close button in header, default true */
  showCloseButton?: boolean;
  /** Close on backdrop click, default true */
  closeOnBackdrop?: boolean;
  /** Close on Escape key, default true */
  closeOnEscape?: boolean;
};

/* ─── Style constants ───────────────────────── */

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--bg-overlay)",
  backdropFilter: "blur(2px)",
  zIndex: "var(--z-overlay)" as unknown as number,
};

const sheetContainerStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 0,
  left: 0,
  right: 0,
  zIndex: "var(--z-modal)" as unknown as number,
  display: "flex",
  flexDirection: "column",
  background: "var(--bg-elevated)",
  borderTop: "1px solid var(--border)",
  borderRadius: "var(--radius-lg) var(--radius-lg) 0 0",
  boxShadow: "var(--shadow-glow-lg)",
  overflow: "hidden",
};

const handleWrapStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  paddingTop: 10,
  paddingBottom: 6,
  cursor: "grab",
  touchAction: "none",
};

const handleBarStyle: React.CSSProperties = {
  width: 36,
  height: 4,
  borderRadius: "var(--radius-full)",
  background: "var(--text-tertiary, rgba(255,255,255,0.25))",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 var(--space-4)",
  paddingBottom: "var(--space-3)",
  borderBottom: "1px solid var(--border)",
};

const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text-primary)",
  margin: 0,
};

const closeButtonStyle: React.CSSProperties = {
  width: 44,
  height: 44,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "var(--radius-sm)",
  border: "none",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
  flexShrink: 0,
  marginLeft: "auto",
  marginRight: "calc(var(--space-2) * -1)",
  transition: "background 0.15s ease",
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  overscrollBehavior: "contain",
  padding: "var(--space-4)",
};

/* ─── Thresholds ────────────────────────────── */
const DISMISS_THRESHOLD = 80; // px dragged down to trigger close
const VELOCITY_THRESHOLD = 500; // px/s flick-down velocity

/* ─── Component ─────────────────────────────── */

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  maxHeight = "60vh",
  showCloseButton = true,
  closeOnBackdrop = true,
  closeOnEscape = true,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const y = useMotionValue(0);
  const sheetOpacity = useTransform(y, [0, 200], [1, 0.6]);

  // Escape key handler
  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, closeOnEscape, onClose]);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const handleDragEnd = useCallback(
    (_: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
      if (
        info.offset.y > DISMISS_THRESHOLD ||
        info.velocity.y > VELOCITY_THRESHOLD
      ) {
        onClose();
      }
    },
    [onClose],
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="sheet-overlay"
            style={overlayStyle}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={closeOnBackdrop ? onClose : undefined}
          />

          {/* Sheet */}
          <motion.div
            key="sheet-panel"
            ref={sheetRef}
            style={{
              ...sheetContainerStyle,
              maxHeight,
              y,
              opacity: sheetOpacity,
            }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.3 }}
            onDragEnd={handleDragEnd}
            role="dialog"
            aria-modal="true"
            aria-label={title || "Bottom sheet"}
          >
            {/* Drag handle — also acts as drag target */}
            <div style={handleWrapStyle}>
              <div style={handleBarStyle} />
            </div>

            {/* Optional header */}
            {(title || showCloseButton) && (
              <div style={headerStyle}>
                {title && <h3 style={titleStyle}>{title}</h3>}
                {showCloseButton && (
                  <button
                    style={closeButtonStyle}
                    onClick={onClose}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "var(--bg-card)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.background =
                        "transparent";
                    }}
                    aria-label="关闭"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            )}

            {/* Scrollable body */}
            <div style={bodyStyle}>{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

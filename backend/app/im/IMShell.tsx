"use client";

import { useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, PanelRight, X } from "lucide-react";
import { useIsMobile } from "@/lib/use-media-query";
import { BottomSheet } from "@/components/ui";

type IMShellProps = {
  left: ReactNode;
  mid: ReactNode;
  right: ReactNode;
};

const DRAWER_WIDTH = 280;

/* Shared floating-button style factory */
const floatBtn = (extra: React.CSSProperties = {}): React.CSSProperties => ({
  width: 36,
  height: 36,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
  color: "var(--text-secondary)",
  cursor: "pointer",
  ...extra,
});

export function IMShell({ left, mid, right }: IMShellProps) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  /* ── Mobile (< 768 px): drawer sidebar + bottom-sheet task monitor ── */
  if (isMobile) {
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--bg-void)",
          overflow: "hidden",
        }}
      >
        {/* Floating nav buttons — z above the global hamburger (1001) */}
        <button
          onClick={() => setSidebarOpen(true)}
          aria-label="Open navigation"
          style={floatBtn({ position: "fixed", top: 8, left: 8, zIndex: 1002 })}
        >
          <Menu size={18} />
        </button>
        <button
          onClick={() => setSheetOpen(true)}
          aria-label="Open task monitor"
          style={floatBtn({ position: "fixed", top: 8, right: 8, zIndex: 1002 })}
        >
          <PanelRight size={18} />
        </button>

        {/* Chat area fills the screen */}
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>{mid}</div>

        {/* Sidebar drawer */}
        <AnimatePresence>
          {sidebarOpen && (
            <>
              <motion.div
                key="sb-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setSidebarOpen(false)}
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,0.5)",
                  backdropFilter: "blur(2px)",
                  zIndex: 1003,
                }}
              />
              <motion.div
                key="sb-drawer"
                initial={{ x: -DRAWER_WIDTH }}
                animate={{ x: 0 }}
                exit={{ x: -DRAWER_WIDTH }}
                transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
                style={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  bottom: 0,
                  width: DRAWER_WIDTH,
                  zIndex: 1004,
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    padding: "8px 8px 0",
                  }}
                >
                  <button
                    onClick={() => setSidebarOpen(false)}
                    aria-label="Close navigation"
                    style={floatBtn({ border: "none", background: "transparent" })}
                  >
                    <X size={18} />
                  </button>
                </div>
                <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                  {left}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Right panel as BottomSheet */}
        <BottomSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title="Task Monitor"
          maxHeight="70vh"
        >
          {right}
        </BottomSheet>
      </div>
    );
  }

  /* ── Desktop / Tablet (≥ 768 px): CSS grid 3-column layout ── */
  return (
    <div className="app" style={{ background: "var(--bg-panel)" }}>
      {left}
      {mid}
      {right}
    </div>
  );
}

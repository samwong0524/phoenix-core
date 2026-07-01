"use client";

import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
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

/* ── Panel resize constants ──────────────────────────────────── */
const LEFT_DEFAULT = 220;
const LEFT_MIN = 140;
const LEFT_MAX = 360;
const RIGHT_DEFAULT = 280;
const RIGHT_MIN = 200;
const RIGHT_MAX = 420;
const STORAGE_KEY = "phoenix-panel-widths";

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

/* ── usePanelResize hook ─────────────────────────────────────── */
function usePanelResize() {
  const [leftWidth, setLeftWidth] = useState(() => {
    if (typeof window === "undefined") return LEFT_DEFAULT;
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      return s ? JSON.parse(s).left ?? LEFT_DEFAULT : LEFT_DEFAULT;
    } catch {
      return LEFT_DEFAULT;
    }
  });
  const [rightWidth, setRightWidth] = useState(() => {
    if (typeof window === "undefined") return RIGHT_DEFAULT;
    try {
      const s = localStorage.getItem(STORAGE_KEY);
      return s ? JSON.parse(s).right ?? RIGHT_DEFAULT : RIGHT_DEFAULT;
    } catch {
      return RIGHT_DEFAULT;
    }
  });
  const [dragging, setDragging] = useState(false);

  const persist = useCallback((l: number, r: number) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ left: l, right: r }));
    } catch { /* quota exceeded — ignore */ }
  }, []);

  return { leftWidth, rightWidth, setLeftWidth, setRightWidth, dragging, setDragging, persist };
}

/* ── Splitter component ──────────────────────────────────────── */
function Splitter({
  onDragStart,
  onDragMove,
  onDragEnd,
  dragging,
}: {
  onDragStart: (clientX: number) => void;
  onDragMove: (clientX: number) => void;
  onDragEnd: () => void;
  dragging: boolean;
}) {
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      startX.current = e.clientX;
      onDragStart(e.clientX);
      startWidth.current = 0; // set by parent via closure

      const move = (ev: PointerEvent) => onDragMove(ev.clientX);
      const up = () => {
        onDragEnd();
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [onDragStart, onDragMove, onDragEnd],
  );

  return (
    <div
      onPointerDown={handlePointerDown}
      style={{
        width: 6,
        cursor: "col-resize",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        zIndex: 10,
        position: "relative",
        touchAction: "none",
      }}
    >
      {/* Visible divider line */}
      <div
        style={{
          width: 1,
          height: "100%",
          background: dragging
            ? "var(--color-primary)"
            : "var(--border)",
          transition: dragging ? "none" : "background 0.15s",
        }}
      />
      {/* Hover highlight overlay */}
      {!dragging && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: 6,
            background: "transparent",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget.previousElementSibling as HTMLElement).style.background =
              "var(--color-primary-dim)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget.previousElementSibling as HTMLElement).style.background =
              "var(--border)";
          }}
        />
      )}
    </div>
  );
}

/* ── IMShell ─────────────────────────────────────────────────── */
export function IMShell({ left, mid, right }: IMShellProps) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  /* Panel resize state */
  const resize = usePanelResize();
  const leftStartX = useRef(0);
  const rightStartX = useRef(0);
  const leftStartW = useRef(0);
  const rightStartW = useRef(0);

  /* Refs for latest widths — dragEnd reads from these to avoid stale closures */
  const leftWidthRef = useRef(resize.leftWidth);
  const rightWidthRef = useRef(resize.rightWidth);
  leftWidthRef.current = resize.leftWidth;
  rightWidthRef.current = resize.rightWidth;

  /* Prevent text selection while dragging */
  useEffect(() => {
    if (!resize.dragging) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    return () => {
      document.body.style.userSelect = prev;
      document.body.style.cursor = "";
    };
  }, [resize.dragging]);

  /* Left splitter handlers */
  const handleLeftDragStart = useCallback(
    (clientX: number) => {
      leftStartX.current = clientX;
      leftStartW.current = leftWidthRef.current;
      resize.setDragging(true);
    },
    [resize.setDragging],
  );
  const handleLeftDragMove = useCallback(
    (clientX: number) => {
      const delta = clientX - leftStartX.current;
      const w = Math.max(LEFT_MIN, Math.min(LEFT_MAX, leftStartW.current + delta));
      resize.setLeftWidth(w);
    },
    [resize.setLeftWidth],
  );
  const handleLeftDragEnd = useCallback(() => {
    resize.setDragging(false);
    resize.persist(leftWidthRef.current, rightWidthRef.current);
  }, [resize.setDragging, resize.persist]);

  /* Right splitter handlers */
  const handleRightDragStart = useCallback(
    (clientX: number) => {
      rightStartX.current = clientX;
      rightStartW.current = rightWidthRef.current;
      resize.setDragging(true);
    },
    [resize.setDragging],
  );
  const handleRightDragMove = useCallback(
    (clientX: number) => {
      const delta = clientX - rightStartX.current;
      const w = Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, rightStartW.current - delta));
      resize.setRightWidth(w);
    },
    [resize.setRightWidth],
  );
  const handleRightDragEnd = useCallback(() => {
    resize.setDragging(false);
    resize.persist(leftWidthRef.current, rightWidthRef.current);
  }, [resize.setDragging, resize.persist]);

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

  /* ── Desktop / Tablet (≥ 768 px): resizable 3-column layout ── */
  return (
    <div
      className="app"
      style={{
        background: "var(--bg-panel)",
        gridTemplateColumns: `${resize.leftWidth}px auto 1fr auto ${resize.rightWidth}px`,
      }}
    >
      {left}
      <Splitter
        onDragStart={handleLeftDragStart}
        onDragMove={handleLeftDragMove}
        onDragEnd={handleLeftDragEnd}
        dragging={resize.dragging}
      />
      {mid}
      <Splitter
        onDragStart={handleRightDragStart}
        onDragMove={handleRightDragMove}
        onDragEnd={handleRightDragEnd}
        dragging={resize.dragging}
      />
      {right}
    </div>
  );
}

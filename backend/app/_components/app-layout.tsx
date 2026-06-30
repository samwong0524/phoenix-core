"use client";

import { memo, useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";
import { GlobalSidebar } from "./global-sidebar";
import { ROUTES } from "./routes";
import { stepTransition } from "@/lib/motion";
import { useIsMobile } from "@/lib/use-media-query";

const SIDEBAR_EXCLUDED_PATHS = [ROUTES.LOGIN];

export const AppLayout = memo(function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const hideSidebar = SIDEBAR_EXCLUDED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  // Auto-close mobile drawer on navigation
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  if (hideSidebar) {
    return <>{children}</>;
  }

  // Mobile: sidebar as overlay drawer
  if (isMobile) {
    return (
      <div className="flex h-screen overflow-hidden" style={{ backgroundColor: "var(--bg-void)" }}>
        {/* Mobile hamburger toggle */}
        <button
          onClick={() => setDrawerOpen(!drawerOpen)}
          style={{
            position: "fixed",
            top: 8,
            left: 8,
            zIndex: 1001,
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
          }}
          aria-label={drawerOpen ? "关闭导航" : "打开导航"}
        >
          {drawerOpen ? <X size={18} /> : <Menu size={18} />}
        </button>

        {/* Drawer overlay + sidebar */}
        <AnimatePresence>
          {drawerOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setDrawerOpen(false)}
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 999,
                  background: "rgba(0, 0, 0, 0.5)",
                  backdropFilter: "blur(2px)",
                }}
              />
              <motion.div
                initial={{ x: -220 }}
                animate={{ x: 0 }}
                exit={{ x: -220 }}
                transition={{ duration: 0.25, ease: [0.2, 0, 0, 1] }}
                style={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  bottom: 0,
                  zIndex: 1000,
                }}
              >
                <GlobalSidebar />
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <main id="main-content" className="flex-1 overflow-hidden" style={{ position: "relative" }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={pathname}
              variants={stepTransition}
              initial="enter"
              animate="active"
              exit="exit"
              style={{ height: "100%" }}
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    );
  }

  // Desktop: sidebar inline
  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: "var(--bg-void)" }}>
      <GlobalSidebar />
      <main id="main-content" className="flex-1 overflow-hidden" style={{ position: "relative" }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={pathname}
            variants={stepTransition}
            initial="enter"
            animate="active"
            exit="exit"
            style={{ height: "100%" }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
});

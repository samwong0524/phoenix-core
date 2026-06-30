"use client";

import { memo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  MessageSquare,
  Workflow,
  Activity,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
} from "lucide-react";
import { ROUTES } from "./routes";
import { useI18n } from "@/lib/i18n/context";

interface NavChild {
  key: string;
  label: string;
  href: string;
  icon: React.ElementType;
}

interface NavItem {
  key: string;
  label: string;
  icon: React.ElementType;
  href: string;
  children?: NavChild[];
}

function buildNavItems(t: (key: string) => string): NavItem[] {
  return [
    {
      key: "chat",
      label: t("sidebar.chat"),
      icon: MessageSquare,
      href: ROUTES.CHAT,
    },
    {
      key: "orchestrate",
      label: t("sidebar.orchestrate"),
      icon: Workflow,
      href: ROUTES.WORKFLOW,
      children: [
        { key: "workflow", label: t("sidebar.workflow"), href: ROUTES.WORKFLOW, icon: Workflow },
        { key: "pipeline", label: t("sidebar.pipeline"), href: ROUTES.PIPELINE, icon: Zap },
        { key: "topology", label: t("sidebar.topology"), href: ROUTES.GRAPH, icon: Activity },
      ],
    },
    {
      key: "operations",
      label: t("sidebar.operations"),
      icon: Activity,
      href: ROUTES.MONITOR,
      children: [
        { key: "monitor", label: t("sidebar.monitor"), href: ROUTES.MONITOR, icon: Activity },
        { key: "history", label: t("sidebar.history"), href: ROUTES.HISTORY, icon: MessageSquare },
        { key: "models", label: t("sidebar.models"), href: ROUTES.MODELS, icon: Settings },
      ],
    },
    {
      key: "config",
      label: t("sidebar.config"),
      icon: Settings,
      href: ROUTES.SKILLS,
      children: [
        { key: "skills", label: t("sidebar.skills"), href: ROUTES.SKILLS, icon: Settings },
        { key: "settings", label: t("sidebar.settings"), href: ROUTES.SETTINGS, icon: Settings },
      ],
    },
  ];
}

const SIDEBAR_WIDTH = 220;
const SIDEBAR_COLLAPSED = 56;
const EASE = [0.2, 0, 0, 1] as const;

export const GlobalSidebar = memo(function GlobalSidebar() {
  const pathname = usePathname();
  const { t } = useI18n();
  const NAV_ITEMS = buildNavItems(t);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["orchestrate", "operations", "config"])
  );

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <motion.aside
      aria-label="Sidebar"
      animate={{ width: collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH }}
      transition={{ duration: 0.25, ease: EASE }}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRight: "1px solid var(--border)",
        backgroundColor: "var(--bg-panel)",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "0 var(--space-3)",
          height: 48,
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "var(--radius-sm)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            backgroundColor: "var(--accent-cyan)",
            color: "#000",
          }}
        >
          <Zap size={16} />
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15, ease: EASE }}
              style={{ fontWeight: 700, fontSize: 13, letterSpacing: "0.05em", color: "var(--text-primary)" }}
            >
              SWARM IDE
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Nav items */}
      <nav aria-label="Main navigation" style={{ flex: 1, padding: "var(--space-2) 0", overflowY: "auto", overflowX: "hidden" }}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          const expanded = expandedGroups.has(item.key);
          const hasChildren = item.children && item.children.length > 0;
          const groupActive = hasChildren
            ? item.children!.some((c) => isActive(c.href))
            : active;

          return (
            <div key={item.key}>
              <motion.div
                role={hasChildren ? "button" : undefined}
                tabIndex={hasChildren ? 0 : undefined}
                aria-expanded={hasChildren ? expanded : undefined}
                onKeyDown={hasChildren ? (e: React.KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleGroup(item.key);
                  }
                } : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  padding: "var(--space-2) var(--space-3)",
                  margin: "0 var(--space-1)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  backgroundColor:
                    active && !hasChildren
                      ? "var(--bg-card)"
                      : "transparent",
                  color: groupActive
                    ? "var(--accent-cyan)"
                    : "var(--text-secondary)",
                }}
                whileHover={{
                  backgroundColor: active && !hasChildren
                    ? "var(--bg-card)"
                    : "rgba(0, 240, 255, 0.06)",
                }}
                whileTap={hasChildren ? { scale: 0.98 } : undefined}
                transition={{ duration: 0.15 }}
                onClick={() => {
                  if (hasChildren) toggleGroup(item.key);
                }}
              >
                <Link
                  href={item.href}
                  style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flex: 1, minWidth: 0, color: "inherit", textDecoration: "none" }}
                  aria-current={active && !hasChildren ? "page" : undefined}
                  onClick={(e) => {
                    if (hasChildren) {
                      e.preventDefault();
                      toggleGroup(item.key);
                    }
                  }}
                >
                  <Icon size={18} style={{ flexShrink: 0 }} aria-hidden="true" />
                  <AnimatePresence>
                    {!collapsed && (
                      <motion.span
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: "auto" }}
                        exit={{ opacity: 0, width: 0 }}
                        transition={{ duration: 0.2, ease: EASE }}
                        style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </Link>
                <AnimatePresence>
                  {!collapsed && hasChildren && (
                    <motion.span
                      initial={{ opacity: 0, rotate: 0 }}
                      animate={{ opacity: 0.5, rotate: expanded ? 90 : 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2, ease: EASE }}
                      style={{ marginLeft: "auto", fontSize: 11, display: "flex" }}
                    >
                      <ChevronRight size={14} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Sub-items with AnimatePresence */}
              <AnimatePresence initial={false}>
                {!collapsed && hasChildren && expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: EASE }}
                    style={{ overflow: "hidden", marginLeft: 16 }}
                  >
                    <div style={{ marginBottom: 4 }}>
                      {item.children!.map((child) => {
                        const ChildIcon = child.icon;
                        const childActive = isActive(child.href);
                        return (
                          <motion.div
                            key={child.href}
                            whileHover={{
                              backgroundColor: childActive
                                ? "var(--bg-card)"
                                : "rgba(0, 240, 255, 0.06)",
                            }}
                            transition={{ duration: 0.15 }}
                            style={{
                              borderRadius: "var(--radius-sm)",
                              margin: "0 var(--space-1)",
                            }}
                          >
                            <Link
                              href={child.href}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "var(--space-2)",
                                padding: "6px var(--space-3)",
                                fontSize: 13,
                                backgroundColor: childActive
                                  ? "var(--bg-card)"
                                  : "transparent",
                                color: childActive
                                  ? "var(--accent-cyan)"
                                  : "var(--text-secondary)",
                                textDecoration: "none",
                              }}
                              aria-current={childActive ? "page" : undefined}
                            >
                              <ChildIcon size={14} style={{ flexShrink: 0 }} aria-hidden="true" />
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{child.label}</span>
                            </Link>
                          </motion.div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <motion.button
        onClick={() => setCollapsed(!collapsed)}
        whileHover={{ backgroundColor: "rgba(0, 240, 255, 0.06)" }}
        whileTap={{ scale: 0.95 }}
        transition={{ duration: 0.15 }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 40,
          flexShrink: 0,
          background: "transparent",
          cursor: "pointer",
          border: "none",
          borderTop: "1px solid var(--border)",
          color: "var(--text-secondary)",
        }}
        aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
      >
        <motion.span
          animate={{ rotate: collapsed ? 180 : 0 }}
          transition={{ duration: 0.25, ease: EASE }}
          style={{ display: "flex" }}
        >
          <ChevronLeft size={16} />
        </motion.span>
      </motion.button>
    </motion.aside>
  );
});

"use client";

import { memo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { getReducedVariant } from "@/lib/motion";
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
      href: ROUTES.ORCHESTRATE,
      children: [
        { key: "orchestrate-dashboard", label: t("sidebar.orchestrate"), href: ROUTES.ORCHESTRATE, icon: Workflow },
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
  const prefersReduced = useReducedMotion();
  // Progressive disclosure: all groups collapsed by default;
  // auto-expand the group that matches the current route
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const item of NAV_ITEMS) {
      if (item.children?.some((c) => pathname === c.href || pathname.startsWith(c.href + "/"))) {
        initial.add(item.key);
      }
    }
    return initial;
  });

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
      transition={{ duration: prefersReduced ? 0.1 : 0.25, ease: EASE }}
      className="flex flex-col h-full border-r border-border bg-panel overflow-hidden shrink-0"
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-3 h-12 border-b border-border shrink-0 overflow-hidden whitespace-nowrap">
        <div className="w-7 h-7 rounded-sm flex items-center justify-center shrink-0 bg-primary text-black">
          <Zap size={16} />
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.15, ease: EASE }}
              className="font-bold text-[13px] tracking-wider text-text"
            >
              SWARM IDE
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Nav items */}
      <nav aria-label="Main navigation" className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
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
                className={`flex items-center gap-2 py-2 px-3 mx-1 rounded-sm cursor-pointer ${
                  active && !hasChildren ? "bg-card" : "bg-transparent"
                } ${groupActive ? "text-primary" : "text-text-secondary"}`}
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
                  className="flex items-center gap-2 flex-1 min-w-0 text-inherit no-underline"
                  aria-current={active && !hasChildren ? "page" : undefined}
                  onClick={(e) => {
                    if (hasChildren) {
                      e.preventDefault();
                      toggleGroup(item.key);
                    }
                  }}
                >
                  <Icon size={18} className="shrink-0" aria-hidden="true" />
                  <AnimatePresence>
                    {!collapsed && (
                      <motion.span
                        initial={{ opacity: 0, width: 0 }}
                        animate={{ opacity: 1, width: "auto" }}
                        exit={{ opacity: 0, width: 0 }}
                        transition={{ duration: 0.2, ease: EASE }}
                        className="text-[13px] overflow-hidden text-ellipsis whitespace-nowrap"
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
                      className="ml-auto text-[11px] flex"
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
                    className="overflow-hidden ml-4"
                  >
                    <div className="mb-1">
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
                            className="rounded-sm mx-1"
                          >
                            <Link
                              href={child.href}
                              className={`flex items-center gap-2 py-1.5 px-3 text-[13px] no-underline ${
                                childActive ? "bg-card text-primary" : "bg-transparent text-text-secondary"
                              }`}
                              aria-current={childActive ? "page" : undefined}
                            >
                              <ChildIcon size={14} className="shrink-0" aria-hidden="true" />
                              <span className="overflow-hidden text-ellipsis whitespace-nowrap">{child.label}</span>
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
        className="flex items-center justify-center h-10 shrink-0 bg-transparent cursor-pointer border-0 border-t border-border text-text-secondary"
        aria-label={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
      >
        <motion.span
          animate={{ rotate: collapsed ? 180 : 0 }}
          transition={{ duration: prefersReduced ? 0.1 : 0.25, ease: EASE }}
          className="flex"
        >
          <ChevronLeft size={16} />
        </motion.span>
      </motion.button>
    </motion.aside>
  );
});

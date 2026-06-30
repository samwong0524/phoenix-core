"use client";

import { memo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

interface NavChild {
  label: string;
  href: string;
  icon: React.ElementType;
}

interface NavItem {
  label: string;
  icon: React.ElementType;
  href: string;
  children?: NavChild[];
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "对话",
    icon: MessageSquare,
    href: ROUTES.CHAT,
  },
  {
    label: "编排",
    icon: Workflow,
    href: ROUTES.WORKFLOW,
    children: [
      { label: "工作流", href: ROUTES.WORKFLOW, icon: Workflow },
      { label: "流水线", href: ROUTES.PIPELINE, icon: Zap },
      { label: "拓扑", href: ROUTES.GRAPH, icon: Activity },
    ],
  },
  {
    label: "运维",
    icon: Activity,
    href: ROUTES.MONITOR,
    children: [
      { label: "监控", href: ROUTES.MONITOR, icon: Activity },
      { label: "历史", href: ROUTES.HISTORY, icon: MessageSquare },
      { label: "模型", href: ROUTES.MODELS, icon: Settings },
    ],
  },
  {
    label: "配置",
    icon: Settings,
    href: ROUTES.SKILLS,
    children: [
      { label: "技能", href: ROUTES.SKILLS, icon: Settings },
      { label: "设置", href: ROUTES.SETTINGS, icon: Settings },
    ],
  },
];

const SIDEBAR_WIDTH = 220;
const SIDEBAR_COLLAPSED = 56;

export const GlobalSidebar = memo(function GlobalSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(["编排", "运维", "配置"])
  );

  const width = collapsed ? SIDEBAR_COLLAPSED : SIDEBAR_WIDTH;

  const toggleGroup = (label: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  };

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <aside
      role="navigation"
      aria-label="Main navigation"
      style={{
        width,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRight: "1px solid var(--border)",
        transition: "all 0.2s",
        backgroundColor: "var(--bg-panel)",
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
        {!collapsed && (
          <span
            style={{ fontWeight: 700, fontSize: 13, letterSpacing: "0.05em", color: "var(--text-primary)" }}
          >
            SWARM IDE
          </span>
        )}
      </div>

      {/* Nav items */}
      <nav style={{ flex: 1, padding: "var(--space-2) 0", overflowY: "auto" }}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          const expanded = expandedGroups.has(item.label);
          const hasChildren = item.children && item.children.length > 0;
          const groupActive = hasChildren
            ? item.children!.some((c) => isActive(c.href))
            : active;

          return (
            <div key={item.label}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-2)",
                  padding: "var(--space-2) var(--space-3)",
                  margin: "0 var(--space-1)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                  transition: "color 0.15s",
                  backgroundColor:
                    active && !hasChildren
                      ? "var(--bg-card)"
                      : "transparent",
                  color: groupActive
                    ? "var(--accent-cyan)"
                    : "var(--text-secondary)",
                }}
                onClick={() => {
                  if (hasChildren) toggleGroup(item.label);
                }}
                {...(hasChildren ? { "aria-expanded": expanded } : {})}
              >
                <Link
                  href={item.href}
                  style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flex: 1, minWidth: 0, color: "inherit", textDecoration: "none" }}
                  aria-current={active && !hasChildren ? "page" : undefined}
                  onClick={(e) => {
                    if (hasChildren) {
                      // clicking the icon/label area toggles the group
                      e.preventDefault();
                      toggleGroup(item.label);
                    }
                  }}
                >
                  <Icon size={18} style={{ flexShrink: 0 }} />
                  {!collapsed && (
                    <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
                  )}
                </Link>
                {!collapsed && hasChildren && (
                  <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.5 }}>
                    {expanded ? (
                      <ChevronLeft size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </span>
                )}
              </div>

              {/* Sub-items */}
              {!collapsed && hasChildren && expanded && (
                <div style={{ marginLeft: 16, marginBottom: 4 }}>
                  {item.children!.map((child) => {
                    const ChildIcon = child.icon;
                    const childActive = isActive(child.href);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-2)",
                          padding: "6px var(--space-3)",
                          margin: "0 var(--space-1)",
                          borderRadius: "var(--radius-sm)",
                          fontSize: 13,
                          transition: "color 0.15s",
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
                        <ChildIcon size={14} style={{ flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: 40,
          borderTop: "1px solid var(--border)",
          transition: "color 0.15s",
          flexShrink: 0,
          background: "transparent",
          cursor: "pointer",
          border: "none",
          borderTopWidth: 1,
          borderTopStyle: "solid",
          borderTopColor: "var(--border)",
          color: "var(--text-secondary)",
        }}
        aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </aside>
  );
});

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
    children: [{ label: "技能", href: ROUTES.SKILLS, icon: Settings }],
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
      className="flex flex-col h-full border-r transition-all duration-200"
      style={{
        width,
        borderColor: "var(--border)",
        backgroundColor: "var(--bg-panel)",
      }}
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2 px-3 h-12 border-b shrink-0"
        style={{ borderColor: "var(--border)" }}
      >
        <div
          className="w-7 h-7 rounded flex items-center justify-center shrink-0"
          style={{ backgroundColor: "var(--accent-cyan)", color: "#000" }}
        >
          <Zap size={16} />
        </div>
        {!collapsed && (
          <span
            className="font-bold text-sm tracking-wide"
            style={{ color: "var(--text-primary)" }}
          >
            PHOENIX
          </span>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 py-2 overflow-y-auto">
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
                className="flex items-center gap-2 px-3 py-2 mx-1 rounded cursor-pointer transition-colors"
                style={{
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
                  className="flex items-center gap-2 flex-1 min-w-0"
                  style={{ color: "inherit", textDecoration: "none" }}
                  aria-current={active && !hasChildren ? "page" : undefined}
                  onClick={(e) => {
                    if (hasChildren) {
                      // clicking the icon/label area toggles the group
                      e.preventDefault();
                      toggleGroup(item.label);
                    }
                  }}
                >
                  <Icon size={18} className="shrink-0" />
                  {!collapsed && (
                    <span className="text-sm truncate">{item.label}</span>
                  )}
                </Link>
                {!collapsed && hasChildren && (
                  <span className="ml-auto text-xs opacity-50">
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
                <div className="ml-4 mb-1">
                  {item.children!.map((child) => {
                    const ChildIcon = child.icon;
                    const childActive = isActive(child.href);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className="flex items-center gap-2 px-3 py-1.5 mx-1 rounded text-sm transition-colors"
                        style={{
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
                        <ChildIcon size={14} className="shrink-0" />
                        <span className="truncate">{child.label}</span>
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
        className="flex items-center justify-center h-10 border-t transition-colors shrink-0"
        style={{
          borderColor: "var(--border)",
          color: "var(--text-secondary)",
        }}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </aside>
  );
});

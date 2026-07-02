"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquare, Workflow, Activity } from "lucide-react";
import { useIsMobile } from "@/lib/use-media-query";
import { ROUTES } from "@/app/_components/routes";

interface TabItem {
  key: string;
  label: string;
  href: string;
  icon: React.ElementType;
  match: (path: string) => boolean;
}

const TABS: TabItem[] = [
  {
    key: "chat",
    label: "Chat",
    href: ROUTES.CHAT,
    icon: MessageSquare,
    match: (p) => p === ROUTES.CHAT || p.startsWith(ROUTES.CHAT + "/"),
  },
  {
    key: "workflow",
    label: "Workflow",
    href: ROUTES.WORKFLOW,
    icon: Workflow,
    match: (p) => p === ROUTES.WORKFLOW || p.startsWith(ROUTES.WORKFLOW + "/"),
  },
  {
    key: "monitor",
    label: "Monitor",
    href: ROUTES.MONITOR,
    icon: Activity,
    match: (p) =>
      p === ROUTES.MONITOR ||
      p.startsWith(ROUTES.MONITOR + "/") ||
      p === ROUTES.HISTORY ||
      p.startsWith(ROUTES.HISTORY + "/") ||
      p === ROUTES.GRAPH ||
      p.startsWith(ROUTES.GRAPH + "/"),
  },
];

export function MobileTabBar() {
  const pathname = usePathname();
  const isMobile = useIsMobile();

  if (!isMobile) return null;

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed bottom-0 left-0 right-0 z-[1000] flex items-stretch border-t border-border bg-panel safe-bottom"
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 no-underline transition-colors ${
              active
                ? "text-primary"
                : "text-text-dim hover:text-text-secondary"
            }`}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={20} aria-hidden="true" />
            <span className="text-[10px] font-medium leading-none">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

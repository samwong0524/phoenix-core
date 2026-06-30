"use client";

import { memo } from "react";
import { usePathname } from "next/navigation";
import { GlobalSidebar } from "./global-sidebar";
import { ROUTES } from "./routes";

const SIDEBAR_EXCLUDED_PATHS = [ROUTES.LOGIN];

export const AppLayout = memo(function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const hideSidebar = SIDEBAR_EXCLUDED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );

  if (hideSidebar) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: "var(--bg-void)" }}>
      <GlobalSidebar />
      <main id="main-content" className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
});

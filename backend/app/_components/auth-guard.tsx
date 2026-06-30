/* eslint-disable react-hooks/set-state-in-effect -- Auth guard requires async state check on mount */
"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { ROUTES } from "./routes";

/**
 * Client-side auth guard.
 * - Calls GET /api/auth/me on mount
 * - If 401 (auth enabled but no session), redirects to login page
 * - If devMode (AUTH_SECRET not set), passes through
 * - Skips check on login page itself
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    // Don't guard the login page
    if (pathname === ROUTES.LOGIN) {
      setChecked(true);
      return;
    }

    async function check() {
      try {
        const res = await fetch("/api/auth/me", { credentials: "include" });
        const data = await res.json();

        if (data.devMode) {
          // Auth not enabled — pass through
          setChecked(true);
          return;
        }

        if (!res.ok || !data.user) {
          // Not authenticated — redirect to login
          router.replace(ROUTES.LOGIN);
          return;
        }

        setChecked(true);
      } catch {
        // Network error — let it through (dev mode likely)
        setChecked(true);
      }
    }

    check();
  }, [pathname, router]);

  // Don't render children until auth check completes
  if (!checked) {
    if (pathname === ROUTES.LOGIN) return <>{children}</>;
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--bg-void, #0a0a0a)" }}
      >
        <div
          className="text-sm animate-pulse"
          style={{ color: "var(--cyan, #38bdf8)", fontFamily: "'Orbitron', sans-serif" }}
        >
          SWARM IDE
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

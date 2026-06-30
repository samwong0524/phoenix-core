/**
 * Next.js Middleware — Phoenix-Core Auth
 *
 * Protects all /api/* routes when AUTH_SECRET is set.
 * Exempts: /api/auth/*, /api/health, /api/admin/init-db, /api/admin/clear-db
 *
 * When AUTH_SECRET is NOT set (dev mode), all requests pass through.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Routes that never require auth
const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/health",
];

// Admin-only routes (require admin role — checked in route handlers, not here)
// Middleware only checks for valid token presence

/**
 * Old English route → new Chinese route 301 redirect map.
 * Entries are checked in order; first match wins.
 * Each key is a prefix — both the exact path and any sub-path redirect
 * to the corresponding new path (with sub-path appended).
 */
const REDIRECT_MAP: Record<string, string> = {
  "/im":                "/对话",
  "/workflow/templates": "/编排/模板",
  "/workflow":          "/编排/工作流",
  "/pipeline":          "/编排/流水线",
  "/graph":             "/编排/拓扑",
  "/observability":     "/运维/监控",
  "/history":           "/运维/历史",
  "/models":            "/运维/模型",
  "/skills":            "/配置/技能",
  "/login":             "/登录",
  "/test":              "/测试",
};

// Sorted keys (longest first) so that e.g. /workflow/templates matches before /workflow
const REDIRECT_KEYS = Object.keys(REDIRECT_MAP).sort(
  (a, b) => b.length - a.length,
);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── 301 redirects from old English routes to new Chinese routes ──────────
  for (const oldPrefix of REDIRECT_KEYS) {
    if (pathname === oldPrefix || pathname.startsWith(oldPrefix + "/")) {
      const newBase = REDIRECT_MAP[oldPrefix];
      const suffix = pathname.slice(oldPrefix.length); // "" or "/..."
      const target = new URL(newBase + suffix, request.url);
      // Preserve query string
      target.search = request.nextUrl.search;
      return NextResponse.redirect(target, 301);
    }
  }

  // ── API auth logic (unchanged) ───────────────────────────────────────────

  // Only protect /api/* routes
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Allow public API routes
  for (const prefix of PUBLIC_API_PREFIXES) {
    if (pathname.startsWith(prefix) || pathname === prefix.replace(/\/$/, "")) {
      return NextResponse.next();
    }
  }

  // If AUTH_SECRET is not set, dev mode — pass through
  if (!process.env.AUTH_SECRET) {
    return NextResponse.next();
  }

  // Check for phoenix-token cookie
  const token = request.cookies.get("phoenix-token");
  if (!token) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Please log in to continue" },
      { status: 401 }
    );
  }

  // Let the route handler verify the token (it has DB access for user lookup)
  // Middleware just checks cookie presence to avoid DB calls in middleware
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Old English routes (301-redirected to new Chinese routes)
     * + all /api/* paths.
     *
     * Excludes:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     */
    "/api/:path*",
    "/im/:path*",
    "/workflow/:path*",
    "/pipeline/:path*",
    "/graph/:path*",
    "/observability/:path*",
    "/history/:path*",
    "/models/:path*",
    "/skills/:path*",
    "/login",
    "/test/:path*",
  ],
};

/**
 * Next.js Middleware — Phoenix-Core Auth
 *
 * Protects all /api/* routes when AUTH_SECRET is set.
 * Exempts: /api/auth/*, /api/health
 *
 * When AUTH_SECRET is NOT set (dev mode), all requests pass through.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Routes that never require auth
const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/health",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
  if (!token?.value) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Please log in to continue" },
      { status: 401 }
    );
  }

  // Verify JWT signature and expiration
  try {
    const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
    await jwtVerify(token.value, secret);
  } catch {
    return NextResponse.json(
      { error: "Unauthorized", message: "Invalid or expired token" },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * All /api/* paths.
     *
     * Excludes:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     */
    "/api/:path*",
  ],
};

/**
 * Phoenix-Core Auth — Lightweight JWT authentication
 *
 * Design decisions:
 * - jose for JWT (Edge-compatible, no Node crypto dependency)
 * - bcryptjs for password hashing (pure JS, works everywhere)
 * - JWT stored in httpOnly cookie ("phoenix-token")
 * - First registered user becomes admin
 * - DEV_MODE: when AUTH_SECRET is not set, all requests pass (backward compat)
 */

import { SignJWT, jwtVerify } from "jose";
import { hash, compare } from "bcryptjs";

// ─── Types ────────────────────────────────────────────

export type UserRole = "admin" | "member" | "viewer";

export type JWTPayload = {
  sub: string;       // user id
  email: string;
  role: UserRole;
  iat?: number;
  exp?: number;
};

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
};

// ─── Config ───────────────────────────────────────────

const COOKIE_NAME = "phoenix-token";
const JWT_EXPIRES_IN = "7d";

function getSecret(): Uint8Array | null {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

/** Auth is enabled only when AUTH_SECRET is set. Otherwise dev-mode: all pass. */
export function isAuthEnabled(): boolean {
  return !!process.env.AUTH_SECRET;
}

// ─── JWT ──────────────────────────────────────────────

export async function signToken(payload: Omit<JWTPayload, "iat" | "exp">): Promise<string> {
  const secret = getSecret();
  if (!secret) throw new Error("AUTH_SECRET not set");

  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRES_IN)
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  const secret = getSecret();
  if (!secret) return null;

  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

// ─── Cookie helpers ───────────────────────────────────

export function getTokenFromRequest(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";").map(c => c.trim());
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.split("=");
    if (name.trim() === COOKIE_NAME) {
      return valueParts.join("=").trim();
    }
  }
  return null;
}

export function createTokenCookie(token: string): string {
  const maxAge = 7 * 24 * 60 * 60; // 7 days in seconds
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearTokenCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ─── Password ─────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return compare(password, hashedPassword);
}

// ─── Session extraction ───────────────────────────────

/** Extract and verify user session from request. Returns null if not authenticated. */
export async function getSession(req: Request): Promise<SessionUser | null> {
  const token = getTokenFromRequest(req);
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;

  // Look up user in DB to get name and verify they still exist
  try {
    const { getDb } = await import("@/db");
    const { users } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const db = getDb();
    const rows = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    }).from(users).where(eq(users.id, payload.sub)).limit(1);

    if (rows.length === 0) return null;
    const user = rows[0];

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
    };
  } catch {
    // DB not available — fall back to JWT claims only
    return {
      id: payload.sub,
      email: payload.email,
      name: null,
      role: payload.role,
    };
  }
}

/** Require authentication — returns session or throws. */
export async function requireSession(req: Request): Promise<SessionUser> {
  const session = await getSession(req);
  if (!session) {
    throw new AuthError("Unauthorized", 401);
  }
  return session;
}

/** Require specific role — returns session or throws. */
export async function requireRole(req: Request, role: UserRole): Promise<SessionUser> {
  const session = await requireSession(req);
  if (session.role !== role && session.role !== "admin") {
    throw new AuthError("Forbidden", 403);
  }
  return session;
}

// ─── Error class ──────────────────────────────────────

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "AuthError";
  }
}

// ─── OAuth ────────────────────────────────────────────

export interface OAuthProvider {
  id: string;
  name: string;
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string;
}

export function getOAuthProvider(provider: string): OAuthProvider | null {
  switch (provider) {
    case "github":
      if (!process.env.GITHUB_CLIENT_ID || !process.env.GITHUB_CLIENT_SECRET) return null;
      return {
        id: "github",
        name: "GitHub",
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET,
        authorizeUrl: "https://github.com/login/oauth/authorize",
        tokenUrl: "https://github.com/login/oauth/access_token",
        userInfoUrl: "https://api.github.com/user",
        scope: "read:user user:email",
      };
    case "google":
      if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null;
      return {
        id: "google",
        name: "Google",
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
        scope: "openid email profile",
      };
    default:
      return null;
  }
}

export function buildOAuthAuthorizeUrl(provider: OAuthProvider, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    scope: provider.scope,
    state,
    response_type: "code",
  });
  if (provider.id === "google") {
    params.set("access_type", "offline");
  }
  return `${provider.authorizeUrl}?${params.toString()}`;
}

export async function exchangeOAuthCode(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<{ access_token: string } | null> {
  const body: Record<string, string> = {
    client_id: provider.clientId,
    client_secret: provider.clientSecret,
    code,
    redirect_uri: redirectUri,
  };
  if (provider.id === "github") {
    body.accept = "json";
  } else {
    body.grant_type = "authorization_code";
  }

  const res = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(provider.id === "github" ? { Accept: "application/json" } : {}),
    },
    body: new URLSearchParams(body).toString(),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token ? { access_token: data.access_token } : null;
}

export async function fetchOAuthUserInfo(
  provider: OAuthProvider,
  accessToken: string,
): Promise<{ id: string; email: string; name: string } | null> {
  const res = await fetch(provider.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();

  if (provider.id === "github") {
    // GitHub may not include email in the user endpoint
    let email = data.email;
    if (!email) {
      const emailRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (emailRes.ok) {
        const emails = await emailRes.json();
        const primary = emails.find((e: { primary: boolean; verified: boolean }) => e.primary && e.verified);
        if (primary) email = primary.email;
      }
    }
    return {
      id: String(data.id),
      email: email ?? `${data.login}@github.com`,
      name: data.name ?? data.login,
    };
  }

  // Google
  return { id: data.id, email: data.email, name: data.name ?? data.email };
}

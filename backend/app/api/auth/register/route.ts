export const runtime = "nodejs";

import { randomUUID } from "crypto";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  hashPassword,
  signToken,
  createTokenCookie,
  isAuthEnabled,
  type UserRole,
} from "@/lib/auth";

export async function POST(req: Request) {
  try {
    // If auth is not enabled, return 404
    if (!isAuthEnabled()) {
      return Response.json(
        { error: "Registration is disabled in development mode. Set AUTH_SECRET to enable." },
        { status: 404 }
      );
    }

    const body = (await req.json().catch(() => null)) as {
      email?: string;
      password?: string;
      name?: string;
    } | null;

    const email = body?.email?.trim().toLowerCase();
    const password = body?.password;
    const name = body?.name?.trim() || null;

    if (!email || !password) {
      return Response.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    // Password strength: at least 6 characters
    if (password.length < 6) {
      return Response.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    const db = getDb();

    // Check if email already exists
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return Response.json(
        { error: "Email already registered" },
        { status: 409 }
      );
    }

    // First user becomes admin
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(users);
    const userCount = countResult[0]?.count ?? 0;
    const role: UserRole = userCount === 0 ? "admin" : "member";

    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    const createdAt = new Date();

    await db.insert(users).values({
      id,
      email,
      name,
      passwordHash,
      role,
      createdAt,
    });

    const token = await signToken({ sub: id, email, role });
    const cookie = createTokenCookie(token);

    return Response.json(
      {
        user: { id, email, name, role },
        isFirstUser: userCount === 0,
      },
      {
        status: 201,
        headers: { "Set-Cookie": cookie },
      }
    );
  } catch (e) {
    console.error("[auth/register]", e);
    return Response.json(
      {
        error: "Registration failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}

export const runtime = "nodejs";

import { getDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  verifyPassword,
  signToken,
  createTokenCookie,
  isAuthEnabled,
} from "@/lib/auth";

export async function POST(req: Request) {
  try {
    if (!isAuthEnabled()) {
      return Response.json(
        { error: "Login is disabled in development mode. Set AUTH_SECRET to enable." },
        { status: 404 }
      );
    }

    const body = (await req.json().catch(() => null)) as {
      email?: string;
      password?: string;
    } | null;

    const email = body?.email?.trim().toLowerCase();
    const password = body?.password;

    if (!email || !password) {
      return Response.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const db = getDb();

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        passwordHash: users.passwordHash,
        role: users.role,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (rows.length === 0) {
      return Response.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const user = rows[0];
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return Response.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const token = await signToken({
      sub: user.id,
      email: user.email,
      role: user.role as "admin" | "member" | "viewer",
    });
    const cookie = createTokenCookie(token);

    return Response.json(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      },
      {
        status: 200,
        headers: { "Set-Cookie": cookie },
      }
    );
  } catch (e) {
    console.error("[auth/login]", e);
    return Response.json(
      {
        error: "Login failed",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}

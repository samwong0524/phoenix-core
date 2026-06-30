export const runtime = "nodejs";

import { getSession, isAuthEnabled } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    // If auth is not enabled, return a dev-mode pass-through
    if (!isAuthEnabled()) {
      return Response.json({
        user: null,
        devMode: true,
        message: "Auth disabled — set AUTH_SECRET to enable",
      });
    }

    const session = await getSession(req);
    if (!session) {
      return Response.json({ user: null }, { status: 401 });
    }

    return Response.json({ user: session });
  } catch (e) {
    console.error("[auth/me]", e);
    return Response.json(
      { error: "Failed to get session" },
      { status: 500 }
    );
  }
}

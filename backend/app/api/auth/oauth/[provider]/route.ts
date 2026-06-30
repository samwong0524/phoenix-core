import { NextRequest } from "next/server";
import { getOAuthProvider, buildOAuthAuthorizeUrl, isAuthEnabled } from "@/lib/auth";
import { cookies } from "next/headers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  if (!isAuthEnabled()) {
    return Response.json({ error: "Auth not enabled" }, { status: 400 });
  }

  const { provider: providerId } = await params;

  // Avoid matching "providers" as a provider name
  if (providerId === "providers") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const provider = getOAuthProvider(providerId);
  if (!provider) {
    return Response.json({ error: "Provider not configured" }, { status: 404 });
  }

  const state = crypto.randomUUID();
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3100";
  const redirectUri = `${baseUrl}/api/auth/oauth/${providerId}/callback`;

  // Store state in cookie for CSRF verification
  const cookieStore = await cookies();
  cookieStore.set(`oauth-state-${providerId}`, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600, // 10 minutes
    path: "/",
  });

  const url = buildOAuthAuthorizeUrl(provider, redirectUri, state);
  return Response.redirect(url);
}

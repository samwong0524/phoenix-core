import { NextRequest } from "next/server";
import {
  getOAuthProvider,
  exchangeOAuthCode,
  fetchOAuthUserInfo,
  signToken,
  createTokenCookie,
} from "@/lib/auth";
import { getSql } from "@/db/client";
import { cookies } from "next/headers";
import { ROUTES } from "@/app/_components/routes";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerId } = await params;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3100";
  const redirectUri = `${baseUrl}/api/auth/oauth/${providerId}/callback`;

  // Verify CSRF state
  const cookieStore = await cookies();
  const savedState = cookieStore.get(`oauth-state-${providerId}`)?.value;
  const returnedState = req.nextUrl.searchParams.get("state");
  if (!savedState || savedState !== returnedState) {
    return Response.redirect(`${baseUrl}${ROUTES.LOGIN}?error=oauth_state_mismatch`);
  }
  cookieStore.delete(`oauth-state-${providerId}`);

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return Response.redirect(`${baseUrl}${ROUTES.LOGIN}?error=oauth_no_code`);
  }

  const provider = getOAuthProvider(providerId);
  if (!provider) {
    return Response.redirect(`${baseUrl}${ROUTES.LOGIN}?error=oauth_provider_not_found`);
  }

  // Exchange authorization code for access token
  const tokenResult = await exchangeOAuthCode(provider, code, redirectUri);
  if (!tokenResult) {
    return Response.redirect(`${baseUrl}${ROUTES.LOGIN}?error=oauth_token_exchange_failed`);
  }

  // Fetch user profile from provider
  const userInfo = await fetchOAuthUserInfo(provider, tokenResult.access_token);
  if (!userInfo) {
    return Response.redirect(`${baseUrl}${ROUTES.LOGIN}?error=oauth_userinfo_failed`);
  }

  // Find or create user in database
  const sql = getSql();
  let user: any;

  const existing = await sql`SELECT * FROM users WHERE email = ${userInfo.email} LIMIT 1`;
  if (existing.length > 0) {
    user = existing[0];
  } else {
    // Auto-create user from OAuth login
    const isFirstUser =
      (await sql`SELECT COUNT(*)::int AS cnt FROM users`)[0].cnt === 0;
    const [newUser] = await sql`
      INSERT INTO users (id, email, name, password_hash, role, created_at)
      VALUES (
        ${crypto.randomUUID()},
        ${userInfo.email},
        ${userInfo.name},
        ${"oauth:" + providerId + ":" + userInfo.id},
        ${isFirstUser ? "admin" : "member"},
        NOW()
      )
      RETURNING *
    `;
    user = newUser;
  }

  // Sign JWT and set cookie
  const token = await signToken({
    sub: user.id,
    email: user.email,
    role: user.role,
  });

  const response = Response.redirect(`${baseUrl}/`);
  response.headers.append("Set-Cookie", createTokenCookie(token));
  return response;
}

export const runtime = "nodejs";

import { clearTokenCookie } from "@/lib/auth";

export async function POST() {
  return Response.json(
    { ok: true },
    {
      status: 200,
      headers: { "Set-Cookie": clearTokenCookie() },
    }
  );
}

export async function GET() {
  return Response.json(
    { ok: true },
    {
      status: 200,
      headers: { "Set-Cookie": clearTokenCookie() },
    }
  );
}

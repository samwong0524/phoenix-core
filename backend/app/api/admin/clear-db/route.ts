export const runtime = "nodejs";

import { getSql } from "@/db/client";

export async function POST(req: Request) {
  // Require ADMIN_SECRET header to prevent unauthorized database wipes
  const adminSecret = process.env.ADMIN_SECRET;
  const provided = req.headers.get("x-admin-secret");
  if (!adminSecret || provided !== adminSecret) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sql = getSql();

  // Wipes all workspace-scoped data.
  // UUID PKs mean RESTART IDENTITY has no practical effect, but it's harmless.
  await sql/* sql */ `
    truncate table
      messages,
      group_members,
      groups,
      agents,
      workspaces
    restart identity cascade;
  `;

  return Response.json({ ok: true });
}


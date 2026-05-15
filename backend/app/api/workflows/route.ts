export const runtime = "nodejs";

import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const groupId = url.searchParams.get("groupId");
  const db = getDb();

  const where = groupId
    ? sql`WHERE group_id = ${groupId}`
    : sql`WHERE 1=1`;

  const rows = await db.execute(
    sql`SELECT id, group_id, name, description, creator_id, status,
               created_at, updated_at
        FROM workflows ${where} ORDER BY updated_at DESC`
  );
  const workflows = ((rows as unknown as Array<Record<string, unknown> | null>) ?? []).filter(Boolean);

  return Response.json({ workflows });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    groupId: string;
    name: string;
    description?: string;
    creatorId: string;
  };

  if (!body.groupId || !body.name || !body.creatorId) {
    return Response.json({ error: "Missing required fields: groupId, name, creatorId" }, { status: 400 });
  }

  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    sql`INSERT INTO workflows (id, group_id, name, description, creator_id, status, created_at, updated_at)
        VALUES (${id}, ${body.groupId}, ${body.name}, ${body.description ?? null},
                ${body.creatorId}, 'draft', ${now}, ${now})`
  );

  return Response.json({ id, name: body.name, status: "draft" }, { status: 201 });
}

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
    dsl?: {
      nodes: Array<{
        id: string;
        type: string;
        data: { label?: string; role?: string; description?: string; expectedOutput?: string };
      }>;
      edges: Array<{ id: string; source: string; target: string }>;
    };
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

  // Create tasks from DSL if provided
  if (body.dsl) {
    const nodeMap = new Map<string, string>();
    for (const n of body.dsl.nodes) {
      if (n.type === "agent") {
        nodeMap.set(n.id, n.data.label || n.id);
      }
    }

    for (const n of body.dsl.nodes) {
      if (n.type !== "agent") continue;

      const dependsOn = body.dsl.edges
        .filter((e) => e.target === n.id)
        .map((e) => nodeMap.get(e.source))
        .filter(Boolean);

      const taskId = crypto.randomUUID();
      await db.execute(
        sql`INSERT INTO tasks (id, workflow_id, name, description, assignee_role, expected_output, depends_on, status, created_at)
            VALUES (${taskId}, ${id}, ${n.data.label || "Untitled Step"},
                    ${n.data.description ?? null}, ${n.data.role ?? null},
                    ${n.data.expectedOutput ?? null}, ${dependsOn},
                    'pending', ${now})`
      );
    }
  }

  return Response.json({ workflowId: id, name: body.name, status: "draft" }, { status: 201 });
}

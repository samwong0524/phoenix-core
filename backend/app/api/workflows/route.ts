export const runtime = "nodejs";

import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const groupId = url.searchParams.get("groupId");
  const includeSummary = url.searchParams.get("includeSummary") === "true";
  const workspaceId = url.searchParams.get("workspaceId");
  const db = getDb();

  // Build WHERE clause
  let whereClause = sql`WHERE 1=1`;
  if (groupId) {
    whereClause = sql`WHERE w.group_id = ${groupId}`;
  }
  if (workspaceId) {
    whereClause = sql`WHERE g.workspace_id = ${workspaceId}`;
  }

  if (includeSummary) {
    // Join with groups for workspaceId filter, aggregate task counts
    const joinGroup = workspaceId
      ? sql`JOIN groups g ON g.id = w.group_id`
      : sql``;

    const rows = await db.execute(sql`
      SELECT w.id, w.group_id, w.name, w.description, w.creator_id, w.status,
             w.created_at, w.updated_at,
             COUNT(t.id) as total_tasks,
             COUNT(t.id) FILTER (WHERE t.status IN ('completed', 'reviewed')) as completed_tasks,
             COUNT(t.id) FILTER (WHERE t.status = 'failed') as failed_tasks,
             COUNT(t.id) FILTER (WHERE t.status = 'pending') as pending_tasks,
             COUNT(t.id) FILTER (WHERE t.status = 'in_progress') as in_progress_tasks
      FROM workflows w
      ${joinGroup}
      LEFT JOIN tasks t ON t.workflow_id = w.id
      ${whereClause}
      GROUP BY w.id
      ORDER BY w.updated_at DESC
    `);

    const workflows = ((rows as unknown as Array<Record<string, unknown> | null>) ?? []).filter((w): w is Record<string, unknown> => w !== null).map((w) => ({
      ...w,
      taskSummary: {
        total: Number(w.total_tasks) || 0,
        completed: Number(w.completed_tasks) || 0,
        failed: Number(w.failed_tasks) || 0,
        pending: Number(w.pending_tasks) || 0,
        inProgress: Number(w.in_progress_tasks) || 0,
      },
    }));

    return Response.json({ workflows });
  }

  // Original query without summary
  const joinGroup = workspaceId
    ? sql`JOIN groups g ON g.id = workflows.group_id`
    : sql``;

  if (workspaceId) {
    whereClause = sql`WHERE g.workspace_id = ${workspaceId}`;
  }

  const rows = await db.execute(
    sql`SELECT workflows.id, workflows.group_id, workflows.name, workflows.description,
               workflows.creator_id, workflows.status, workflows.created_at, workflows.updated_at
        FROM workflows ${joinGroup} ${whereClause} ORDER BY workflows.updated_at DESC`
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

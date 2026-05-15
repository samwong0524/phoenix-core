export const runtime = "nodejs";

import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const { workflowId } = await params;
  const db = getDb();

  const wfRows = await db.execute(
    sql`SELECT id FROM workflows WHERE id = ${workflowId}`
  );
  if ((wfRows as unknown as Array<{ id: string }>)[0] === undefined) {
    return Response.json({ error: "Workflow not found" }, { status: 404 });
  }

  const rows = await db.execute(
    sql`SELECT id, name, description, assignee_role, assignee_id, status,
               depends_on, expected_output, result, review_notes,
               review_count, max_revisions, error,
               created_at, started_at, reviewed_at, completed_at
        FROM tasks WHERE workflow_id = ${workflowId}
        ORDER BY created_at ASC`
  );
  const tasks = ((rows as unknown as Array<Record<string, unknown> | null>) ?? []).filter(Boolean);

  return Response.json({ workflowId, tasks });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const { workflowId } = await params;
  const body = (await req.json()) as {
    name: string;
    description?: string;
    assigneeRole?: string;
    expectedOutput?: string;
    dependsOn?: string[];
  };

  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.execute(
    sql`INSERT INTO tasks (id, workflow_id, name, description, assignee_role,
              expected_output, status, depends_on, created_at)
        VALUES (${id}, ${workflowId}, ${body.name}, ${body.description ?? null},
                ${body.assigneeRole ?? null}, ${body.expectedOutput ?? null},
                'pending', ${body.dependsOn ?? []}, ${now})`
  );

  await db.execute(
    sql`INSERT INTO task_logs (id, task_id, event_type, event_data, created_at)
        VALUES (gen_random_uuid(), ${id}, 'task_created',
                jsonb_build_object('name', ${body.name}), ${now})`
  );

  return Response.json({ id, name: body.name, status: "pending" }, { status: 201 });
}

export const runtime = "nodejs";

import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const { workflowId } = await params;
  const db = getDb();

  const rows = await db.execute(
    sql`SELECT id, status, name FROM workflows WHERE id = ${workflowId}`
  );
  const wf = (rows as unknown as Array<{ id: string; status: string; name: string }>)[0];
  if (!wf) {
    return Response.json({ error: "Workflow not found" }, { status: 404 });
  }
  if (wf.status !== "draft") {
    return Response.json(
      { error: `Cannot activate workflow from status: ${wf.status}` },
      { status: 400 }
    );
  }

  await db.execute(
    sql`UPDATE workflows SET status = 'active', updated_at = ${new Date().toISOString()} WHERE id = ${workflowId}`
  );

  await db.execute(
    sql`INSERT INTO task_logs (id, task_id, event_type, event_data, created_at)
      SELECT gen_random_uuid(), id, 'workflow_activated',
             jsonb_build_object('workflow_id', ${workflowId}),
             now()
      FROM tasks WHERE workflow_id = ${workflowId}`
  );

  return Response.json({ id: workflowId, name: wf.name, status: "active" });
}

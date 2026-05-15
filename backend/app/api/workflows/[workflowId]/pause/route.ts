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
  if (wf.status !== "active") {
    return Response.json(
      { error: `Cannot pause workflow from status: ${wf.status}` },
      { status: 400 }
    );
  }

  await db.execute(
    sql`UPDATE workflows SET status = 'paused', updated_at = ${new Date().toISOString()} WHERE id = ${workflowId}`
  );

  await db.execute(
    sql`INSERT INTO task_logs (id, task_id, event_data, created_at)
      SELECT gen_random_uuid(), id,
             jsonb_build_object('workflow_id', ${workflowId}, 'reason', 'manual_pause'),
             now()
      FROM tasks WHERE workflow_id = ${workflowId} AND status = 'in_progress'`
  );

  return Response.json({ id: workflowId, name: wf.name, status: "paused" });
}

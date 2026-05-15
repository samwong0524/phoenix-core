export const runtime = "nodejs";

import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;

  if (!workspaceId) {
    return Response.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  try {
    const db = getDb();

    // Collect all groups in this workspace
    const groupRows = await db.execute(
      sql`SELECT id FROM "groups" WHERE workspace_id = ${workspaceId}`
    );
    const groupIds = (groupRows as Array<{ id: string }>).map((r) => r.id);

    // Collect all workflows for cascade
    const allWorkflowRows = groupIds.length > 0
      ? await db.execute(
          sql`SELECT id FROM workflows WHERE group_id IN (${sql.join(groupIds, sql`, `)})`
        )
      : { rows: [] };
    const workflowIds = (allWorkflowRows as Array<{ id: string }>).map((r) => r.id);

    // Cascade delete within groups
    await db.transaction(async (tx) => {
      if (workflowIds.length > 0) {
        // task_logs
        await tx.execute(
          sql`DELETE FROM task_logs WHERE task_id IN (SELECT id FROM tasks WHERE workflow_id IN (${sql.join(workflowIds, sql`, `)}))`
        );
        // tasks
        await tx.execute(
          sql`DELETE FROM tasks WHERE workflow_id IN (${sql.join(workflowIds, sql`, `)})`
        );
        // agent_assignments with workflow_id
        await tx.execute(
          sql`DELETE FROM agent_assignments WHERE workflow_id IN (${sql.join(workflowIds, sql`, `)})`
        );
      }
      // agent_assignments by group_id
      if (groupIds.length > 0) {
        await tx.execute(
          sql`DELETE FROM agent_assignments WHERE group_id IN (${sql.join(groupIds, sql`, `)})`
        );
        // messages
        await tx.execute(
          sql`DELETE FROM messages WHERE workspace_id = ${workspaceId}`
        );
        // group_members
        await tx.execute(
          sql`DELETE FROM group_members WHERE group_id IN (${sql.join(groupIds, sql`, `)})`
        );
        // workflows
        await tx.execute(
          sql`DELETE FROM workflows WHERE group_id IN (${sql.join(groupIds, sql`, `)})`
        );
        // groups
        await tx.execute(
          sql`DELETE FROM "groups" WHERE workspace_id = ${workspaceId}`
        );
      }
      // backups
      await tx.execute(
        sql`DELETE FROM backups WHERE workspace_id = ${workspaceId}`
      );
    });

    // Delete all agents in this workspace (llm_history is stored in the same row)
    await db.execute(
      sql`DELETE FROM agents WHERE workspace_id = ${workspaceId}`
    );

    // Delete workspace
    await db.execute(
      sql`DELETE FROM workspaces WHERE id = ${workspaceId}`
    );

    return Response.json({ ok: true, workspaceId });
  } catch (e) {
    return Response.json(
      {
        error: "Failed to delete workspace",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}

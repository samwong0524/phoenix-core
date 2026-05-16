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
    const groupIds = ((groupRows as unknown) as Array<{ id: string }>).map((r) => r.id);

    // Collect all workflows for cascade
    const allWorkflowRows = groupIds.length > 0
      ? await db.execute(
          sql`SELECT id FROM workflows WHERE group_id IN (${sql.join(groupIds, sql`, `)})`
        )
      : [];
    const workflowIds = (allWorkflowRows as unknown as Array<{ id: string }>).map((r) => r.id);

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
      // session_archive (FK group_id → groups — MUST delete before groups)
      await tx.execute(
        sql`DELETE FROM session_archive WHERE workspace_id = ${workspaceId}`
      );
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
        // groups (after session_archive, agent_assignments, messages, group_members, workflows)
        await tx.execute(
          sql`DELETE FROM "groups" WHERE workspace_id = ${workspaceId}`
        );
      }
      // skill_usage (no FK, but agent-scoped)
      const agentRows = await tx.execute(
        sql`SELECT id FROM agents WHERE workspace_id = ${workspaceId}`
      );
      const agentIds = ((agentRows as unknown) as Array<{ id: string }>).map((r) => r.id);
      if (agentIds.length > 0) {
        await tx.execute(
          sql`DELETE FROM skill_usage WHERE agent_id IN (${sql.join(agentIds, sql`, `)})`
        );
      }
      // agents
      await tx.execute(
        sql`DELETE FROM agents WHERE workspace_id = ${workspaceId}`
      );
      // backups
      await tx.execute(
        sql`DELETE FROM backups WHERE workspace_id = ${workspaceId}`
      );
      // memories (FK workspace_id → workspaces)
      await tx.execute(
        sql`DELETE FROM memories WHERE workspace_id = ${workspaceId}`
      );
    });

    // Delete workspace (all dependent rows already removed in transaction)
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

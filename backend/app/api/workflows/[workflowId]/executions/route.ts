export const runtime = "nodejs";

import { getDb } from "@/db";
import { sql } from "drizzle-orm";

/**
 * GET /api/workflows/:workflowId/executions
 * Returns workflow execution data: workflow info + tasks with logs + summary.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const { workflowId } = await params;
  const db = getDb();

  // Fetch workflow
  const wfRows = await db.execute(
    sql`SELECT id, name, description, status, created_at, updated_at
        FROM workflows WHERE id = ${workflowId} LIMIT 1`
  );
  const wf = (wfRows as unknown as Array<{
    id: string;
    name: string;
    description: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  }>)[0];

  if (!wf) {
    return Response.json({ error: "Workflow not found" }, { status: 404 });
  }

  // Fetch all tasks for this workflow
  const taskRows = await db.execute(
    sql`SELECT id, name, description, assignee_role, assignee_id, status,
               result, error, started_at, completed_at, created_at
        FROM tasks WHERE workflow_id = ${workflowId}
        ORDER BY created_at ASC`
  );
  const rawTasks = (taskRows as unknown as Array<{
    id: string;
    name: string;
    description: string | null;
    assignee_role: string | null;
    assignee_id: string | null;
    status: string;
    result: string | null;
    error: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
  }>) ?? [];

  // Fetch all task_logs for these tasks
  const taskIds = rawTasks.map((t) => t.id);
  let logsByTaskId = new Map<string, Array<{ event_type: string; event_data: string | null; created_at: string }>>();

  if (taskIds.length > 0) {
    const logRows = await db.execute(
      sql`SELECT task_id, event_type, event_data, created_at
          FROM task_logs
          WHERE task_id = ANY(${taskIds})
          ORDER BY created_at ASC`
    );
    const logs = (logRows as unknown as Array<{
      task_id: string;
      event_type: string;
      event_data: string | null;
      created_at: string;
    }>) ?? [];

    for (const log of logs) {
      const arr = logsByTaskId.get(log.task_id) || [];
      arr.push(log);
      logsByTaskId.set(log.task_id, arr);
    }
  }

  // Decode task names and build response
  let totalDuration = 0;
  let firstStart: number | null = null;
  let lastEnd: number | null = null;

  const summary = {
    totalTasks: rawTasks.length,
    completed: 0,
    failed: 0,
    pending: 0,
    inProgress: 0,
    totalDuration: 0,
  };

  const tasks = rawTasks.map((t) => {
    // Decode nodeId::label format
    const sepIdx = t.name.indexOf("::");
    const nodeId = sepIdx > 0 && t.name.startsWith("agent-")
      ? t.name.slice(0, sepIdx)
      : null;
    const displayName = sepIdx > 0 && t.name.startsWith("agent-")
      ? t.name.slice(sepIdx + 2)
      : t.name;

    // Compute duration
    const startedAt = t.started_at ? new Date(t.started_at).getTime() : null;
    const completedAt = t.completed_at ? new Date(t.completed_at).getTime() : null;
    const duration = startedAt && completedAt ? completedAt - startedAt : null;

    // Track overall duration
    if (startedAt) {
      if (firstStart === null || startedAt < firstStart) firstStart = startedAt;
    }
    if (completedAt) {
      if (lastEnd === null || completedAt > lastEnd) lastEnd = completedAt;
    }

    // Update summary counts
    switch (t.status) {
      case "reviewed":
      case "completed":
        summary.completed++;
        break;
      case "failed":
        summary.failed++;
        break;
      case "in_progress":
        summary.inProgress++;
        break;
      default:
        summary.pending++;
    }

    // Parse event_data JSON for logs
    const logs = (logsByTaskId.get(t.id) || []).map((l) => ({
      eventType: l.event_type,
      eventData: l.event_data ? safeJsonParse(l.event_data) : null,
      createdAt: l.created_at,
    }));

    return {
      id: t.id,
      name: t.name,
      displayName,
      nodeId,
      description: t.description,
      status: t.status,
      assigneeRole: t.assignee_role,
      assigneeId: t.assignee_id,
      result: t.result,
      error: t.error,
      startedAt: t.started_at,
      completedAt: t.completed_at,
      duration,
      logs,
    };
  });

  if (firstStart && lastEnd) {
    summary.totalDuration = lastEnd - firstStart;
  }

  return Response.json({
    workflow: {
      id: wf.id,
      name: wf.name,
      description: wf.description,
      status: wf.status,
      createdAt: wf.created_at,
      updatedAt: wf.updated_at,
    },
    summary,
    tasks,
  });
}

function safeJsonParse(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

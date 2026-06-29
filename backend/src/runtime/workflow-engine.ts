import { uuid } from "./agent-types";
export const runtime = "nodejs";

import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { store } from "@/lib/storage";
import { getWorkspaceUIBus } from "./ui-bus";

type UUID = string;

type TaskRow = {
  id: UUID;
  workflow_id: UUID;
  name: string;
  description: string | null;
  assignee_role: string | null;
  assignee_id: UUID | null;
  status: string;
  depends_on: string[] | null;
  expected_output: string | null;
  result: string | null;
  review_notes: string | null;
  review_count: number | null;
  max_revisions: number | null;
  error: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  reviewed_at: Date | string | null;
  completed_at: Date | string | null;
};

type AgentInfo = {
  id: UUID;
  role: string;
  workspace_id: UUID;
};

/**
 * Workflow Task Execution Engine
 *
 * When a workflow is activated, this engine:
 * 1. Scans for ready tasks (all dependencies satisfied)
 * 2. Assigns tasks to matching agents by role
 * 3. Sends task instructions to assigned agents
 * 4. Monitors task progress and handles completion/failure
 * 5. Triggers next tasks when dependencies are met
 */
export class WorkflowEngine {
  private static instance: WorkflowEngine | null = null;
  private processing = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private static readonly POLL_INTERVAL_MS = 3000; // Check every 15 seconds
  private static readonly MAX_TASK_DURATION_MS = 30 * 60 * 1000; // 30 min timeout

  static getInstance(): WorkflowEngine {
    if (!WorkflowEngine.instance) {
      WorkflowEngine.instance = new WorkflowEngine();
    }
    return WorkflowEngine.instance;
  }

  start() {
    if (this.pollInterval) return;
    console.info("[WorkflowEngine] Starting task processor");
    this.pollInterval = setInterval(() => {
      void this.processActiveWorkflows();
    }, WorkflowEngine.POLL_INTERVAL_MS);
    this.pollInterval.unref();
    void this.processActiveWorkflows();
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.info("[WorkflowEngine] Stopped task processor");
    }
  }

  async triggerWorkflow(workflowId: UUID) {
    await this.processWorkflow(workflowId);
  }

  private async processActiveWorkflows() {
    if (this.processing) return;
    this.processing = true;

    try {
      const db = getDb();
      const rows = await db.execute(
        sql`SELECT id, name, group_id FROM workflows WHERE status = 'active'`
      );
      const workflows = (rows as unknown as Array<{ id: UUID; name: string; group_id: UUID }>) ?? [];

      for (const wf of workflows) {
        await this.processWorkflow(wf.id);
      }
    } catch (err) {
      console.error("[WorkflowEngine] processActiveWorkflows failed:", err);
    } finally {
      this.processing = false;
    }
  }

  private async processWorkflow(workflowId: UUID) {
    const db = getDb();
    const now = new Date();

    await this.checkTimedOutTasks(workflowId);

    const readyTasks = await this.getReadyTasks(workflowId);
    for (const task of readyTasks) {
      await this.assignAndExecuteTask(task, now);
    }
  }

  private async getReadyTasks(workflowId: UUID): Promise<TaskRow[]> {
    const db = getDb();
    const rows = await db.execute(
      sql`SELECT id, workflow_id, name, description, assignee_role, assignee_id,
                  status, depends_on, expected_output, result, review_notes,
                  review_count, max_revisions, error, created_at, started_at,
                  reviewed_at, completed_at
           FROM tasks
           WHERE workflow_id = ${workflowId} AND status = 'pending'
           ORDER BY created_at ASC`
    );
    const allPending = (rows as unknown as TaskRow[]) ?? [];

    const completedRows = await db.execute(
      sql`SELECT id FROM tasks WHERE workflow_id = ${workflowId} AND status IN ('completed', 'reviewed')`
    );
    const completedIds = new Set(
      ((completedRows as unknown as Array<{ id: string }>) ?? []).map((r) => r.id)
    );

    return allPending.filter((task) => {
      const deps = Array.isArray(task.depends_on) ? task.depends_on : [];
      if (deps.length === 0) return true;
      return deps.every((depId) => completedIds.has(depId));
    });
  }

  private async checkTimedOutTasks(workflowId: UUID) {
    const db = getDb();

    const rows = await db.execute(
      sql`SELECT id, name, started_at FROM tasks
           WHERE workflow_id = ${workflowId} AND status = 'in_progress'
           AND started_at IS NOT NULL`
    );
    const inProgressTasks = (rows as unknown as Array<{ id: UUID; name: string; started_at: string }>) ?? [];
    const now = Date.now();

    for (const task of inProgressTasks) {
      const startedAt = new Date(task.started_at).getTime();
      if (now - startedAt > WorkflowEngine.MAX_TASK_DURATION_MS) {
        await db.execute(
          sql`UPDATE tasks SET status = 'failed', error = 'Task timed out', completed_at = ${now} WHERE id = ${task.id}`
        );
        await this.logTaskEvent(task.id, "task_timed_out", { duration_ms: now - startedAt });
        console.warn(`[WorkflowEngine] Task ${task.id} timed out`);

        // Emit stage_complete with failed status for timed out task
        const taskNameRows = await db.execute(
          sql`SELECT name, workflow_id FROM tasks WHERE id = ${task.id} LIMIT 1`
        );
        const taskRow = (taskNameRows as unknown as Array<{ name: string; workflow_id: string }>)[0];
        if (taskRow) {
          const { nodeId, label } = WorkflowEngine.parseNodeId(taskRow.name);
          await this.emitPipelineEvent(taskRow.workflow_id, "pipeline.stage_complete", {
            stageName: taskRow.name,
            nodeId,
            label,
            status: "failed",
            output: "Task timed out",
          });
          await this.checkWorkflowCompletion(taskRow.workflow_id);
        }
      }
    }
  }

  private async assignAndExecuteTask(task: TaskRow, now: Date) {
    const db = getDb();
    const { nodeId, label } = WorkflowEngine.parseNodeId(task.name);

    await db.execute(
      sql`UPDATE tasks SET status = 'in_progress', started_at = ${now} WHERE id = ${task.id}`
    );
    await this.logTaskEvent(task.id, "task_started");

    // Emit stage_start event for visual editor
    await this.emitPipelineEvent(task.workflow_id, "pipeline.stage_start", {
      stageName: task.name,
      nodeId,
      label,
      role: task.assignee_role || "assistant",
    });

    if (task.assignee_id) {
      await this.sendTaskToAgent(task);
      return;
    }

    if (task.assignee_role) {
      const agent = await this.findAgentByRole(task.assignee_role);
      if (agent) {
        await db.execute(
          sql`UPDATE tasks SET assignee_id = ${agent.id} WHERE id = ${task.id}`
        );
        await this.sendTaskToAgent({ ...task, assignee_id: agent.id });
        return;
      }
    }

    await db.execute(
      sql`UPDATE tasks SET status = 'failed', error = 'No agent found for role', completed_at = ${now} WHERE id = ${task.id}`
    );
    await this.logTaskEvent(task.id, "task_failed_no_agent", { role: task.assignee_role });
    console.warn(`[WorkflowEngine] Task ${task.id} failed: no agent for role "${task.assignee_role}"`);

    // Emit stage_complete with failed status
    await this.emitPipelineEvent(task.workflow_id, "pipeline.stage_complete", {
      stageName: task.name,
      nodeId,
      label,
      status: "failed",
      output: "No agent found for role: " + (task.assignee_role || "unknown"),
    });
    await this.checkWorkflowCompletion(task.workflow_id);
  }

  private async findAgentByRole(role: string): Promise<AgentInfo | null> {
    const agents = await store.listAgents();
    const matchingAgents = agents.filter(
      (a) => a.role && a.role.toLowerCase() === role.toLowerCase() && a.role !== "human"
    );

    if (matchingAgents.length === 0) return null;

    const agent = matchingAgents[0];
    return {
      id: agent.id,
      role: agent.role,
      workspace_id: agent.workspaceId,
    };
  }

  private async sendTaskToAgent(task: TaskRow) {
    if (!task.assignee_id) return;

    const db = getDb();

    const wfRows = await db.execute(
      sql`SELECT name, group_id FROM workflows WHERE id = ${task.workflow_id} LIMIT 1`
    );
    const wf = (wfRows as unknown as Array<{ name: string; group_id: UUID }>)[0];
    if (!wf) return;

    const instruction = [
      '[Workflow Task]',
      'Workflow: ' + wf.name,
      'Task: ' + task.name,
      task.description ? 'Description: ' + task.description : null,
      task.expected_output ? 'Expected Output: ' + task.expected_output : null,
      task.review_notes ? 'Review Notes (previous): ' + task.review_notes : null,
      'Please execute this task and send the result to the group using send_group_message.',
      'When done, mark the task complete by stating "TASK_COMPLETE: <task_id>".',
    ].filter(Boolean).join('\n');

    try {
      const msgId = crypto.randomUUID();
      const workspaceRows = await db.execute(
        sql`SELECT workspace_id FROM groups WHERE id = ${wf.group_id} LIMIT 1`
      );
      const ws = (workspaceRows as unknown as Array<{ workspace_id: string }>)[0];
      if (!ws) return;

      const now = new Date();
      await db.execute(
        sql`INSERT INTO messages (id, workspace_id, group_id, sender_id, content_type, content, send_time)
             VALUES (${uuid()}, ${ws.workspace_id}, ${wf.group_id}, ${task.assignee_id}, 'text', ${instruction}, ${now})`
      );

      await this.logTaskEvent(task.id, "task_instruction_sent", { agent_id: task.assignee_id });
      console.info(`[WorkflowEngine] Task instruction sent to agent ${task.assignee_id} for task ${task.id}`);

      const { getAgentRuntime } = await import("./agent-runtime");
      const runtime = getAgentRuntime();
      await runtime.wakeAgent(task.assignee_id, "direct_message");
    } catch (err) {
      console.error(`[WorkflowEngine] Failed to send task to agent ${task.assignee_id}:`, err);
      await this.logTaskEvent(task.id, "task_send_failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async logTaskEvent(taskId: UUID, eventType: string, eventData: Record<string, unknown> = {}) {
    try {
      const db = getDb();
      const { v4: uuid } = await import("uuid");
      const now = new Date();
      await db.execute(
        sql`INSERT INTO task_logs (id, task_id, event_type, event_data, created_at)
             VALUES (${uuid()}, ${taskId}, ${eventType}, ${eventData}, ${now})`
      );
    } catch {
      // best-effort
    }
  }

  /** Resolve workspaceId from a workflow's group */
  private async resolveWorkspaceId(workflowId: UUID): Promise<string | null> {
    try {
      const db = getDb();
      const rows = await db.execute(
        sql`SELECT g.workspace_id FROM workflows w
            JOIN groups g ON g.id = w.group_id
            WHERE w.id = ${workflowId} LIMIT 1`
      );
      const row = (rows as unknown as Array<{ workspace_id: string }>)[0];
      return row?.workspace_id ?? null;
    } catch {
      return null;
    }
  }

  /** Parse nodeId from task name format "nodeId::label" */
  static parseNodeId(taskName: string): { nodeId: string | null; label: string } {
    const sepIdx = taskName.indexOf("::");
    if (sepIdx > 0 && taskName.startsWith("agent-")) {
      return {
        nodeId: taskName.slice(0, sepIdx),
        label: taskName.slice(sepIdx + 2),
      };
    }
    return { nodeId: null, label: taskName };
  }

  /** Emit a pipeline event to the UI bus for a workflow */
  private async emitPipelineEvent(
    workflowId: UUID,
    event: string,
    data: Record<string, unknown>
  ) {
    const workspaceId = await this.resolveWorkspaceId(workflowId);
    if (!workspaceId) return;
    getWorkspaceUIBus().emit(workspaceId, {
      event: event as any,
      data: { ...data, pipelineId: workflowId, workflowId },
    } as any);
  }

  /** Check if a workflow has any remaining pending or in_progress tasks */
  private async hasActiveTasks(workflowId: UUID): Promise<boolean> {
    const db = getDb();
    const rows = await db.execute(
      sql`SELECT COUNT(*) as cnt FROM tasks
          WHERE workflow_id = ${workflowId} AND status IN ('pending', 'in_progress')`
    );
    const row = (rows as unknown as Array<{ cnt: number }>)[0];
    return (row?.cnt ?? 0) > 0;
  }

  static async processTaskCompletion(taskId: UUID, result: string) {
    const db = getDb();
    const now = new Date();

    const rows = await db.execute(
      sql`SELECT review_count, max_revisions, workflow_id, name FROM tasks WHERE id = ${taskId} LIMIT 1`
    );
    const task = (rows as unknown as Array<{ review_count: number; max_revisions: number; workflow_id: UUID; name: string }>)[0];
    if (!task) return;

    const { nodeId, label } = WorkflowEngine.parseNodeId(task.name);
    const reviewCount = task.review_count ?? 0;
    const maxRevisions = task.max_revisions ?? 3;
    const engine = WorkflowEngine.getInstance();

    if (reviewCount >= maxRevisions) {
      await db.execute(
        sql`UPDATE tasks SET status = 'failed', error = 'Max revisions exceeded', completed_at = ${now} WHERE id = ${taskId}`
      );
      await engine.logTaskEvent(taskId, "task_failed_max_revisions", { review_count: reviewCount });

      // Emit stage_complete with failed status
      await engine.emitPipelineEvent(task.workflow_id, "pipeline.stage_complete", {
        stageName: task.name,
        nodeId,
        label,
        status: "failed",
        output: "Max revisions exceeded",
      });
    } else {
      await db.execute(
        sql`UPDATE tasks SET status = 'reviewed', result = ${result}, reviewed_at = ${now} WHERE id = ${taskId}`
      );
      await engine.logTaskEvent(taskId, "task_reviewed", { result });

      // Emit stage_complete with completed status
      await engine.emitPipelineEvent(task.workflow_id, "pipeline.stage_complete", {
        stageName: task.name,
        nodeId,
        label,
        status: "completed",
        output: (result || "").slice(0, 500),
      });
    }

    await engine.processWorkflow(task.workflow_id);
    await engine.checkWorkflowCompletion(task.workflow_id);
  }

  /** Check if all tasks in a workflow are done and emit pipeline.complete */
  private async checkWorkflowCompletion(workflowId: UUID) {
    const stillActive = await this.hasActiveTasks(workflowId);
    if (stillActive) return;

    // Check if any task failed
    const db = getDb();
    const failRows = await db.execute(
      sql`SELECT COUNT(*) as cnt FROM tasks WHERE workflow_id = ${workflowId} AND status = 'failed'`
    );
    const failCount = ((failRows as unknown as Array<{ cnt: number }>)[0]?.cnt) ?? 0;
    const overallStatus = failCount > 0 ? "completed_with_errors" : "completed";

    await this.emitPipelineEvent(workflowId, "pipeline.complete", {
      overallStatus,
      failedTasks: failCount,
    });
  }
}

export function initWorkflowEngine() {
  const engine = WorkflowEngine.getInstance();
  engine.start();
  return engine;
}

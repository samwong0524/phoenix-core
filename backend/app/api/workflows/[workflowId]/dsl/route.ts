export const runtime = "nodejs";

import { getDb } from "@/db";
import { workflows, tasks } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import type { WorkflowDSL } from "@/lib/workflow-types";

/**
 * GET /api/workflows/:workflowId/dsl
 * Rebuild a WorkflowDSL from workflows + tasks tables.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const { workflowId } = await params;
  const db = getDb();

  // Fetch workflow
  const wfRows = await db
    .select()
    .from(workflows)
    .where(eq(workflows.id, workflowId))
    .limit(1);

  if (wfRows.length === 0) {
    return Response.json({ error: "Workflow not found" }, { status: 404 });
  }

  const wf = wfRows[0]!;

  // Fetch tasks
  const taskRows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.workflowId, workflowId));

  // Build DSL: linear chain layout
  // Sort tasks by dependency order
  const sorted = topologicalSort(taskRows);

  const nodes: WorkflowDSL["nodes"] = [
    {
      id: "start",
      type: "start",
      position: { x: 80, y: 200 },
      data: { label: "Start" },
    },
  ];

  const edges: WorkflowDSL["edges"] = [];
  let prevId = "start";

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i]!;
    const nodeId = `agent-${i + 1}`;
    // Decode nodeId::label format
    const sepIdx = t.name.indexOf("::");
    const displayLabel = sepIdx > 0 && t.name.startsWith("agent-")
      ? t.name.slice(sepIdx + 2)
      : t.name;
    nodes.push({
      id: nodeId,
      type: "agent",
      position: { x: 250 + i * 250, y: 200 },
      data: {
        label: displayLabel,
        role: t.assigneeRole || "assistant",
        description: t.description || "",
        expectedOutput: t.expectedOutput || "",
        executionStatus: "idle",
      },
    });
    edges.push({
      id: `e-${prevId}-${nodeId}`,
      source: prevId,
      target: nodeId,
    });
    prevId = nodeId;
  }

  // Add end node
  nodes.push({
    id: "end",
    type: "end",
    position: { x: 250 + sorted.length * 250 + 100, y: 200 },
    data: { label: "End" },
  });
  edges.push({
    id: `e-${prevId}-end`,
    source: prevId,
    target: "end",
  });

  const dsl: WorkflowDSL = { nodes, edges };

  return Response.json({
    workflow: {
      id: wf.id,
      name: wf.name,
      description: wf.description,
      status: wf.status,
      groupId: wf.groupId,
    },
    dsl,
  });
}

/**
 * PUT /api/workflows/:workflowId/dsl
 * Update workflow name/description and sync tasks from DSL.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const { workflowId } = await params;
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    description?: string;
    dsl?: WorkflowDSL;
  } | null;

  if (!body) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const db = getDb();
  const now = new Date();

  // Update workflow metadata
  if (body.name !== undefined || body.description !== undefined) {
    await db
      .update(workflows)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        updatedAt: now,
      })
      .where(eq(workflows.id, workflowId));
  }

  // Sync tasks from DSL
  if (body.dsl) {
    // Delete existing tasks
    await db.delete(tasks).where(eq(tasks.workflowId, workflowId));

    // Build node map: id → encoded task name (nodeId::label)
    const nodeMap = new Map<string, string>();
    for (const n of body.dsl.nodes) {
      if (n.type === "agent") {
        const label = (n.data as any).label || n.id;
        nodeMap.set(n.id, `${n.id}::${label}`);
      }
    }

    // Create tasks from agent nodes
    for (const n of body.dsl.nodes) {
      if (n.type !== "agent") continue;
      const data = n.data as any;

      // Compute depends_on from edges (store encoded task names)
      const dependsOn = body.dsl.edges
        .filter((e) => e.target === n.id)
        .map((e) => nodeMap.get(e.source))
        .filter((name): name is string => !!name);

      // Encode nodeId into task name for event mapping
      const taskName = `${n.id}::${data.label || "Untitled Step"}`;

      await db.insert(tasks).values({
        id: crypto.randomUUID(),
        workflowId,
        name: taskName,
        description: data.description || null,
        assigneeRole: data.role || null,
        expectedOutput: data.expectedOutput || null,
        dependsOn,
        status: "pending",
        createdAt: new Date(),
      });
    }
  }

  return Response.json({ ok: true });
}

// ── Helpers ──────────────────────────────────────────────────────

function topologicalSort(
  taskRows: Array<{
    id: string;
    name: string;
    dependsOn: string[] | null;
    [key: string]: any;
  }>
) {
  const nameToTask = new Map(taskRows.map((t) => [t.name, t]));
  const visited = new Set<string>();
  const result: typeof taskRows = [];

  function visit(t: (typeof taskRows)[0]) {
    if (visited.has(t.name)) return;
    visited.add(t.name);
    for (const dep of t.dependsOn || []) {
      const depTask = nameToTask.get(dep);
      if (depTask) visit(depTask);
    }
    result.push(t);
  }

  for (const t of taskRows) visit(t);
  return result;
}

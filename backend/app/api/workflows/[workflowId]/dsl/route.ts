export const runtime = "nodejs";

import { getDb } from "@/db";
import { workflows, tasks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { WorkflowDSL } from "@/lib/workflow-types";

/**
 * GET /api/workflows/:workflowId/dsl
 * Restore the full visual DAG from layout_data (or fallback to linear chain).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ workflowId: string }> }
) {
  const { workflowId } = await params;
  const db = getDb();

  // Fetch workflow with layout_data via raw SQL (jsonb)
  const wfRows = await db.execute(
    sql`SELECT id, name, description, status, group_id, layout_data
        FROM workflows WHERE id = ${workflowId} LIMIT 1`
  );
  const wf = (wfRows as unknown as Array<{
    id: string;
    name: string;
    description: string | null;
    status: string;
    group_id: string;
    layout_data: WorkflowDSL | null;
  }>)[0];

  if (!wf) {
    return Response.json({ error: "Workflow not found" }, { status: 404 });
  }

  // If layout_data exists, return it directly (preserves real DAG topology)
  if (wf.layout_data) {
    return Response.json({
      workflow: {
        id: wf.id,
        name: wf.name,
        description: wf.description,
        status: wf.status,
        groupId: wf.group_id,
      },
      dsl: wf.layout_data,
    });
  }

  // Fallback: rebuild linear chain from tasks table (legacy data)
  const taskRows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.workflowId, workflowId));

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
    const sepIdx = t.name.indexOf("::");
    const displayLabel =
      sepIdx > 0 && t.name.startsWith("agent-")
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
      groupId: wf.group_id,
    },
    dsl,
  });
}

/**
 * PUT /api/workflows/:workflowId/dsl
 * Save full DSL to layout_data + sync tasks (including condition nodes).
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

  // Sync DSL + tasks
  if (body.dsl) {
    // 1. Save layout_data (full DSL with positions + edge labels)
    await db.execute(
      sql`UPDATE workflows SET layout_data = ${JSON.stringify(body.dsl)}::jsonb, updated_at = ${now} WHERE id = ${workflowId}`
    );

    // 2. Delete existing tasks
    await db.delete(tasks).where(eq(tasks.workflowId, workflowId));

    // 3. Build node→encoded name map for depends_on resolution
    //    Agent nodes: "agent-N::Label"
    //    Condition nodes: "cond-N::Label"
    const nodeMap = new Map<string, string>();
    for (const n of body.dsl.nodes) {
      if (n.type === "agent" || n.type === "condition") {
        const label = (n.data as any).label || n.id;
        nodeMap.set(n.id, `${n.id}::${label}`);
      }
    }

    // 4. Create tasks from agent + condition nodes
    for (const n of body.dsl.nodes) {
      if (n.type !== "agent" && n.type !== "condition") continue;
      const data = n.data as any;

      // Compute depends_on from edges (store encoded task names)
      const dependsOn = body.dsl.edges
        .filter((e) => e.target === n.id)
        .map((e) => nodeMap.get(e.source))
        .filter((name): name is string => !!name);

      const taskName = `${n.id}::${data.label || "Untitled Step"}`;

      await db.insert(tasks).values({
        id: crypto.randomUUID(),
        workflowId,
        nodeId: n.id,
        name: taskName,
        description:
          n.type === "condition"
            ? data.condition || null
            : data.description || null,
        assigneeRole: n.type === "agent" ? data.role || null : null,
        expectedOutput:
          n.type === "agent" ? data.expectedOutput || null : null,
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

export const runtime = "nodejs";

import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import type { WorkflowDSL } from "@/lib/workflow-types";

/**
 * POST /api/workflow-templates/:id/use
 * Create a new workflow from a template.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as {
    groupId?: string;
    name?: string;
    creatorId?: string;
  } | null;

  if (!body?.groupId || !body?.creatorId) {
    return Response.json({ error: "groupId and creatorId are required" }, { status: 400 });
  }

  const db = getDb();

  // Fetch the template
  const tplRows = await db.execute(
    sql`SELECT name, dsl FROM workflow_templates WHERE id = ${id} LIMIT 1`
  );
  const tpl = (tplRows as unknown as Array<{ name: string; dsl: WorkflowDSL }>)[0];

  if (!tpl) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }

  // Create a new workflow
  const workflowId = crypto.randomUUID();
  const now = new Date();
  const workflowName = body.name || tpl.name;

  await db.execute(
    sql`INSERT INTO workflows (id, group_id, name, description, creator_id, status, layout_data, created_at, updated_at)
        VALUES (${workflowId}, ${body.groupId}, ${workflowName}, ${`Created from template: ${tpl.name}`}, ${body.creatorId}, 'draft', ${JSON.stringify(tpl.dsl)}, ${now}, ${now})`
  );

  // Create tasks from the DSL (same logic as PUT /api/workflows/:id/dsl)
  const nodeMap = new Map<string, string>();
  for (const n of tpl.dsl.nodes) {
    if (n.type === "agent" || n.type === "condition") {
      const label = (n.data as any).label || n.id;
      nodeMap.set(n.id, `${n.id}::${label}`);
    }
  }

  for (const n of tpl.dsl.nodes) {
    if (n.type !== "agent" && n.type !== "condition") continue;
    const data = n.data as any;

    const dependsOn = tpl.dsl.edges
      .filter((e) => e.target === n.id)
      .map((e) => nodeMap.get(e.source))
      .filter((name): name is string => !!name);

    const taskName = `${n.id}::${data.label || "Untitled Step"}`;

    await db.execute(
      sql`INSERT INTO tasks (id, workflow_id, node_id, name, description, assignee_role, expected_output, depends_on, status, created_at)
          VALUES (${crypto.randomUUID()}, ${workflowId}, ${n.id}, ${taskName}, ${n.type === "condition" ? (data.condition || null) : (data.description || null)}, ${n.type === "agent" ? (data.role || null) : null}, ${n.type === "agent" ? (data.expectedOutput || null) : null}, ${dependsOn}, 'pending', ${now})`
    );
  }

  // Increment usage count
  await db.execute(
    sql`UPDATE workflow_templates SET usage_count = usage_count + 1 WHERE id = ${id}`
  );

  return Response.json({
    workflow: {
      id: workflowId,
      name: workflowName,
      status: "draft",
      groupId: body.groupId,
    },
  }, { status: 201 });
}

export const runtime = "nodejs";

import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import type { WorkflowDSL } from "@/lib/workflow-types";

/**
 * GET /api/workflow-templates/:id
 * Get a single template with full DSL.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  const rows = await db.execute(
    sql`SELECT id, name, description, icon, category, tags, dsl, node_count, edge_count, usage_count, is_builtin, created_at, updated_at
        FROM workflow_templates WHERE id = ${id} LIMIT 1`
  );
  const template = (rows as unknown as Array<Record<string, unknown>>)[0];

  if (!template) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }

  return Response.json({ template });
}

/**
 * PUT /api/workflow-templates/:id
 * Update a template's metadata or DSL.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    description?: string;
    icon?: string;
    category?: string;
    tags?: string[];
    dsl?: WorkflowDSL;
  } | null;

  if (!body) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const db = getDb();
  const now = new Date();

  // Build update using individual fields
  if (body.name !== undefined) {
    await db.execute(sql`UPDATE workflow_templates SET name = ${body.name}, updated_at = ${now} WHERE id = ${id}`);
  }
  if (body.description !== undefined) {
    await db.execute(sql`UPDATE workflow_templates SET description = ${body.description}, updated_at = ${now} WHERE id = ${id}`);
  }
  if (body.icon !== undefined) {
    await db.execute(sql`UPDATE workflow_templates SET icon = ${body.icon}, updated_at = ${now} WHERE id = ${id}`);
  }
  if (body.category !== undefined) {
    await db.execute(sql`UPDATE workflow_templates SET category = ${body.category}, updated_at = ${now} WHERE id = ${id}`);
  }
  if (body.tags !== undefined) {
    await db.execute(sql`UPDATE workflow_templates SET tags = ${body.tags}, updated_at = ${now} WHERE id = ${id}`);
  }
  if (body.dsl !== undefined) {
    const agentNodes = body.dsl.nodes.filter((n) => n.type === "agent" || n.type === "condition");
    await db.execute(
      sql`UPDATE workflow_templates SET dsl = ${JSON.stringify(body.dsl)}, node_count = ${agentNodes.length}, edge_count = ${body.dsl.edges.length}, updated_at = ${now} WHERE id = ${id}`
    );
  }

  return Response.json({ ok: true });
}

/**
 * DELETE /api/workflow-templates/:id
 * Delete a template (only non-builtin).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();

  // Check if builtin
  const rows = await db.execute(
    sql`SELECT is_builtin FROM workflow_templates WHERE id = ${id} LIMIT 1`
  );
  const template = (rows as unknown as Array<{ is_builtin: boolean }>)[0];

  if (!template) {
    return Response.json({ error: "Template not found" }, { status: 404 });
  }
  if (template.is_builtin) {
    return Response.json({ error: "Cannot delete built-in template" }, { status: 403 });
  }

  await db.execute(sql`DELETE FROM workflow_templates WHERE id = ${id}`);
  return Response.json({ ok: true });
}

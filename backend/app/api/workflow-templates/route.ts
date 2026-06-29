export const runtime = "nodejs";

import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { SEED_TEMPLATES } from "@/lib/workflow-template-seeds";
import type { WorkflowDSL } from "@/lib/workflow-types";

/**
 * GET /api/workflow-templates
 * List all workflow templates. Seeds built-in templates on first call.
 * Query params: category, search
 */
export async function GET(req: Request) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const search = searchParams.get("search");

  // Auto-seed on first access
  await seedIfEmpty(db);

  // Build query
  let query = `SELECT id, name, description, icon, category, tags, node_count, edge_count, usage_count, is_builtin, created_at, updated_at
    FROM workflow_templates`;
  const params: unknown[] = [];
  const conditions: string[] = [];

  if (category && category !== "all") {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(name ILIKE $${params.length} OR description ILIKE $${params.length})`);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " ORDER BY usage_count DESC, created_at ASC";

  const rows = await db.execute(sql.raw(query));
  const templates = (rows as unknown as Array<Record<string, unknown>>) ?? [];

  return Response.json({ templates });
}

/**
 * POST /api/workflow-templates
 * Create a new workflow template from a DSL.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    name?: string;
    description?: string;
    icon?: string;
    category?: string;
    tags?: string[];
    dsl?: WorkflowDSL;
  } | null;

  if (!body?.dsl) {
    return Response.json({ error: "DSL is required" }, { status: 400 });
  }
  if (!body.name) {
    return Response.json({ error: "Name is required" }, { status: 400 });
  }

  const db = getDb();
  const now = new Date();
  const id = crypto.randomUUID();

  const agentNodes = body.dsl.nodes.filter((n) => n.type === "agent" || n.type === "condition");
  const nodeCount = agentNodes.length;
  const edgeCount = body.dsl.edges.length;

  await db.execute(
    sql`INSERT INTO workflow_templates (id, name, description, icon, category, tags, dsl, node_count, edge_count, usage_count, is_builtin, created_at, updated_at)
        VALUES (${id}, ${body.name}, ${body.description || null}, ${body.icon || "📋"}, ${body.category || "general"}, ${body.tags || []}, ${JSON.stringify(body.dsl)}, ${nodeCount}, ${edgeCount}, 0, false, ${now}, ${now})`
  );

  const template = {
    id,
    name: body.name,
    description: body.description || null,
    icon: body.icon || "📋",
    category: body.category || "general",
    tags: body.tags || [],
    nodeCount,
    edgeCount,
    usageCount: 0,
    isBuiltin: false,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  return Response.json({ template }, { status: 201 });
}

// ── Helpers ──────────────────────────────────────────────────────

async function seedIfEmpty(db: ReturnType<typeof getDb>) {
  const countRows = await db.execute(
    sql`SELECT COUNT(*) as cnt FROM workflow_templates`
  );
  const count = ((countRows as unknown as Array<{ cnt: number }>)[0]?.cnt) ?? 0;
  if (count > 0) return;

  const now = new Date();
  for (const seed of SEED_TEMPLATES) {
    const id = crypto.randomUUID();
    const agentNodes = seed.dsl.nodes.filter((n) => n.type === "agent" || n.type === "condition");
    await db.execute(
      sql`INSERT INTO workflow_templates (id, name, description, icon, category, tags, dsl, node_count, edge_count, usage_count, is_builtin, created_at, updated_at)
          VALUES (${id}, ${seed.name}, ${seed.description}, ${seed.icon}, ${seed.category}, ${seed.tags}, ${JSON.stringify(seed.dsl)}, ${agentNodes.length}, ${seed.dsl.edges.length}, 0, true, ${now}, ${now})`
    );
  }
  console.info(`[workflow-templates] Seeded ${SEED_TEMPLATES.length} built-in templates`);
}

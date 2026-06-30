export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { getTemplate } from "@/lib/templates";
import { isAuthEnabled, requireSession, getSession, AuthError } from "@/lib/auth";
import { addWorkspaceMember } from "@/lib/rbac";
import { checkRateLimit, RATE_LIMITS, withRateLimitHeaders, rateLimitExceededResponse } from "@/lib/rate-limiter";

export async function GET(req: Request) {
  try {
    // Rate limiting
    const session = await getSession(req);
    const userId = session?.id ?? "anonymous";
    const limit = checkRateLimit(`user:${userId}:api`, RATE_LIMITS.api);
    if (!limit.allowed) return rateLimitExceededResponse(limit);

    // Auth check: require login when auth is enabled
    if (isAuthEnabled()) {
      if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const workspaces = await store.listWorkspaces();
    return withRateLimitHeaders(Response.json({ workspaces }), limit);
  } catch (e) {
    if (e instanceof AuthError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    return Response.json(
      {
        error: "Database not ready",
        message: e instanceof Error ? e.message : String(e),
        hint: "Run POST /api/admin/init-db after starting Postgres",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    // Rate limiting
    const session = await getSession(req);
    const userId = session?.id ?? "anonymous";
    const limit = checkRateLimit(`user:${userId}:api`, RATE_LIMITS.api);
    if (!limit.allowed) return rateLimitExceededResponse(limit);

    // Auth check: require login when auth is enabled
    if (isAuthEnabled()) {
      if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as {
      name?: string;
      templateId?: string;
    } | null;

    const name = body?.name ?? "Default Workspace";
    const templateId = body?.templateId;

    let result: { workspaceId: string; [key: string]: unknown };

    // Template-based creation
    if (templateId && templateId !== "blank") {
      const template = getTemplate(templateId);
      if (!template) {
        return Response.json(
          { error: "Unknown template", templateId },
          { status: 400 }
        );
      }

      // Resolve locale from cookie
      const cookieHeader = req.headers.get("cookie") ?? "";
      const localeMatch = cookieHeader.match(/swarm-locale=(zh|en)/);
      const locale = (localeMatch?.[1] as "zh" | "en") ?? "zh";

      result = await store.createWorkspaceFromTemplate({
        template,
        name,
        locale,
      });
    } else {
      // Default: blank workspace (backward compatible)
      result = await store.createWorkspaceWithDefaults({ name });
    }

    // Auto-seed the creator as workspace owner in workspace_members
    if (session) {
      await addWorkspaceMember(result.workspaceId, session.id, "owner");
    }

    return withRateLimitHeaders(Response.json(result, { status: 201 }), limit);
  } catch (e) {
    if (e instanceof AuthError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    return Response.json(
      {
        error: "Failed to create workspace",
        message: e instanceof Error ? e.message : String(e),
        hint: "Check DATABASE_URL, start Postgres, then POST /api/admin/init-db",
      },
      { status: 500 }
    );
  }
}

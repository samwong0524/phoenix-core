export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { isAuthEnabled, getSession, AuthError } from "@/lib/auth";
import { requireWorkspaceRole, RbacError } from "@/lib/rbac";
import { checkRateLimit, RATE_LIMITS, withRateLimitHeaders, rateLimitExceededResponse } from "@/lib/rate-limiter";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const backupId = url.searchParams.get("backupId");

  try {
    // Rate limiting
    const session = await getSession(req);
    const userId = session?.id ?? "anonymous";
    const limit = checkRateLimit(`user:${userId}:api`, RATE_LIMITS.api);
    if (!limit.allowed) return rateLimitExceededResponse(limit);

    // Workspace isolation
    if (isAuthEnabled() && workspaceId) {
      if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
      await requireWorkspaceRole(session, workspaceId, "viewer");
    }

    if (backupId) {
      const data = await store.getBackupData({ backupId });
      return withRateLimitHeaders(Response.json({
        id: data.id,
        workspaceId: data.workspaceId,
        createdAt: data.createdAt,
        data: data.data,
      }), limit);
    }

    const backups = await store.listBackups(
      workspaceId ? { workspaceId } : {}
    );
    return withRateLimitHeaders(Response.json({ backups }), limit);
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof RbacError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Failed to list backups", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    action: "create" | "restore";
    backupId?: string;
  } | null;
  if (!body) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    // Rate limiting
    const session = await getSession(req);
    const userId = session?.id ?? "anonymous";
    const limit = checkRateLimit(`user:${userId}:api`, RATE_LIMITS.api);
    if (!limit.allowed) return rateLimitExceededResponse(limit);

    if (body.action === "create") {
      const url = new URL(req.url);
      const workspaceId = url.searchParams.get("workspaceId");
      if (!workspaceId) {
        return Response.json({ error: "Missing workspaceId" }, { status: 400 });
      }

      // Workspace isolation
      if (isAuthEnabled()) {
        if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
        await requireWorkspaceRole(session, workspaceId, "admin");
      }

      const result = await store.backupWorkspace({ workspaceId });
      return withRateLimitHeaders(Response.json({ ok: true, backupId: result.id, createdAt: result.createdAt }, { status: 201 }), limit);
    }

    if (body.action === "restore") {
      if (!body.backupId) {
        return Response.json({ error: "Missing backupId" }, { status: 400 });
      }
      const result = await store.restoreBackup({ backupId: body.backupId });

      // Workspace isolation on the target workspace
      if (isAuthEnabled() && result.workspaceId) {
        if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
        await requireWorkspaceRole(session, result.workspaceId, "admin");
      }

      return withRateLimitHeaders(Response.json({ ok: true, workspaceId: result.workspaceId, restoredAt: result.restoredAt }), limit);
    }

    return Response.json({ error: "Unknown action. Use 'create' or 'restore'." }, { status: 400 });
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof RbacError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Backup operation failed", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

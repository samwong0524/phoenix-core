export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { isAuthEnabled, getSession, AuthError } from "@/lib/auth";
import { requireWorkspaceRole, RbacError } from "@/lib/rbac";
import { checkRateLimit, RATE_LIMITS, withRateLimitHeaders, rateLimitExceededResponse } from "@/lib/rate-limiter";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
  const agentId = url.searchParams.get("agentId") ?? undefined;

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

    const groups = await store.listGroups({ workspaceId, agentId });
    return withRateLimitHeaders(Response.json({ groups }), limit);
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof RbacError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Failed to list groups", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    workspaceId: string;
    memberIds: string[];
    name?: string;
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

    // Workspace isolation
    if (isAuthEnabled()) {
      if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
      await requireWorkspaceRole(session, body.workspaceId, "member");
    }

    if (body.memberIds.length === 2) {
      const groupId =
        (await store.mergeDuplicateExactP2PGroups({
          workspaceId: body.workspaceId,
          memberA: body.memberIds[0]!,
          memberB: body.memberIds[1]!,
          preferredName: body.name ?? null,
        })) ??
        (
          await store.createGroup({
            workspaceId: body.workspaceId,
            memberIds: body.memberIds,
            name: body.name ?? undefined,
          })
        ).id;

      return withRateLimitHeaders(Response.json({ id: groupId, name: body.name ?? null }, { status: 201 }), limit);
    }

    const group = await store.createGroup(body);
    return withRateLimitHeaders(Response.json(group, { status: 201 }), limit);
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof RbacError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Failed to create group", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { getAgentRuntime } from "@/runtime/agent-runtime";
import { getWorkspaceUIBus } from "@/runtime/ui-bus";
import { isAuthEnabled, getSession, AuthError } from "@/lib/auth";
import { requireWorkspaceRole, RbacError } from "@/lib/rbac";
import { checkRateLimit, RATE_LIMITS, withRateLimitHeaders, rateLimitExceededResponse } from "@/lib/rate-limiter";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
  const meta = url.searchParams.get("meta") === "true";

  if (!workspaceId) {
    return Response.json({ error: "Missing workspaceId" }, { status: 400 });
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
      await requireWorkspaceRole(session, workspaceId, "viewer");
    }

    if (meta) {
      const agents = await store.listAgentsMeta({ workspaceId });
      return withRateLimitHeaders(Response.json({ agents }), limit);
    }

    const agents = await store.listAgents({ workspaceId });
    return withRateLimitHeaders(Response.json({ agents }), limit);
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof RbacError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Failed to list agents", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | {
        workspaceId?: string;
        creatorId?: string;
        role?: string;
        groupId?: string;
      }
    | null;

  const workspaceId = body?.workspaceId?.trim();
  const creatorId = body?.creatorId?.trim();
  const role = body?.role?.trim();

  if (!workspaceId) {
    return Response.json({ error: "Missing workspaceId" }, { status: 400 });
  }
  if (!creatorId) {
    return Response.json({ error: "Missing creatorId" }, { status: 400 });
  }
  if (!role) {
    return Response.json({ error: "Missing role" }, { status: 400 });
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
      await requireWorkspaceRole(session, workspaceId, "member");
    }

    const runtime = getAgentRuntime();
    await runtime.bootstrap(workspaceId);
    const { humanAgentId } = await store.ensureWorkspaceDefaults({ workspaceId });

    if (body?.groupId) {
      const created = await store.createSubAgentWithP2P({ workspaceId, creatorId, role });
      await store.addGroupMembers({ groupId: body.groupId, userIds: [created.agentId] });
      runtime.ensureRunner(created.agentId);
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.agent.created",
        data: { workspaceId, agent: { id: created.agentId, role, parentId: creatorId } },
      });
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.group.created",
        data: {
          workspaceId,
          group: { id: created.groupId, name: role, memberIds: [humanAgentId, created.agentId] },
        },
      });

      return withRateLimitHeaders(
        Response.json(
          { agentId: created.agentId, groupId: body.groupId, createdAt: created.createdAt },
          { status: 201 }
        ),
        limit
      );
    }

    const created = await store.createSubAgentWithP2P({ workspaceId, creatorId, role });
    runtime.ensureRunner(created.agentId);
    getWorkspaceUIBus().emit(workspaceId, {
      event: "ui.agent.created",
      data: { workspaceId, agent: { id: created.agentId, role, parentId: creatorId } },
    });
    getWorkspaceUIBus().emit(workspaceId, {
      event: "ui.group.created",
      data: { workspaceId, group: { id: created.groupId, name: role, memberIds: [humanAgentId, created.agentId] } },
    });

    return withRateLimitHeaders(Response.json(created, { status: 201 }), limit);
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof RbacError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Failed to create agent", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

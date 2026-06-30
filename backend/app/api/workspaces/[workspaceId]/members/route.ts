export const runtime = "nodejs";

import { isAuthEnabled, requireSession, getSession, AuthError } from "@/lib/auth";
import {
  requireWorkspaceRole,
  addWorkspaceMember,
  listWorkspaceMembers,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
  getWorkspaceRole,
  RbacError,
  type WorkspaceRole,
} from "@/lib/rbac";
import { checkRateLimit, RATE_LIMITS, withRateLimitHeaders, rateLimitExceededResponse } from "@/lib/rate-limiter";

/**
 * GET /api/workspaces/[workspaceId]/members
 * List workspace members. Requires member+ role.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params;

    // Rate limiting
    const session = await getSession(req);
    const userId = session?.id ?? "anonymous";
    const limit = checkRateLimit(`user:${userId}:api`, RATE_LIMITS.api);
    if (!limit.allowed) return rateLimitExceededResponse(limit);

    if (isAuthEnabled()) {
      if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
      await requireWorkspaceRole(session, workspaceId, "member");
    }

    const members = await listWorkspaceMembers(workspaceId);
    return withRateLimitHeaders(Response.json({ members }), limit);
  } catch (e) {
    if (e instanceof AuthError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof RbacError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    return Response.json(
      { error: "Failed to list members", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/**
 * POST /api/workspaces/[workspaceId]/members
 * Add a member to the workspace. Requires admin+ role.
 * Body: { userId: string, role?: "admin" | "member" | "viewer" }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params;

    // Rate limiting
    const session = await getSession(req);
    const userId = session?.id ?? "anonymous";
    const limit = checkRateLimit(`user:${userId}:api`, RATE_LIMITS.api);
    if (!limit.allowed) return rateLimitExceededResponse(limit);

    if (isAuthEnabled()) {
      if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
      await requireWorkspaceRole(session, workspaceId, "admin");
    }

    const body = (await req.json().catch(() => null)) as {
      userId?: string;
      role?: WorkspaceRole;
    } | null;

    if (!body?.userId) {
      return Response.json({ error: "Missing userId" }, { status: 400 });
    }

    const role: WorkspaceRole = body.role ?? "member";

    // Validate role
    const validRoles: WorkspaceRole[] = ["owner", "admin", "member", "viewer"];
    if (!validRoles.includes(role)) {
      return Response.json({ error: `Invalid role: ${role}` }, { status: 400 });
    }

    // Don't allow adding someone as "owner" via this endpoint
    if (role === "owner") {
      return Response.json(
        { error: "Cannot assign owner role directly. Use PATCH to transfer ownership." },
        { status: 400 }
      );
    }

    await addWorkspaceMember(workspaceId, body.userId, role);
    return withRateLimitHeaders(Response.json({ ok: true, userId: body.userId, role }, { status: 201 }), limit);
  } catch (e) {
    if (e instanceof AuthError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof RbacError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    // Handle unique constraint violation (duplicate member)
    if (e instanceof Error && e.message.includes("workspace_members_unique_idx")) {
      return Response.json({ error: "User is already a member of this workspace" }, { status: 409 });
    }
    return Response.json(
      { error: "Failed to add member", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/workspaces/[workspaceId]/members
 * Remove a member from the workspace. Requires admin+ role.
 * Body: { userId: string }
 * Cannot remove the owner.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params;

    // Rate limiting
    const session = await getSession(req);
    const userId = session?.id ?? "anonymous";
    const limit = checkRateLimit(`user:${userId}:api`, RATE_LIMITS.api);
    if (!limit.allowed) return rateLimitExceededResponse(limit);

    if (isAuthEnabled()) {
      if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
      await requireWorkspaceRole(session, workspaceId, "admin");
    }

    const body = (await req.json().catch(() => null)) as {
      userId?: string;
    } | null;

    if (!body?.userId) {
      return Response.json({ error: "Missing userId" }, { status: 400 });
    }

    // Check if the target user is the owner — can't remove owners
    if (isAuthEnabled() && session) {
      const targetRole = await getWorkspaceRole(body.userId, workspaceId);
      if (targetRole === "owner") {
        return Response.json(
          { error: "Cannot remove the workspace owner" },
          { status: 403 }
        );
      }
    }

    await removeWorkspaceMember(workspaceId, body.userId);
    return withRateLimitHeaders(Response.json({ ok: true, userId: body.userId }), limit);
  } catch (e) {
    if (e instanceof AuthError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof RbacError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    return Response.json(
      { error: "Failed to remove member", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/workspaces/[workspaceId]/members
 * Update a member's role. Requires admin+ role.
 * Body: { userId: string, role: "admin" | "member" | "viewer" }
 * Cannot change owner role. Only owner can transfer ownership.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const { workspaceId } = await params;

    // Rate limiting
    const session = await getSession(req);
    const userId = session?.id ?? "anonymous";
    const limit = checkRateLimit(`user:${userId}:api`, RATE_LIMITS.api);
    if (!limit.allowed) return rateLimitExceededResponse(limit);

    if (isAuthEnabled()) {
      if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
      await requireWorkspaceRole(session, workspaceId, "admin");
    }

    const body = (await req.json().catch(() => null)) as {
      userId?: string;
      role?: WorkspaceRole;
    } | null;

    if (!body?.userId || !body?.role) {
      return Response.json({ error: "Missing userId or role" }, { status: 400 });
    }

    const validRoles: WorkspaceRole[] = ["admin", "member", "viewer"];
    if (!validRoles.includes(body.role)) {
      return Response.json(
        { error: `Invalid role: ${body.role}. Must be one of: ${validRoles.join(", ")}` },
        { status: 400 }
      );
    }

    // Check if target is currently the owner — can't demote owner via this endpoint
    if (isAuthEnabled() && session) {
      const targetRole = await getWorkspaceRole(body.userId, workspaceId);
      if (targetRole === "owner") {
        return Response.json(
          { error: "Cannot change owner role. Transfer ownership first." },
          { status: 403 }
        );
      }
    }

    await updateWorkspaceMemberRole(workspaceId, body.userId, body.role);
    return withRateLimitHeaders(Response.json({ ok: true, userId: body.userId, role: body.role }), limit);
  } catch (e) {
    if (e instanceof AuthError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof RbacError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    return Response.json(
      { error: "Failed to update member role", message: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

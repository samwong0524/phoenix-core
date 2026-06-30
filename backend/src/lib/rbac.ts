/**
 * Phoenix-Core RBAC — Workspace-level role-based access control
 *
 * Design decisions:
 * - Global admins bypass all workspace-level checks
 * - DEV_MODE: when isAuthEnabled() is false, all checks pass
 * - Legacy workspaces (created before RBAC) are auto-seeded with the
 *   first user who accesses them as "owner" (one-time migration)
 * - Role hierarchy: owner (100) > admin (80) > member (50) > viewer (10)
 */

import { getDb } from "@/db";
import { workspaces, workspaceMembers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { isAuthEnabled, type SessionUser } from "./auth";

export type WorkspaceRole = "owner" | "admin" | "member" | "viewer";

const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  owner: 100,
  admin: 80,
  member: 50,
  viewer: 10,
};

/**
 * Get a user's role in a workspace. Returns null if not a member.
 * Auto-seeds legacy workspaces (no members at all) on first access.
 */
export async function getWorkspaceRole(
  userId: string,
  workspaceId: string
): Promise<WorkspaceRole | null> {
  const db = getDb();

  const [membership] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    )
    .limit(1);

  if (membership) {
    return membership.role as WorkspaceRole;
  }

  // Auto-seed legacy workspace: if no members exist at all for this workspace,
  // the workspace was created before RBAC. Seed the current user as owner.
  const existingMembers = await db
    .select({ id: workspaceMembers.id })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .limit(1);

  if (existingMembers.length === 0) {
    // Check that the workspace itself exists
    const [ws] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    if (ws) {
      await addWorkspaceMember(workspaceId, userId, "owner");
      return "owner";
    }
  }

  return null;
}

/**
 * Require that the session user has at least `minRole` in the workspace.
 * Global admins always pass. In DEV_MODE (auth disabled), always passes.
 * Throws an Error with a descriptive message on failure.
 */
export async function requireWorkspaceRole(
  session: SessionUser,
  workspaceId: string,
  minRole: WorkspaceRole
): Promise<void> {
  // DEV_MODE: auth disabled → everything passes
  if (!isAuthEnabled()) return;

  // Global admin bypass
  if (session.role === "admin") return;

  const wsRole = await getWorkspaceRole(session.id, workspaceId);
  if (!wsRole) {
    throw new RbacError("Not a member of this workspace", 403);
  }
  if (ROLE_HIERARCHY[wsRole] < ROLE_HIERARCHY[minRole]) {
    throw new RbacError(
      `Requires at least '${minRole}' role in this workspace (you are '${wsRole}')`,
      403
    );
  }
}

/**
 * Check if session user has at least `minRole` in the workspace.
 * Returns boolean instead of throwing.
 */
export async function hasWorkspaceRole(
  session: SessionUser,
  workspaceId: string,
  minRole: WorkspaceRole
): Promise<boolean> {
  if (!isAuthEnabled()) return true;
  if (session.role === "admin") return true;

  const wsRole = await getWorkspaceRole(session.id, workspaceId);
  if (!wsRole) return false;
  return ROLE_HIERARCHY[wsRole] >= ROLE_HIERARCHY[minRole];
}

/** Add a user as a member of a workspace with the given role. */
export async function addWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: WorkspaceRole = "member"
) {
  const db = getDb();
  await db.insert(workspaceMembers).values({
    id: crypto.randomUUID(),
    workspaceId,
    userId,
    role,
    createdAt: new Date(),
  });
}

/** List all members of a workspace. */
export async function listWorkspaceMembers(workspaceId: string) {
  const db = getDb();
  return db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, workspaceId));
}

/** Remove a user from a workspace. */
export async function removeWorkspaceMember(workspaceId: string, userId: string) {
  const db = getDb();
  await db
    .delete(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    );
}

/** Update a member's role in a workspace. */
export async function updateWorkspaceMemberRole(
  workspaceId: string,
  userId: string,
  newRole: WorkspaceRole
) {
  const db = getDb();
  await db
    .update(workspaceMembers)
    .set({ role: newRole })
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    );
}

// ─── Error class ──────────────────────────────────────

export class RbacError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "RbacError";
  }
}

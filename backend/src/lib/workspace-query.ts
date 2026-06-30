/**
 * Phoenix-Core Workspace Query — Scoped data access helpers
 *
 * Design decisions:
 * - authorizeWorkspaceAccess() combines auth + RBAC into one call
 * - scopedQuery() enforces workspaceId filter on DB queries (prevents leakage)
 * - DEV_MODE: when auth is disabled, returns mock session with owner role
 * - Global admins (role="admin") bypass workspace membership checks
 */

import { getDb } from "@/db";
import { eq, sql, type SQL } from "drizzle-orm";
import type { PgTable, TableConfig } from "drizzle-orm/pg-core";
import { getSession, isAuthEnabled, type SessionUser } from "./auth";
import { getWorkspaceRole, type WorkspaceRole } from "./rbac";

// ─── Types ────────────────────────────────────────────

export interface AuthorizedContext {
  session: SessionUser;
  wsRole: WorkspaceRole;
}

// ─── Authorization ────────────────────────────────────

/**
 * Validates that the current user has access to the given workspace.
 * Returns the session and workspace role if authorized, or null if not.
 *
 * In DEV_MODE (auth disabled), returns a mock context with owner role.
 * Global admins (role="admin") get owner-equivalent access.
 */
export async function authorizeWorkspaceAccess(
  req: Request,
  workspaceId: string
): Promise<AuthorizedContext | null> {
  // DEV_MODE: no auth → allow everything
  if (!isAuthEnabled()) {
    return {
      session: {
        id: "dev-user",
        email: "dev@local",
        name: "Dev Mode",
        role: "admin",
      },
      wsRole: "owner",
    };
  }

  const session = await getSession(req);
  if (!session) return null;

  // Global admin bypass — treat as owner in any workspace
  if (session.role === "admin") {
    return { session, wsRole: "owner" };
  }

  const wsRole = await getWorkspaceRole(session.id, workspaceId);
  if (!wsRole) return null;

  return { session, wsRole };
}

// ─── Scoped Query Builder ─────────────────────────────

/**
 * Creates a workspace-scoped query helper that automatically filters by workspaceId.
 * This prevents cross-workspace data leakage at the query level.
 *
 * Usage:
 *   const q = scopedQuery(agents, workspaceId);
 *   const rows = await q.select();
 *   const total = await q.count();
 */
export function scopedQuery(
  table: PgTable<TableConfig> & { workspaceId: any },
  workspaceId: string
) {
  const db = getDb();

  return {
    /**
     * Select rows from the table, filtered by workspaceId.
     * Optionally pass specific columns to select.
     */
    select: (columns?: Record<string, any>) => {
      if (columns) {
        return db.select(columns).from(table).where(eq(table.workspaceId, workspaceId));
      }
      return db.select().from(table).where(eq(table.workspaceId, workspaceId));
    },

    /**
     * Count rows in the table for this workspace.
     */
    count: async (): Promise<number> => {
      const [result] = await db
        .select({ count: sql<number>`count(*)` })
        .from(table)
        .where(eq(table.workspaceId, workspaceId));
      return result?.count ?? 0;
    },
  };
}

export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { getAgentRuntime } from "@/runtime/agent-runtime";
import { getWorkspaceUIBus } from "@/runtime/ui-bus";
import { getDb } from "@/db";
import { agents, groupMembers, groups, messages } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { isAuthEnabled, getSession, AuthError } from "@/lib/auth";
import { requireWorkspaceRole, RbacError } from "@/lib/rbac";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const trimmedAgentId = agentId?.trim();
  if (!trimmedAgentId) {
    return Response.json({ error: "Missing agentId" }, { status: 400 });
  }

  const agent = await store.getAgent({ agentId: trimmedAgentId });
  return Response.json({
    agentId: agent.id,
    role: agent.role,
    llmHistory: agent.llmHistory,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const trimmedAgentId = agentId?.trim();
  if (!trimmedAgentId) {
    return Response.json({ error: "Missing agentId" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as { llmHistory?: string } | null;
  if (!body || body.llmHistory === undefined) {
    return Response.json({ error: "Missing llmHistory" }, { status: 400 });
  }

  const agent = await store.getAgent({ agentId: trimmedAgentId });
  await store.setAgentHistory({
    agentId: trimmedAgentId,
    llmHistory: body.llmHistory,
    workspaceId: agent.workspaceId,
  });

  return Response.json({ success: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const trimmedAgentId = agentId?.trim();
  if (!trimmedAgentId) {
    return Response.json({ error: "Missing agentId" }, { status: 400 });
  }

  try {
    const body = (await req.json().catch(() => null)) as { workspaceId?: string } | null;
    const workspaceId = body?.workspaceId;
    if (!workspaceId) {
      return Response.json({ error: "Missing workspaceId" }, { status: 400 });
    }

    // Auth check
    if (isAuthEnabled()) {
      const session = await getSession(req);
      if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
      await requireWorkspaceRole(session, workspaceId, "member");
    }

    const agent = await store.getAgent({ agentId: trimmedAgentId });

    // Prevent deleting the human (owner) agent
    const ws = await store.ensureWorkspaceDefaults({ workspaceId });
    if (ws.humanAgentId === trimmedAgentId) {
      return Response.json({ error: "Cannot delete the workspace owner agent" }, { status: 403 });
    }

    const db = getDb();

    await db.transaction(async (tx) => {
      // Find groups this agent belongs to
      const memberships = await tx
        .select({ groupId: groupMembers.groupId })
        .from(groupMembers)
        .where(eq(groupMembers.userId, trimmedAgentId));

      const groupIds = memberships.map((m) => m.groupId);

      // For each group, check if it will be empty (no other members) after removing this agent
      for (const gid of groupIds) {
        const remaining = await tx
          .select({ userId: groupMembers.userId })
          .from(groupMembers)
          .where(and(eq(groupMembers.groupId, gid)));
        const otherMembers = remaining.filter((m) => m.userId !== trimmedAgentId);
        if (otherMembers.length === 0) {
          // Delete messages in this group
          await tx.delete(messages).where(eq(messages.groupId, gid));
          // Delete the group itself
          await tx.delete(groups).where(eq(groups.id, gid));
        } else {
          // Just remove this agent's membership
          await tx.delete(groupMembers).where(
            and(eq(groupMembers.groupId, gid), eq(groupMembers.userId, trimmedAgentId))
          );
        }
      }

      // Delete the agent
      await tx.delete(agents).where(eq(agents.id, trimmedAgentId));
    });

    // Stop the agent runner
    const runtime = getAgentRuntime();
    runtime.stopRunner(trimmedAgentId);

    // Emit UI events
    getWorkspaceUIBus().emit(workspaceId, {
      event: "ui.agent.deleted",
      data: { workspaceId, agentId: trimmedAgentId, role: agent.role },
    });

    return Response.json({ success: true, agentId: trimmedAgentId });
  } catch (e) {
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof RbacError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Failed to delete agent", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

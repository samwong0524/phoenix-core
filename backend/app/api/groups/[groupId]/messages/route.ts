export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { getAgentRuntime } from "@/runtime/agent-runtime";
import { getWorkspaceUIBus } from "@/runtime/ui-bus";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const url = new URL(req.url);
  const markRead = url.searchParams.get("markRead") === "true";
  const readerId = url.searchParams.get("readerId") ?? undefined;

  const messages = await store.listMessages({
    groupId,
  });

  if (markRead && readerId) {
    await store.markGroupRead({ groupId, readerId });
  }

  return Response.json({ messages });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ groupId: string }> }
) {
  const { groupId } = await params;
  const body = (await req.json().catch(() => null)) as {
    senderId: string;
    content: string;
    contentType?: string;
  } | null;
  if (!body) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.senderId || !body.content) {
    return Response.json({ error: "Missing senderId or content" }, { status: 400 });
  }

  // Validate senderId is a known agent in the workspace
  const workspaceId = await store.getGroupWorkspaceId({ groupId });
  const agents = await store.listAgents({ workspaceId });
  const agent = agents.find((a) => a.id === body.senderId);
  if (!agent) {
    // Warn but don't block — this is a dev tool without auth
    console.warn(
      `[messages] senderId "${body.senderId}" not found in workspace ${workspaceId}, allowing through`
    );
  }

  const result = await store.sendMessage({
    groupId,
    senderId: body.senderId,
    content: body.content,
    contentType: body.contentType ?? "text",
  });

  const memberIds = await store.listGroupMemberIds({ groupId });
  getWorkspaceUIBus().emit(workspaceId, {
    event: "ui.message.created",
    data: {
      workspaceId,
      groupId,
      memberIds,
      message: { id: result.id, senderId: body.senderId, sendTime: result.sendTime },
    },
  });

  const runtime = getAgentRuntime();
  try {
    await runtime.wakeAgentsForGroup(groupId, body.senderId);
  } catch (err) {
    console.error("[messages.route.ts] wakeAgentsForGroup failed:", err);
  }

  return Response.json(result, { status: 201 });
}

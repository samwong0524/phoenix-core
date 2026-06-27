export const runtime = "nodejs";

import { store } from "@/lib/storage";

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

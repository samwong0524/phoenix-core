export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { getAgentRuntime } from "@/runtime/agent-runtime";

type HistoryMessage = {
  role: string;
  content?: string | unknown[];
  tool_calls?: Array<{ id: string; type: string; function?: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const trimmedAgentId = agentId?.trim();
  if (!trimmedAgentId) {
    return Response.json({ error: "Missing agentId" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as {
    toolCallId?: string;
    groupId?: string;
  } | null;

  if (!body?.toolCallId) {
    return Response.json({ error: "Missing toolCallId" }, { status: 400 });
  }

  let agent;
  try {
    agent = await store.getAgent({ agentId: trimmedAgentId });
  } catch {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  // Parse llmHistory
  let history: HistoryMessage[];
  try {
    history = JSON.parse(agent.llmHistory || "[]");
  } catch {
    return Response.json({ error: "Invalid llmHistory" }, { status: 500 });
  }

  // Find the failed tool result message
  const toolResultIdx = history.findIndex(
    (msg) => msg.role === "tool" && msg.tool_call_id === body.toolCallId
  );

  if (toolResultIdx === -1) {
    return Response.json({ error: "Tool call not found in history" }, { status: 404 });
  }

  // Remove the tool result message
  history.splice(toolResultIdx, 1);

  // Also remove any subsequent system messages that reference the failed tool
  // (e.g., "[turn N] tool blocked" messages)
  while (
    toolResultIdx < history.length &&
    history[toolResultIdx]?.role === "system"
  ) {
    history.splice(toolResultIdx, 1);
  }

  // Save modified history
  await store.setAgentHistory({
    agentId: trimmedAgentId,
    llmHistory: JSON.stringify(history),
    workspaceId: agent.workspaceId,
  });

  // Reset guardrails on the runner
  const runtime = getAgentRuntime();
  const runner = runtime.getRunner(trimmedAgentId);
  if (runner) {
    runner.resetGuardrails();
  }

  // Wake the agent to re-process
  if (body.groupId) {
    await runtime.wakeAgent(trimmedAgentId, "retry_tool_call");
  } else {
    runtime.ensureRunner(trimmedAgentId).wakeup("retry_tool_call");
  }

  return Response.json({
    success: true,
    toolCallId: body.toolCallId,
    historyLength: history.length,
  });
}

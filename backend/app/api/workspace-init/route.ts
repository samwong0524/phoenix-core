export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { getConfig } from "@/lib/config";
import { existsSync, statSync } from "node:fs";

// Models are fetched separately via /api/models (60s cache).
// Not included here to avoid blocking init on FreeLLMAPI latency.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const overrideWorkspaceId = url.searchParams.get("overrideWorkspaceId");
  const workingDir = url.searchParams.get("workingDir")?.trim();

  // Set working directory for agent runtime if provided and valid
  if (workingDir) {
    if (existsSync(workingDir) && statSync(workingDir).isDirectory()) {
      process.env.AGENT_WORKDIR = workingDir;
    } else {
      console.warn(`[workspace-init] workingDir does not exist or is not a directory: ${workingDir}`);
    }
  }

  // Resolve workspace session
  const targetId = overrideWorkspaceId || workspaceId;
  if (!targetId) {
    return Response.json(
      { error: "workspaceId or overrideWorkspaceId required" },
      { status: 400 },
    );
  }

  const session = await store.ensureWorkspaceDefaults({ workspaceId: targetId });

  // Pure local DB calls — no external HTTP, sub-200ms total
  const [config, agents, groups] = await Promise.all([
    getConfig(),
    store.listAgentsMeta({ workspaceId: session.workspaceId }),
    store.listGroups({ workspaceId: session.workspaceId, agentId: session.humanAgentId }),
  ]);

  return Response.json({
    session,
    config: { tokenLimit: config.tokenLimit },
    agents,
    groups,
  });
}

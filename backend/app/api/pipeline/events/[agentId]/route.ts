export const runtime = "nodejs";

import { getWorkspaceUIBus } from "@/runtime/ui-bus";

function sse(data: unknown) {
  return new TextEncoder().encode("data: " + JSON.stringify(data) + "\n\n");
}

/**
 * Per-agent SSE endpoint for pipeline events.
 * GET /api/pipeline/events/[agentId]
 * Subscribes to pipeline.* events filtered by the given agentId.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendKeepalive = () => controller.enqueue(new TextEncoder().encode(": ping\n\n"));
      const keepaliveInterval = setInterval(sendKeepalive, 30000);

      const uiBus = getWorkspaceUIBus();

      const unsub = uiBus.subscribe("default", (_evt: any) => {
        // Only forward pipeline events that involve this agent
        if (!_evt.event.startsWith("pipeline.")) return;
        const data = _evt.data as Record<string, unknown> | undefined;
        if (data && data.agentId && data.agentId !== agentId) return;
        controller.enqueue(sse({ event: _evt.event, data: _evt.data }));
      });

      const cleanup = () => {
        clearInterval(keepaliveInterval);
        unsub();
      };

      const checkDisconnect = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(""));
        } catch {
          cleanup();
          clearInterval(checkDisconnect);
        }
      }, 5000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

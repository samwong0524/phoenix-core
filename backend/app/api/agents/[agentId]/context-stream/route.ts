export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { getAgentRuntime } from "@/runtime/agent-runtime";
import { getUpstashRealtime } from "@/runtime/upstash-realtime";

function sseWithId(id: string | number | null | undefined, data: unknown) {
  const prefix =
    typeof id === "string"
      ? `id: ${id}\n`
      : typeof id === "number"
        ? `id: ${id}\n`
        : "";
  return new TextEncoder().encode(`${prefix}data: ${JSON.stringify(data)}\n\n`);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  new URL(req.url);
  const agent = await store.getAgent({ agentId });
  const runtime = getAgentRuntime();
  await runtime.bootstrap(agent.workspaceId);
  if (agent.role !== "human") {
    void runtime.wakeAgent(agentId, "context_stream");
  }
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendKeepalive = () => controller.enqueue(new TextEncoder().encode(`: ping\n\n`));

      let upstashUnsubscribe: (() => void) | null = null;
      let inMemoryUnsubscribe: (() => void) | null = null;

      // Redis channel (primary)
      try {
        const channel = getUpstashRealtime().channel(`agent:${agentId}`);
        upstashUnsubscribe = await channel.subscribe({
          events: ["agent.wakeup", "agent.unread", "agent.stream", "agent.done", "agent.error"],
          history: { start: "-" as any, end: "+" as any, limit: 2000 },
          onData: (evt) => {
            const payload = {
              event: evt.event,
              data: (evt.data as any)?.data ?? evt.data,
            };
            controller.enqueue(sseWithId((evt as any).id, payload));
          },
        });
      } catch {
        // Redis unavailable — memory bus will serve as fallback
      }

      // Memory event bus fallback (design doc §12.2 E24)
      const bus = runtime.bus;
      const history = bus.getSince(agentId, 0);
      for (const evt of history) {
        controller.enqueue(sseWithId(evt.id, { event: evt.event, data: evt.data }));
      }
      inMemoryUnsubscribe = bus.subscribe(agentId, (evt) => {
        controller.enqueue(sseWithId(evt.id, { event: evt.event, data: evt.data }));
      });

      const keepalive = setInterval(sendKeepalive, 15_000);

      const abortHandler = async () => {
        clearInterval(keepalive);
        upstashUnsubscribe?.();
        inMemoryUnsubscribe?.();
        try {
          controller.close();
        } catch {
          // ignore double-close
        }
      };

      if (req.signal.aborted) void abortHandler();
      req.signal.addEventListener("abort", () => void abortHandler(), { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Encoding": "none",
    },
  });
}

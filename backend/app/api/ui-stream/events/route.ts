export const runtime = "nodejs";

import { getWorkspaceUIBus } from "@/runtime/ui-bus";

function sse(data: unknown) {
  return new TextEncoder().encode("data: " + JSON.stringify(data) + "\n\n");
}

export async function GET(_req: Request) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendKeepalive = () => controller.enqueue(new TextEncoder().encode(": ping\n\n"));
      const keepaliveInterval = setInterval(sendKeepalive, 30000);

      const uiBus = getWorkspaceUIBus();

      const unsub = uiBus.subscribe("default", (_evt: any) => {
        if (_evt.event.startsWith("pipeline.")) {
          controller.enqueue(sse({ event: _evt.event, data: _evt.data }));
        }
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

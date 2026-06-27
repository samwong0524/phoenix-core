type AgentEvent =
  | {
      id: number;
      at: number;
      event: "agent.wakeup";
      data: { agentId: string; reason?: string | null };
    }
  | {
      id: number;
      at: number;
      event: "agent.unread";
      data: {
        agentId: string;
        batches: Array<{
          groupId: string;
          messageIds: string[];
        }>;
      };
    }
  | {
      id: number;
      at: number;
      event: "agent.stream";
      data: {
        kind: "reasoning" | "content" | "tool_calls" | "tool_result";
        delta: string;
        tool_call_id?: string;
        tool_call_name?: string;
      };
    }
  | {
      id: number;
      at: number;
      event: "agent.done";
      data: { finishReason?: string | null };
    }
  | {
      id: number;
      at: number;
      event: "agent.error";
      data: { message: string };
    }
    | {
      id: number;
      at: number;
      event: "pipeline.start";
      data: { pipelineId: string; workflowId: string; groupId: string; stageCount: number };
    }
    | {
      id: number;
      at: number;
      event: "pipeline.stage_start";
      data: { pipelineId: string; stageName: string; role: string };
    }
    | {
      id: number;
      at: number;
      event: "pipeline.stage_complete";
      data: { pipelineId: string; stageName: string; status: string; output: string };
    }
    | {
      id: number;
      at: number;
      event: "pipeline.stage_done";
      data: { agentId: string; groupId: string; stageName: string; output: string };
    }
    | {
      id: number;
      at: number;
      event: "pipeline.complete";
      data: { pipelineId: string; overallStatus: string };
    }
    | {
      id: number;
      at: number;
      event: "pipeline.review";
      data: { pipelineId: string; stageName: string; output: string };
    };

type Listener = (evt: AgentEvent) => void;

type ChannelState = {
  nextId: number;
  buffer: AgentEvent[];
  listeners: Set<Listener>;
  persistQueue: Promise<void>;
};

const DEFAULT_MAX_BUFFER = 2000;

export class AgentEventBus {
  private readonly channels = new Map<string, ChannelState>();
  private _crossInstanceInitialized = false;
  private _remoteSub: { unsubscribe: () => void } | null = null;
  constructor(private readonly maxBuffer = DEFAULT_MAX_BUFFER) {}

  private getChannel(agentId: string): ChannelState {
    const existing = this.channels.get(agentId);
    if (existing) return existing;

    const created: ChannelState = {
      nextId: 1,
      buffer: [],
      listeners: new Set(),
      persistQueue: Promise.resolve(),
    };
    this.channels.set(agentId, created);
    return created;
  }

  emit(agentId: string, event: Omit<AgentEvent, "id" | "at">) {
    const channel = this.getChannel(agentId);
    const evt = { ...event, id: channel.nextId++, at: Date.now() } as AgentEvent;

    channel.buffer.push(evt);
    if (channel.buffer.length > this.maxBuffer) {
      channel.buffer.splice(0, channel.buffer.length - this.maxBuffer);
    }

    // Best-effort persistence for cross-process/history replay (optional).
    // Serialize per-agent writes to preserve event order in Upstash.
    channel.persistQueue = channel.persistQueue
      .catch(() => undefined)
      .then(() => persistAgentEvent(agentId, evt));

    // Cross-instance propagation: publish to Redis pub/sub so other instances
    // running the same agent receive this event in real time.
    this.publishCrossInstance(agentId, { event: evt.event, data: evt.data });

    for (const listener of channel.listeners) {
      listener(evt);
    }
  }

  subscribe(agentId: string, listener: Listener): () => void {
    const channel = this.getChannel(agentId);
    channel.listeners.add(listener);
    return () => {
      channel.listeners.delete(listener);
    };
  }

  getSince(agentId: string, afterId: number): AgentEvent[] {
    const channel = this.getChannel(agentId);
    return channel.buffer.filter((e) => e.id > afterId);
  }

  getLatestId(agentId: string): number {
    const channel = this.getChannel(agentId);
    return channel.nextId - 1;
  }

  /**
   * Initialize cross-instance event bus pub/sub.
   * Subscribes to the agent:all Redis pub/sub channel and routes
   * remote events into the local listener set for each agent channel.
   */
  async initCrossInstance(): Promise<void> {
    if (this._crossInstanceInitialized) return;
    this._crossInstanceInitialized = true;
    if (this._remoteSub) return;
    try {
      const { getRedisClient, isUpstashRealtimeConfigured } = await import('./upstash-realtime');
      if (!isUpstashRealtimeConfigured()) return;
      const redisClient = await getRedisClient();
      const subscriber = this._createSubscriber(redisClient);
      this._remoteSub = subscriber;
    } catch {
      // Redis not available
    }
  }

  /**
   * Publish an event to the cross-instance pub/sub channel so that
   * other instances running the same agent can receive it.
   */
  private async publishCrossInstance(agentId: string, payload: RemoteEventPayload): Promise<void> {
    try {
      const { getRedisClient, isUpstashRealtimeConfigured } = await import('./upstash-realtime');
      if (!isUpstashRealtimeConfigured()) return;
      const client = await getRedisClient();
      await client.publish('agent:all', JSON.stringify({ agentId, ...payload }));
    } catch {
      // publish is best-effort
    }
  }

  /**
   * Create and wire up a Redis subscriber for the agent:all channel.
   */
  private _createSubscriber(redisClient: unknown): { unsubscribe: () => void } {
   const client = redisClient as { on: (ev: string, fn: (...args: unknown[]) => void) => void; subscribe?: (ch: string) => Promise<void> };
   let unsubscribed = false;
    const handler = (...args: unknown[]) => {
      if (unsubscribed) return;
      try {
        const message = args.length >= 2 && typeof args[1] === 'string' ? args[1] : '';
        if (!message) return;
        const parsed: RemoteEventPayload & { agentId: string } = JSON.parse(message);
        this.mergeRemoteEvent(parsed.agentId, {
         event: parsed.event as AgentEvent['event'],
          data: parsed.data as AgentEvent['data'],
        });
      } catch {
        // ignore parse errors
      }
    };
    client.on('message', handler);
    client.subscribe?.('agent:all').catch(() => undefined);
    return { unsubscribe: () => { unsubscribed = true; } };
  }

  /**
   * Merge a remotely-published event into the local channel buffer
   * and dispatch it to all local listeners.
   */
  mergeRemoteEvent(agentId: string, evt: Omit<AgentEvent, 'id' | 'at'>): void {
    const channel = this.getChannel(agentId);
    const remoteEvt = { ...evt, id: channel.nextId++, at: Date.now() } as AgentEvent;
    channel.buffer.push(remoteEvt);
    if (channel.buffer.length > this.maxBuffer) {
      channel.buffer.splice(0, channel.buffer.length - this.maxBuffer);
    }
    for (const listener of channel.listeners) {
      listener(remoteEvt);
    }
  }
}




type RemoteEventPayload = {
  event: string;
  data: unknown;
};

export type { AgentEvent };

async function persistAgentEvent(agentId: string, evt: AgentEvent) {
  const { isUpstashRealtimeConfigured, getUpstashRealtime } = await import("./upstash-realtime");
  if (!isUpstashRealtimeConfigured()) return;
  try {
    await getUpstashRealtime().channel(`agent:${agentId}`).emit(evt.event, {
      id: evt.id,
      at: evt.at,
      data: evt.data,
    });
  } catch (err) {
    console.warn("[emitToUpstash] event publish failed:", err);
  }
}

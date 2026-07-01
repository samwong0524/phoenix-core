export type UIEvent =
  | {
      id: number;
      at: number;
      event: "ui.agent.created";
      data: { workspaceId: string; agent: { id: string; role: string; parentId: string | null } };
    }
  | {
      id: number;
      at: number;
      event: "ui.group.created";
      data: { workspaceId: string; group: { id: string; name: string | null; memberIds: string[] } };
    }
  | {
      id: number;
      at: number;
      event: "ui.group.member_added";
      data: { workspaceId: string; groupId: string; addedMemberIds: string[]; memberIds: string[] };
    }
  | {
      id: number;
      at: number;
      event: "ui.message.created";
      data: {
        workspaceId: string;
        groupId: string;
        memberIds?: string[];
        message: { id: string; senderId: string; sendTime: string };
      };
    }
  | {
      id: number;
      at: number;
      event: "ui.agent.llm.start";
      data: { workspaceId: string; agentId: string; groupId: string; round: number };
    }
  | {
      id: number;
      at: number;
      event: "ui.agent.llm.done";
      data: {
        workspaceId: string;
        agentId: string;
        groupId: string;
        round: number;
        finishReason?: string | null;
      };
    }
  | {
      id: number;
      at: number;
      event: "ui.agent.llm.fallback";
      data: { workspaceId: string; agentId: string; groupId: string; from: string; to: string };
    }
  | {
      id: number;
      at: number;
      event: "ui.agent.history.persisted";
      data: { workspaceId: string; agentId: string; groupId: string; historyLength: number };
    }
  | {
      id: number;
      at: number;
      event: "ui.agent.tool_call.start";
      data: { workspaceId: string; agentId: string; groupId: string; toolCallId?: string; toolName?: string };
    }
  | {
      id: number;
      at: number;
      event: "ui.agent.tool_call.done";
      data: {
        workspaceId: string;
        agentId: string;
        groupId: string;
        toolCallId?: string;
        toolName?: string;
        ok: boolean;
      };
    }
  | {
      id: number;
      at: number;
      event: "ui.agent.working.start";
      data: { workspaceId: string; agentId: string };
    }
  | {
      id: number;
      at: number;
      event: "ui.agent.working.done";
      data: { workspaceId: string; agentId: string };
    }
  | {
      id: number;
      at: number;
      event: "ui.agent.interrupt_all";
      data: { workspaceId: string; interrupted: number; agentIds: string[] };
    }
  | {
      id: number;
      at: number;
      event: "ui.agent.deleted";
      data: { workspaceId: string; agentId: string; role: string };
    }
  | {
      id: number;
      at: number;
      event: "ui.db.write";
      data: {
        workspaceId: string;
        table: string;
        action: "insert" | "update" | "delete";
        recordId?: string | null;
      };
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
    }
  | {
      id: number;
      at: number;
      event: "llm.429";
      data: { agentId: string; workspaceId: string; retryAfter: number };
    }
  | {
      id: number;
      at: number;
      event: "ui.skill.suggestion";
      data: {
        workspaceId: string;
        agentId: string;
        groupId: string;
        skillName: string;
        confidence: number;
        reason: string;
        triggerPattern: string;
      };
    };

type Listener = (evt: UIEvent) => void;

type ChannelState = {
  nextId: number;
  buffer: UIEvent[];
  listeners: Set<Listener>;
};

const DEFAULT_MAX_BUFFER = 2000;

export class WorkspaceUIBus {
  private readonly channels = new Map<string, ChannelState>();
  constructor(private readonly maxBuffer = DEFAULT_MAX_BUFFER) {}

  private getChannel(channelId: string): ChannelState {
    const existing = this.channels.get(channelId);
    if (existing) return existing;
    const created: ChannelState = { nextId: 1, buffer: [], listeners: new Set() };
    this.channels.set(channelId, created);
    return created;
  }

  emit(channelId: string, event: Omit<UIEvent, "id" | "at">) {
    const channel = this.getChannel(channelId);
    const evt = { ...event, id: channel.nextId++, at: Date.now() } as UIEvent;
    channel.buffer.push(evt);
    if (channel.buffer.length > this.maxBuffer) {
      channel.buffer.splice(0, channel.buffer.length - this.maxBuffer);
    }
    for (const listener of channel.listeners) {
      listener(evt);
    }
  }

  subscribe(channelId: string, listener: Listener): () => void {
    const channel = this.getChannel(channelId);
    channel.listeners.add(listener);
    return () => { channel.listeners.delete(listener); };
  }

  getSince(channelId: string, sinceId: number): UIEvent[] {
    const channel = this.channels.get(channelId);
    if (!channel) return [];
    return channel.buffer.filter((e) => e.id > sinceId);
  }

  getAgentEventsSince(agentId: string, sinceId: number): UIEvent[] {
    const events: UIEvent[] = [];
    for (const [, channel] of this.channels) {
      for (const evt of channel.buffer) {
        if (evt.id > sinceId && (evt as any).data?.agentId === agentId) {
          events.push(evt);
        }
      }
    }
    return events;
  }
}

let _workspaceUIBus: WorkspaceUIBus | null = null;
export function getWorkspaceUIBus(): WorkspaceUIBus {
  if (!_workspaceUIBus) {
    _workspaceUIBus = new WorkspaceUIBus();
  }
  return _workspaceUIBus;
}

// ── Canonical IM types ─────────────────────────────────────────
// Single source of truth for page.tsx, store.ts, hooks, and components.

export type UUID = string;

export type ModelEntry = {
  id: string;
  displayName: string;
  platform: string;
};

export type WorkspaceDefaults = {
  workspaceId: UUID;
  humanAgentId: UUID;
  assistantAgentId: UUID;
  defaultGroupId: UUID;
};

export type AgentMeta = {
  id: UUID;
  role: string;
  parentId: UUID | null;
  createdAt: string;
};

export type AgentStatus = "IDLE" | "BUSY" | "WAKING";

export type Group = {
  id: UUID;
  name: string | null;
  memberIds: UUID[];
  unreadCount: number;
  contextTokens: number;
  lastMessage?: {
    content: string;
    contentType: string;
    sendTime: string;
    senderId: UUID;
  };
  updatedAt: string;
  createdAt: string;
};

export type Message = {
  id: UUID;
  senderId: UUID;
  content: string;
  contentType: string;
  sendTime: string;
};

export type UiStreamEvent = {
  id?: number;
  at?: number;
  event: string;
  data: Record<string, any>;
};

export type VizEvent = {
  id: string;
  kind: "agent" | "message" | "llm" | "tool" | "db" | "skill";
  label: string;
  at: number;
};

export type VizBeam = {
  id: string;
  fromId: UUID;
  toId: UUID;
  kind: "create" | "message";
  label?: string;
  createdAt: number;
};

export type VizDebugEntry = {
  id: string;
  at: number;
  type: "message_event" | "beam_created" | "beam_skipped";
  data: Record<string, unknown>;
};

export type RightPanelId = "history" | "content" | "reasoning" | "tools";

export type RightPanelState = {
  id: RightPanelId;
  title: string;
  size: number;
  collapsed: boolean;
};

export type AgentStreamEvent =
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
      event: "agent.wakeup";
      data: { agentId: string; reason?: string | null };
    }
  | {
      id: number;
      at: number;
      event: "agent.unread";
      data: { agentId: string; batches: Array<{ groupId: string; messageIds: string[] }> };
    }
  | { id: number; at: number; event: "agent.done"; data: { finishReason?: string | null } }
  | { id: number; at: number; event: "agent.error"; data: { message: string } };

export type SkillSuggestion = {
  id: string;
  skillName: string;
  confidence: number;
  reason: string;
  triggerPattern: string;
  createdAt: number;
};

export type BootStatus = "boot" | "groups" | "messages" | "send" | "idle";
// Shared types extracted from IMPage
export type UUID = string;

export type ModelEntry = {
  id: string;
  displayName: string;
  platform: string;
};

export type WorkspaceDefaults = {
  workspaceId: string;
  humanAgentId: string;
  assistantAgentId: string;
  defaultGroupId: string;
};

export type AgentMeta = {
  id: string;
  role: string;
  workspaceId: string;
  createdAt: string;
  parentId?: string | null;
};

export type AgentStatus = "IDLE" | "BUSY" | "WAKING";

export type Group = {
  id: string;
  name: string | null;
  creatorId: string;
  memberIds: UUID[];
  lastMessage?: { content: string } | null;
  unreadCount: number;
  contextTokens: number;
};

export type Message = {
  id: string;
  senderId: string;
  content: string;
  contentType: string;
  sendTime: string;
};

export type UiStreamEvent = {
  event: string;
  id?: string;
  at?: number | string;
  data?: Record<string, unknown>;
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
  type: string;
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
  | { event: "agent.stream"; data: { delta: string; kind: string; tool_call_name?: string; tool_call_id?: string } }
  | { event: "agent.wakeup"; data: Record<string, never> }
  | { event: "agent.unread"; data: Record<string, never> }
  | { event: "agent.done"; data: Record<string, never> }
  | { event: "agent.error"; data: { message: string } };
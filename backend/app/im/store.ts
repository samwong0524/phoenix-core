import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

// ── Shared types ──────────────────────────────────────────────

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

export type SkillSuggestion = {
  id: string;
  skillName: string;
  confidence: number;
  reason: string;
  triggerPattern: string;
  createdAt: number;
};

export type RightPanelId = "history" | "content" | "reasoning" | "tools";

export type RightPanelState = {
  id: RightPanelId;
  title: string;
  size: number;
  collapsed: boolean;
};

export type BootStatus = "boot" | "groups" | "messages" | "send" | "idle";

// ── Store interface ───────────────────────────────────────────

export interface IMState {
  // ── Session slice ─────────────────────────────────────────
  session: WorkspaceDefaults | null;
  tokenLimit: number;
  groups: Group[];
  agents: AgentMeta[];
  activeGroupId: string | null;
  availableModels: ModelEntry[];
  selectedModel: string;

  // ── Messages slice ────────────────────────────────────────
  messages: Message[];
  contentStream: string;
  reasoningStream: string;
  toolStream: string;
  llmHistory: string;

  // ── UI slice ──────────────────────────────────────────────
  status: BootStatus;
  error: string | null;
  draft: string;
  reasoningExpanded: boolean;
  agentActivity: string | null;
  agentActivityTool: string;
  agentError: string | null;
  uploading: boolean;
  answeredQuestions: Set<string>;
  stoppingAgents: boolean;
  vizEvents: VizEvent[];
  vizBeams: VizBeam[];
  vizSize: { width: number; height: number };
  vizScale: number;
  vizOffset: { x: number; y: number };
  vizIsPanning: boolean;
  vizDebug: VizDebugEntry[];
  vizEventsCollapsed: boolean;
  rightPanels: RightPanelState[];
  midSplitRatio: number;
  midStackHeight: number;
  nodeOffsets: Record<string, { x: number; y: number }>;
  collapsedAgents: Record<string, boolean>;
  detailsCollapsed: Record<string, boolean>;
  skillList: Array<{ name: string; description: string }>;
  skillPopupOpen: boolean;
  skillFilter: string;
  skillSelectedIndex: number;
  atTriggerPos: number;
  workingDir: string;
  showDirInput: boolean;
  dirBrowsePath: string;
  dirBrowseEntries: Array<{ name: string; fullPath: string }>;
  dirBrowseParent: string | null;
  dirBrowseLoading: boolean;

  // ── Skill suggestions slice (A-05) ────────────────────────
  skillSuggestions: SkillSuggestion[];

  // ── Agent status slice ────────────────────────────────────
  agentStatusById: Record<string, AgentStatus>;

  // ── Session actions ───────────────────────────────────────
  setSession: (session: WorkspaceDefaults | null) => void;
  setTokenLimit: (limit: number) => void;
  setGroups: (groups: Group[] | ((prev: Group[]) => Group[])) => void;
  setAgents: (agents: AgentMeta[] | ((prev: AgentMeta[]) => AgentMeta[])) => void;
  setActiveGroupId: (id: string | null) => void;
  setAvailableModels: (models: ModelEntry[]) => void;
  setSelectedModel: (model: string) => void;

  // ── Messages actions ──────────────────────────────────────
  setMessages: (messages: Message[] | ((prev: Message[]) => Message[])) => void;
  setContentStream: (content: string | ((prev: string) => string)) => void;
  setReasoningStream: (content: string | ((prev: string) => string)) => void;
  setToolStream: (content: string | ((prev: string) => string)) => void;
  setLlmHistory: (history: string) => void;

  // ── UI actions ────────────────────────────────────────────
  setStatus: (status: BootStatus) => void;
  setError: (error: string | null) => void;
  setDraft: (draft: string) => void;
  setReasoningExpanded: (expanded: boolean) => void;
  setAgentActivity: (activity: string | null) => void;
  setAgentActivityTool: (tool: string) => void;
  setAgentError: (error: string | null) => void;
  setUploading: (uploading: boolean) => void;
  setAnsweredQuestions: (updater: (prev: Set<string>) => Set<string>) => void;
  setStopping: (stopping: boolean) => void;
  setVizEvents: (events: VizEvent[] | ((prev: VizEvent[]) => VizEvent[])) => void;
  setVizBeams: (beams: VizBeam[] | ((prev: VizBeam[]) => VizBeam[])) => void;
  setVizSize: (size: { width: number; height: number }) => void;
  setVizScale: (scale: number | ((prev: number) => number)) => void;
  setVizOffset: (offset: { x: number; y: number }) => void;
  setVizIsPanning: (panning: boolean) => void;
  setVizDebug: (entries: VizDebugEntry[] | ((prev: VizDebugEntry[]) => VizDebugEntry[])) => void;
  setVizEventsCollapsed: (collapsed: boolean) => void;
  setRightPanels: (panels: RightPanelState[] | ((prev: RightPanelState[]) => RightPanelState[])) => void;
  setMidSplitRatio: (ratio: number) => void;
  setMidStackHeight: (height: number) => void;
  setNodeOffsets: (offsets: Record<string, { x: number; y: number }> | ((prev: Record<string, { x: number; y: number }>) => Record<string, { x: number; y: number }>)) => void;
  setCollapsedAgents: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  setDetailsCollapsed: (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  setSkillList: (skills: Array<{ name: string; description: string }>) => void;
  setSkillPopupOpen: (open: boolean) => void;
  setSkillFilter: (filter: string) => void;
  setSkillSelectedIndex: (index: number | ((prev: number) => number)) => void;
  setAtTriggerPos: (pos: number) => void;
  setWorkingDir: (dir: string) => void;
  setShowDirInput: (show: boolean) => void;
  setDirBrowsePath: (path: string) => void;
  setDirBrowseEntries: (entries: Array<{ name: string; fullPath: string }>) => void;
  setDirBrowseParent: (parent: string | null) => void;
  setDirBrowseLoading: (loading: boolean) => void;

  // ── Skill suggestion actions (A-05) ───────────────────────
  addSkillSuggestion: (suggestion: Omit<SkillSuggestion, "id" | "createdAt">) => void;
  dismissSkillSuggestion: (id: string) => void;

  // ── Agent status actions ──────────────────────────────────
  setAgentStatusById: (updater: (prev: Record<string, AgentStatus>) => Record<string, AgentStatus>) => void;
}

// ── Helper: resolve functional or direct updates ────────────

function resolve<T>(value: T | ((prev: T) => T), prev: T): T {
  return typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
}

// ── Store ───────────────────────────────────────────────────

export const useIMStore = create<IMState>()(
  immer((set) => ({
    // ── Session slice ─────────────────────────────────────
    session: null,
    tokenLimit: 100000,
    groups: [],
    agents: [],
    activeGroupId: null,
    availableModels: [],
    selectedModel: "auto",

    // ── Messages slice ────────────────────────────────────
    messages: [],
    contentStream: "",
    reasoningStream: "",
    toolStream: "",
    llmHistory: "",

    // ── UI slice ──────────────────────────────────────────
    status: "boot",
    error: null,
    draft: "",
    reasoningExpanded: false,
    agentActivity: null,
    agentActivityTool: "",
    agentError: null,
    uploading: false,
    answeredQuestions: new Set<string>(),
    stoppingAgents: false,
    vizEvents: [],
    vizBeams: [],
    vizSize: { width: 640, height: 260 },
    vizScale: 0.9,
    vizOffset: { x: 0, y: 0 },
    vizIsPanning: false,
    vizDebug: [],
    vizEventsCollapsed: false,
    rightPanels: [
      { id: "history", title: "LLM history", size: 320, collapsed: false },
      { id: "content", title: "Realtime content", size: 220, collapsed: false },
      { id: "reasoning", title: "Realtime reasoning", size: 220, collapsed: false },
      { id: "tools", title: "Realtime tools", size: 200, collapsed: false },
    ],
    midSplitRatio: 0.55,
    midStackHeight: 0,
    nodeOffsets: {},
    collapsedAgents: {},
    detailsCollapsed: {},
    skillList: [],
    skillPopupOpen: false,
    skillFilter: "",
    skillSelectedIndex: 0,
    atTriggerPos: -1,
    workingDir: "",
    showDirInput: false,
    dirBrowsePath: "",
    dirBrowseEntries: [],
    dirBrowseParent: null,
    dirBrowseLoading: false,

    // ── Skill suggestions slice (A-05) ────────────────────
    skillSuggestions: [],

    // ── Agent status slice ────────────────────────────────
    agentStatusById: {},

    // ── Session actions ───────────────────────────────────
    setSession: (session) =>
      set((state) => {
        state.session = session;
      }),

    setTokenLimit: (limit) =>
      set((state) => {
        state.tokenLimit = limit;
      }),

    setGroups: (value) =>
      set((state) => {
        state.groups = resolve(value, state.groups);
      }),

    setAgents: (value) =>
      set((state) => {
        state.agents = resolve(value, state.agents);
      }),

    setActiveGroupId: (id) =>
      set((state) => {
        state.activeGroupId = id;
      }),

    setAvailableModels: (models) =>
      set((state) => {
        state.availableModels = models;
      }),

    setSelectedModel: (model) =>
      set((state) => {
        state.selectedModel = model;
      }),

    // ── Messages actions ──────────────────────────────────
    setMessages: (value) =>
      set((state) => {
        state.messages = resolve(value, state.messages);
      }),

    setContentStream: (value) =>
      set((state) => {
        state.contentStream = resolve(value, state.contentStream);
      }),

    setReasoningStream: (value) =>
      set((state) => {
        state.reasoningStream = resolve(value, state.reasoningStream);
      }),

    setToolStream: (value) =>
      set((state) => {
        state.toolStream = resolve(value, state.toolStream);
      }),

    setLlmHistory: (history) =>
      set((state) => {
        state.llmHistory = history;
      }),

    // ── UI actions ────────────────────────────────────────
    setStatus: (status) =>
      set((state) => {
        state.status = status;
      }),

    setError: (error) =>
      set((state) => {
        state.error = error;
      }),

    setDraft: (draft) =>
      set((state) => {
        state.draft = draft;
      }),

    setReasoningExpanded: (expanded) =>
      set((state) => {
        state.reasoningExpanded = expanded;
      }),

    setAgentActivity: (activity) =>
      set((state) => {
        state.agentActivity = activity;
      }),

    setAgentActivityTool: (tool) =>
      set((state) => {
        state.agentActivityTool = tool;
      }),

    setAgentError: (error) =>
      set((state) => {
        state.agentError = error;
      }),

    setUploading: (uploading) =>
      set((state) => {
        state.uploading = uploading;
      }),

    setAnsweredQuestions: (updater) =>
      set((state) => {
        state.answeredQuestions = updater(state.answeredQuestions);
      }),

    setStopping: (stopping) =>
      set((state) => {
        state.stoppingAgents = stopping;
      }),

    setVizEvents: (value) =>
      set((state) => {
        state.vizEvents = resolve(value, state.vizEvents);
      }),

    setVizBeams: (value) =>
      set((state) => {
        state.vizBeams = resolve(value, state.vizBeams);
      }),

    setVizSize: (size) =>
      set((state) => {
        state.vizSize = size;
      }),

    setVizScale: (value) =>
      set((state) => {
        state.vizScale = resolve(value, state.vizScale);
      }),

    setVizOffset: (offset) =>
      set((state) => {
        state.vizOffset = offset;
      }),

    setVizIsPanning: (panning) =>
      set((state) => {
        state.vizIsPanning = panning;
      }),

    setVizDebug: (value) =>
      set((state) => {
        state.vizDebug = resolve(value, state.vizDebug);
      }),

    setVizEventsCollapsed: (collapsed) =>
      set((state) => {
        state.vizEventsCollapsed = collapsed;
      }),

    setRightPanels: (value) =>
      set((state) => {
        state.rightPanels = resolve(value, state.rightPanels);
      }),

    setMidSplitRatio: (ratio) =>
      set((state) => {
        state.midSplitRatio = ratio;
      }),

    setMidStackHeight: (height) =>
      set((state) => {
        state.midStackHeight = height;
      }),

    setNodeOffsets: (value) =>
      set((state) => {
        state.nodeOffsets = resolve(value, state.nodeOffsets);
      }),

    setCollapsedAgents: (updater) =>
      set((state) => {
        state.collapsedAgents = updater(state.collapsedAgents);
      }),

    setDetailsCollapsed: (updater) =>
      set((state) => {
        state.detailsCollapsed = updater(state.detailsCollapsed);
      }),

    setSkillList: (skills) =>
      set((state) => {
        state.skillList = skills;
      }),

    setSkillPopupOpen: (open) =>
      set((state) => {
        state.skillPopupOpen = open;
      }),

    setSkillFilter: (filter) =>
      set((state) => {
        state.skillFilter = filter;
      }),

    setSkillSelectedIndex: (value) =>
      set((state) => {
        state.skillSelectedIndex = resolve(value, state.skillSelectedIndex);
      }),

    setAtTriggerPos: (pos) =>
      set((state) => {
        state.atTriggerPos = pos;
      }),

    setWorkingDir: (dir) =>
      set((state) => {
        state.workingDir = dir;
      }),

    setShowDirInput: (show) =>
      set((state) => {
        state.showDirInput = show;
      }),

    setDirBrowsePath: (path) =>
      set((state) => {
        state.dirBrowsePath = path;
      }),

    setDirBrowseEntries: (entries) =>
      set((state) => {
        state.dirBrowseEntries = entries;
      }),

    setDirBrowseParent: (parent) =>
      set((state) => {
        state.dirBrowseParent = parent;
      }),

    setDirBrowseLoading: (loading) =>
      set((state) => {
        state.dirBrowseLoading = loading;
      }),

    // ── Skill suggestion actions (A-05) ───────────────────
    addSkillSuggestion: (suggestion) =>
      set((state) => {
        // Deduplicate: don't add if same skillName already pending
        if (state.skillSuggestions.some((s) => s.skillName === suggestion.skillName)) return;
        state.skillSuggestions.push({
          ...suggestion,
          id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
          createdAt: Date.now(),
        });
        // Keep at most 5 suggestions (auto-expire oldest)
        if (state.skillSuggestions.length > 5) {
          state.skillSuggestions.splice(0, state.skillSuggestions.length - 5);
        }
      }),

    dismissSkillSuggestion: (id) =>
      set((state) => {
        state.skillSuggestions = state.skillSuggestions.filter((s) => s.id !== id);
      }),

    // ── Agent status actions ──────────────────────────────
    setAgentStatusById: (updater) =>
      set((state) => {
        state.agentStatusById = updater(state.agentStatusById);
      }),
  }))
);

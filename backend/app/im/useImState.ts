"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentMeta,
  AgentStatus,
  AgentStreamEvent,
  Group,
  Message,
  ModelEntry,
  UiStreamEvent,
  VizBeam,
  VizDebugEntry,
  VizEvent,
  WorkspaceDefaults,
} from "./types";
import { loadSession, saveSession, api } from "./helpers";

/**
 * useImState — manages all IM state, API calls, SSE connections, and actions.
 * Extracted from IMPageInner (lines 257–1800 of original page.tsx).
 */
export function useImState(workspaceOverrideId: string | null) {
  // ─── State ────────────────────────────────────────────────────────────────
  const [session, setSession] = useState<WorkspaceDefaults | null>(() => null);
  const [tokenLimit, setTokenLimit] = useState<number>(100000);
  const [groups, setGroups] = useState<Group[]>([]);
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<"boot" | "groups" | "messages" | "send" | "idle">("boot");
  const [error, setError] = useState<string | null>(null);
  const [stoppingAgents, setStoppingAgents] = useState(false);

  const [contentStream, setContentStream] = useState("");
  const [reasoningStream, setReasoningStream] = useState("");
  const [toolStream, setToolStream] = useState("");
  const [llmHistory, setLlmHistory] = useState("");
  const [agentError, setAgentError] = useState<string | null>(null);
  const [vizEvents, setVizEvents] = useState<VizEvent[]>([]);
  const [vizBeams, setVizBeams] = useState<VizBeam[]>([]);
  const [vizSize, setVizSize] = useState({ width: 640, height: 260 });
  const [vizScale, setVizScale] = useState(0.9);
  const [vizOffset, setVizOffset] = useState({ x: 0, y: 0 });
  const [vizIsPanning, setVizIsPanning] = useState(false);
  const [agentStatusById, setAgentStatusById] = useState<Record<string, AgentStatus>>({});
  const [vizDebug, setVizDebug] = useState<VizDebugEntry[]>([]);
  const [vizEventsCollapsed, setVizEventsCollapsed] = useState(false);
  const [midSplitRatio, setMidSplitRatio] = useState(0.55);
  const [midStackHeight, setMidStackHeight] = useState(0);
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [collapsedAgents, setCollapsedAgents] = useState<Record<string, boolean>>({});
  const [detailsCollapsed, setDetailsCollapsed] = useState<Record<string, boolean>>({});
  const [availableModels, setAvailableModels] = useState<ModelEntry[]>([]);
  const [selectedModel, setSelectedModel] = useState("auto");
  const [uploading, setUploading] = useState(false);

  // ─── Refs ─────────────────────────────────────────────────────────────────
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const activeGroupIdRef = useRef<string | null>(null);
  const streamAgentIdRef = useRef<string | null>(null);
  const streamAgentIdValueRef = useRef<string | null>(null);
  const agentRoleByIdRef = useRef<Map<string, string>>(new Map());
  const toolCallBuffersRef = useRef<Map<string, string>>(new Map());
  const toolResultBuffersRef = useRef<Map<string, string>>(new Map());
  const uiEsRef = useRef<EventSource | null>(null);
  const llmHistoryReqIdRef = useRef(0);
  const vizRef = useRef<HTMLDivElement | null>(null);
  const midStackRef = useRef<HTMLDivElement | null>(null);
  const midChatHeightRef = useRef(0);
  const nodeOffsetsRef = useRef<Record<string, { x: number; y: number }>>({});
  const groupsRef = useRef<Group[]>([]);
  const messagesRef = useRef<Message[]>([]);
  const beamTimeoutsRef = useRef<number[]>([]);
  const refreshQueueRef = useRef<{
    timer: number | null;
    pending: { groups: boolean; agents: boolean; messages: boolean; llmHistory: boolean };
  }>({ timer: null, pending: { groups: false, agents: false, messages: false, llmHistory: false } });
  const vizPanStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Computed ─────────────────────────────────────────────────────────────
  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId]
  );

  const agentRoleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.role);
    return map;
  }, [agents]);

  const groupByAgentId = useMemo(() => {
    const map = new Map<string, Group>();
    for (const g of groups) {
      const nonHumanMember = g.memberIds.find((mid) => mid !== g.creatorId);
      if (nonHumanMember) map.set(nonHumanMember, g);
    }
    return map;
  }, [groups]);

  const streamAgentId = useMemo(() => {
    const group = groups.find((g) => g.id === activeGroupId);
    if (!group) return null;
    return group.memberIds.find((id) => id !== session?.humanAgentId) ?? null;
  }, [groups, activeGroupId, session?.humanAgentId]);

  const extraGroups = useMemo(() => {
    const mappedIds = new Set(Array.from(groupByAgentId.values()).map((g) => g.id));
    return groups.filter((g) => !mappedIds.has(g.id) && g.memberIds.length > 1);
  }, [groups, groupByAgentId]);

  // ─── Keep refs in sync ────────────────────────────────────────────────────
  useEffect(() => { activeGroupIdRef.current = activeGroupId; }, [activeGroupId]);
  useEffect(() => { streamAgentIdValueRef.current = streamAgentId; }, [streamAgentId]);
  useEffect(() => { groupsRef.current = groups; }, [groups]);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { agentRoleByIdRef.current = agentRoleById; }, [agentRoleById]);
  useEffect(() => { nodeOffsetsRef.current = nodeOffsets; }, [nodeOffsets]);

  // ─── Refresh functions ────────────────────────────────────────────────────
  const refreshAgents = useCallback(async (s: WorkspaceDefaults) => {
    const { agents } = await api<{ agents: AgentMeta[] }>(
      `/api/agents?workspaceId=${encodeURIComponent(s.workspaceId)}&meta=true`
    );
    setAgents(agents);
  }, []);

  const formatLlmHistory = useCallback((raw: string) => {
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
  }, []);

  const refreshLlmHistory = useCallback(async (agentId: string) => {
    const reqId = (llmHistoryReqIdRef.current += 1);
    try {
      const res = await api<{ llmHistory: string }>(`/api/agents/${agentId}`);
      if (reqId !== llmHistoryReqIdRef.current) return;
      setLlmHistory(res.llmHistory ?? "");
    } catch (e) {
      if (reqId !== llmHistoryReqIdRef.current) return;
      setLlmHistory(e instanceof Error ? `(failed to load llm_history: ${e.message})` : "(failed to load llm_history)");
    }
  }, []);

  const llmHistoryParsed = useMemo(() => {
    if (!llmHistory) return null;
    try { return JSON.parse(llmHistory); } catch { return null; }
  }, [llmHistory]);

  const llmHistoryFormatted = useMemo(() => {
    if (!llmHistory) return "";
    return formatLlmHistory(llmHistory);
  }, [formatLlmHistory, llmHistory]);

  const refreshGroups = useCallback(async (s: WorkspaceDefaults, opts?: { silent?: boolean }) => {
    const q = new URLSearchParams({ workspaceId: s.workspaceId, agentId: s.humanAgentId });
    const { groups } = await api<{ groups: Group[] }>(`/api/groups?${q.toString()}`);
    setGroups(groups);
    if (!opts?.silent) setStatus("idle");
  }, []);

  const refreshMessages = useCallback(async (
    s: WorkspaceDefaults,
    groupId: string,
    opts?: { markRead?: boolean; silent?: boolean; skipGroupRefresh?: boolean; scrollToBottom?: boolean }
  ) => {
    if (!opts?.silent) setStatus("messages");
    const q = new URLSearchParams();
    if (opts?.markRead ?? true) q.set("markRead", "true");
    q.set("readerId", s.humanAgentId);
    const suffix = q.size ? `?${q.toString()}` : "";
    const { messages } = await api<{ messages: Message[] }>(
      `/api/groups/${groupId}/messages${suffix}`
    );
    const prevCount = messagesRef.current.length;
    setMessages(messages);
    if (!opts?.silent) setStatus("idle");
    if (!opts?.skipGroupRefresh) void refreshGroups(s, { silent: opts?.silent });
    if (opts?.scrollToBottom ?? messages.length > prevCount) {
      queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    }
  }, [refreshGroups]);

  const scheduleWorkspaceRefresh = useCallback((opts?: { groups?: boolean; agents?: boolean; messages?: boolean; llmHistory?: boolean }) => {
    if (!session) return;
    const pending = refreshQueueRef.current.pending;
    pending.groups = opts?.groups ?? true;
    pending.agents = opts?.agents ?? false;
    pending.messages = opts?.messages ?? true;
    pending.llmHistory = opts?.llmHistory ?? false;
    if (refreshQueueRef.current.timer !== null) return;
    refreshQueueRef.current.timer = window.setTimeout(() => {
      const next = refreshQueueRef.current.pending;
      refreshQueueRef.current.pending = { groups: false, agents: false, messages: false, llmHistory: false };
      refreshQueueRef.current.timer = null;
      if (next.groups) void refreshGroups(session, { silent: true });
      if (next.agents) void refreshAgents(session);
      if (next.llmHistory && streamAgentIdValueRef.current) void refreshLlmHistory(streamAgentIdValueRef.current);
      if (next.messages && activeGroupIdRef.current) {
        void refreshMessages(session, activeGroupIdRef.current, { markRead: false, silent: true, skipGroupRefresh: true, scrollToBottom: false });
      }
    }, 500);
  }, [refreshAgents, refreshGroups, refreshLlmHistory, refreshMessages, session]);

  // ─── SSE: Agent Stream ───────────────────────────────────────────────────
  const connectAgentStream = useCallback((agentId: string) => {
    if (streamAgentIdRef.current === agentId && esRef.current) return;
    streamAgentIdRef.current = agentId;
    esRef.current?.close();
    setLlmHistory("");
    setContentStream("");
    setReasoningStream("");
    setToolStream("");
    setAgentError(null);
    toolCallBuffersRef.current = new Map();
    toolResultBuffersRef.current = new Map();
    const groupId = activeGroupIdRef.current;
    const suffix = groupId ? `?groupId=${encodeURIComponent(groupId)}` : "";
    const es = new EventSource(`/api/agents/${agentId}/context-stream${suffix}`);
    esRef.current = es;
    es.onmessage = (evt) => {
      try {
        const payload = JSON.parse(evt.data) as AgentStreamEvent;
        if (payload.event === "agent.stream") {
          if (agentError) setAgentError(null);
          const chunk = payload.data.delta;
          if (chunk) {
            if (payload.data.kind === "content") setContentStream((t) => t + chunk);
            else if (payload.data.kind === "reasoning") setReasoningStream((t) => t + chunk);
            else {
              const name = payload.data.tool_call_name ?? payload.data.tool_call_id ?? "tool_call";
              const key = payload.data.tool_call_id ?? name;
              const buffers = payload.data.kind === "tool_result" ? toolResultBuffersRef.current : toolCallBuffersRef.current;
              const next = `${buffers.get(key) ?? ""}${chunk}`;
              buffers.set(key, next);
              const callLines = Array.from(toolCallBuffersRef.current.entries()).map(([id, value]) => `tool_calls[${id}]: ${value}`);
              const resultLines = Array.from(toolResultBuffersRef.current.entries()).map(([id, value]) => `tool_result[${id}]: ${value}`);
              setToolStream([...callLines, ...resultLines].join("\n\n"));
            }
          }
          return;
        }
        if (payload.event === "agent.wakeup" || payload.event === "agent.unread") {
          setContentStream(""); setReasoningStream(""); setToolStream("");
          toolCallBuffersRef.current = new Map();
          toolResultBuffersRef.current = new Map();
          return;
        }
        if (payload.event === "agent.done") {
          setAgentError(null);
          toolCallBuffersRef.current = new Map();
          toolResultBuffersRef.current = new Map();
          const nextSession = loadSession();
          const gid = activeGroupIdRef.current;
          if (nextSession && gid) void refreshMessages(nextSession, gid, { markRead: false, scrollToBottom: false, silent: true });
          if (nextSession) { void refreshGroups(nextSession, { silent: true }); void refreshAgents(nextSession); }
          const aid = streamAgentIdRef.current;
          if (aid) void refreshLlmHistory(aid);
          return;
        }

        if (payload.event === "agent.error") setAgentError(payload.data.message);
      } catch { /* ignore */ }
    };
    es.onerror = () => setAgentError("SSE disconnected");
  }, [refreshGroups, refreshMessages]);

  // ─── Actions ──────────────────────────────────────────────────────────────
  const bootstrap = useCallback(async (overrideWorkspaceId: string | null) => {
    setError(null); setAgentError(null); setStatus("boot");
    setGroups([]); setMessages([]); setLlmHistory("");
    esRef.current?.close();
    if (overrideWorkspaceId) {
      const init = await api<{ session: WorkspaceDefaults; config: { tokenLimit: number }; agents: AgentMeta[]; groups: Group[] }>(
        `/api/workspace-init?overrideWorkspaceId=${encodeURIComponent(overrideWorkspaceId)}`);
      setTokenLimit(init.config.tokenLimit); saveSession(init.session);
      setSession(init.session); setAgents(init.agents); setGroups(init.groups);
      setActiveGroupId(init.session.defaultGroupId); setStatus("idle"); return;
    }
    const existing = loadSession();
    if (existing) {
      try {
        const init = await api<{ session: WorkspaceDefaults; config: { tokenLimit: number }; agents: AgentMeta[]; groups: Group[] }>(
          `/api/workspace-init?workspaceId=${encodeURIComponent(existing.workspaceId)}`);
        setTokenLimit(init.config.tokenLimit); saveSession(init.session);
        setSession(init.session); setAgents(init.agents); setGroups(init.groups);
        setActiveGroupId(init.session.defaultGroupId); setStatus("idle"); return;
      } catch { /* fall through */ }
    }
    try {
      const recent = await api<{ workspaces: Array<{ id: string; name: string; createdAt: string }> }>(`/api/workspaces`);
      if (recent.workspaces.length > 0) {
        const targetId = recent.workspaces[0]!.id;
        const init = await api<{ session: WorkspaceDefaults; config: { tokenLimit: number }; agents: AgentMeta[]; groups: Group[] }>(
          `/api/workspace-init?workspaceId=${encodeURIComponent(targetId)}`);
        setTokenLimit(init.config.tokenLimit); saveSession(init.session);
        setSession(init.session); setAgents(init.agents); setGroups(init.groups);
        setActiveGroupId(init.session.defaultGroupId); setStatus("idle"); return;
      }
    } catch { /* fall through */ }
    const created = await api<WorkspaceDefaults>(`/api/workspaces`, { method: "POST", body: JSON.stringify({ name: "Default Workspace" }) });
    saveSession(created); setSession(created); setActiveGroupId(created.defaultGroupId); setStatus("idle");
    void refreshAgents(created);
  }, [refreshAgents]);

  const createWorkspace = useCallback(async (name?: string) => {
    setError(null); setAgentError(null); setStatus("boot");
    const created = await api<WorkspaceDefaults>(`/api/workspaces`, { method: "POST", body: JSON.stringify({ name: name?.trim() || "New Workspace" }) });
    saveSession(created); setSession(created); setActiveGroupId(created.defaultGroupId); setStatus("idle");
    window.history.replaceState(null, "", "/im");
    void refreshAgents(created); return created;
  }, [refreshAgents]);

  const hireSubAgent = useCallback(async () => {
    if (!session) return;
    const role = (window.prompt("Sub-agent role", "assistant") ?? "").trim();
    if (!role) return;
    setError(null); setAgentError(null); setStatus("boot");
    try {
      const created = await api<{ agentId: string; groupId: string }>(`/api/agents`, {
        method: "POST", body: JSON.stringify({ workspaceId: session.workspaceId, creatorId: session.humanAgentId, role }) });
      setStatus("idle"); void refreshGroups(session); void refreshAgents(session);
      setActiveGroupId(created.groupId); connectAgentStream(created.agentId);
    } catch (e) { setStatus("idle"); setError(e instanceof Error ? e.message : String(e)); }
  }, [connectAgentStream, refreshAgents, refreshGroups, session]);

  const onInterruptAllAgents = useCallback(async () => {
    if (!session || stoppingAgents) return;
    setStoppingAgents(true); setError(null); setAgentError(null);
    try {
      const res = await api<{ ok: boolean; interrupted: number; agentIds: string[] }>(`/api/agents/interrupt-all`, {
        method: "POST", body: JSON.stringify({ workspaceId: session.workspaceId }) });
      setAgentStatusById((prev) => {
        const next = { ...prev };
        const ids = res.agentIds.length > 0 ? res.agentIds : agents.map((a) => a.id);
        for (const id of ids) next[id] = "IDLE";
        return next;
      });
      setStatus("idle");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setStoppingAgents(false); }
  }, [agents, session, stoppingAgents]);

  const onSend = useCallback(async () => {
    if (!session || !activeGroupId) return;
    const text = draft.trim(); if (!text) return;
    if (text.startsWith("/create") || text.startsWith("/hire")) {
      const role = text.replace(/^\/(create|hire)\s*/i, "").trim();
      if (!role) { setError("Usage: /create <role>"); return; }
      setStatus("boot"); setError(null);
      try {
        const created = await api<{ agentId: string; groupId: string }>(`/api/agents`, {
          method: "POST", body: JSON.stringify({ workspaceId: session.workspaceId, creatorId: session.humanAgentId, role }) });
        setDraft(""); setStatus("idle"); void refreshGroups(session); void refreshAgents(session);
        setActiveGroupId(created.groupId); connectAgentStream(created.agentId); return;
      } catch (e) { setStatus("idle"); setError(e instanceof Error ? e.message : String(e)); return; }
    }
    setStatus("send"); setError(null);
    const optimistic: Message = {
      id: `optimistic-${Date.now()}`, senderId: session.humanAgentId,
      content: text, contentType: "text", sendTime: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]); setDraft("");
    queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
    try { await api(`/api/groups/${activeGroupId}/messages`, { method: "POST", body: JSON.stringify({ senderId: session.humanAgentId, content: text, contentType: "text" }) }); }
    finally { /* keep going */ }
    setStatus("idle");
    void refreshMessages(session, activeGroupId, { markRead: false, scrollToBottom: false, silent: true });
    void refreshGroups(session, { silent: true });
  }, [activeGroupId, connectAgentStream, draft, refreshAgents, refreshGroups, refreshMessages, session]);

  const uploadFile = useCallback(async (file: File) => {
    if (!session || !activeGroupId) return;
    setUploading(true);
    try {
      const formData = new FormData(); formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) { alert(`Upload error: ${data.error}`); return; }
      const content = JSON.stringify({ url: data.url, name: data.name, size: data.size });
      const contentType = data.isImage ? "image" : "file";
      const optimistic: Message = {
        id: `optimistic-${Date.now()}`, senderId: session.humanAgentId, content, contentType, sendTime: new Date().toISOString(),
      };
      setMessages((m) => [...m, optimistic]);
      try { await api(`/api/groups/${activeGroupId}/messages`, { method: "POST", body: JSON.stringify({ senderId: session.humanAgentId, content, contentType }) }); }
      finally { /* keep going */ }
      void refreshMessages(session, activeGroupId, { markRead: false, scrollToBottom: false });
      void refreshGroups(session);
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setUploading(false); }
  }, [activeGroupId, refreshGroups, refreshMessages, session]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files || files.length === 0) return;
    void uploadFile(files[0]); e.target.value = "";
  }, [uploadFile]);

  // ─── Viz helpers ──────────────────────────────────────────────────────────
  const pushVizEvent = useCallback((event: UiStreamEvent, label: string, kind: VizEvent["kind"]) => {
    const at = typeof event.at === "number" ? event.at : Date.now();
    const id = `${event.id ?? at}-${Math.random().toString(16).slice(2)}`;
    setVizEvents((prev) => [...prev, { id, kind, label, at }].slice(-20));
  }, []);

  const pushBeam = useCallback((beam: Omit<VizBeam, "id" | "createdAt">) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const createdAt = Date.now();
    setVizBeams((prev) => [...prev, { ...beam, id, createdAt }].slice(-12));
    const timeoutId = window.setTimeout(() => setVizBeams((prev) => prev.filter((b) => b.id !== id)), 2400);
    beamTimeoutsRef.current.push(timeoutId);
  }, []);

  const logVizDebug = useCallback((entry: Omit<VizDebugEntry, "id" | "at">) => {
    const record: VizDebugEntry = { ...entry, id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, at: Date.now() };
    setVizDebug((prev) => [...prev, record].slice(-200));
    if (typeof window !== "undefined") {
      (window as any).__imVizDebug = (window as any).__imVizDebug ?? [];
      (window as any).__imVizDebug.push(record);
      console.debug("[im-viz]", record);
    }
  }, []);

  // ─── Color helpers ────────────────────────────────────────────────────────
  const roleColor = (role?: string) => {
    if (!role) return "var(--text-primary)";
    if (role === "human") return "var(--text-primary)";
    if (role === "assistant") return "var(--cyan)";
    if (role === "coordinator" || role === "productmanager" || role === "pm" || role === "manager" || role === "cto") return "var(--magenta)";
    if (role === "reviewer" || role === "qa") return "var(--purple)";
    if (role === "researcher" || role === "analyst") return "var(--green)";
    if (role === "specialist" || role === "coder" || role === "developer" || role === "engineer") return "var(--green)";
    if (role === "creator" || role === "writer") return "var(--yellow)";
    if (role === "editor") return "var(--yellow)";
    if (role === "worker") return "var(--text-secondary)";
    return "var(--yellow)";
  };

  const statusColor = (s?: AgentStatus) => {
    if (s === "BUSY") return "var(--red)";
    if (s === "WAKING") return "var(--yellow)";
    return "var(--green)";
  };

  // ─── Effects ──────────────────────────────────────────────────────────────
  useEffect(() => { void bootstrap(workspaceOverrideId).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, [bootstrap, workspaceOverrideId]);

  // Load models
  useEffect(() => {
    api<{ models: Array<{ id: string; displayName: string; platform: string }> }>("/api/models")
      .then((r) => setAvailableModels(r.models)).catch(() => {});
  }, []);

  // ResizeObserver: viz
  useEffect(() => {
    const el = vizRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => { for (const entry of entries) { const rect = entry.contentRect; if (!rect.width || !rect.height) continue; setVizSize({ width: rect.width, height: rect.height }); } });
    observer.observe(el); return () => observer.disconnect();
  }, []);

  // ResizeObserver: midStack
  useEffect(() => {
    const el = midStackRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => { for (const entry of entries) { const rect = entry.contentRect; if (!rect.height) continue; setMidStackHeight(rect.height); } });
    observer.observe(el); return () => observer.disconnect();
  }, []);

  // Wheel zoom on viz
  useEffect(() => {
    const el = vizRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); setVizScale((s) => Math.min(Math.max(s + (e.deltaY > 0 ? -0.05 : 0.05), 0.5), 2)); };
    el.addEventListener("wheel", onWheel, { passive: false }); return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // UI EventSource
  useEffect(() => {
    if (!session) return;
    uiEsRef.current?.close();
    const es = new EventSource(`/api/ui-stream?workspaceId=${encodeURIComponent(session.workspaceId)}`);
    uiEsRef.current = es;
    es.onmessage = (evt) => {
      let payload: UiStreamEvent | null = null;
      try { payload = JSON.parse(evt.data) as UiStreamEvent; } catch { payload = null; }
      if (payload) {
        if (payload.event === "ui.agent.created") {
          const role = (payload.data?.agent as any)?.role ?? "agent";
          const agentId = (payload.data?.agent as any)?.id;
          const parentId = (payload.data?.agent as any)?.parentId;
          pushVizEvent(payload, `New agent: ${role}`, "agent");
                    // Refresh agents list from API instead of adding incomplete data
          const nextSession = loadSession();
          if (nextSession) void refreshAgents(nextSession);

if (agentId) {
            const fromId = parentId || session.humanAgentId;
            pushBeam({ fromId, toId: agentId, kind: "create", label: role });
            setAgentStatusById((prev) => ({ ...prev, [agentId]: "IDLE" }));
          }
        } else if (payload.event === "ui.message.created") {
          const senderId = (payload.data?.message as any)?.senderId;
          const groupId = (payload.data as any)?.groupId;
          const senderRole = senderId ? agentRoleByIdRef.current.get(senderId) ?? senderId.slice(0, 6) : "unknown";
          pushVizEvent(payload, `Message: ${senderRole}`, "message");
          logVizDebug({ type: "message_event", data: { messageId: (payload.data?.message as any)?.id, groupId, senderId, senderRole, hasGroup: !!groupsRef.current.find((g) => g.id === groupId) } });
          if (senderId && groupId) {
            const groupMembers = groupsRef.current.find((g) => g.id === groupId)?.memberIds ?? [];
            const targetIds = groupMembers.filter((id: string) => id !== senderId);
            targetIds.forEach((targetId: string) => { pushBeam({ fromId: senderId, toId: targetId, kind: "message" }); });
          }
        } else if (payload.event === "ui.agent.llm.start" || payload.event === "ui.agent.llm.done") {
          const agentId = (payload.data as any)?.agentId;
          const role = agentId ? agentRoleByIdRef.current.get(agentId) ?? agentId.slice(0, 6) : "agent";
          const label = payload.event === "ui.agent.llm.start" ? `LLM start: ${role}` : `LLM done: ${role}`;
          pushVizEvent(payload, label, "llm");
          if (agentId) setAgentStatusById((prev) => ({ ...prev, [agentId]: payload.event === "ui.agent.llm.start" ? "BUSY" : "IDLE" }));
        } else if (payload.event === "ui.agent.tool_call.start" || payload.event === "ui.agent.tool_call.done") {
          const agentId = (payload.data as any)?.agentId;
          const toolName = (payload.data as any)?.toolName ?? "tool";
          const role = agentId ? agentRoleByIdRef.current.get(agentId) ?? agentId.slice(0, 6) : "agent";
          const label = payload.event === "ui.agent.tool_call.start" ? `Tool start: ${role} → ${toolName}` : `Tool done: ${role} → ${toolName}`;
          pushVizEvent(payload, label, "tool");
          if (agentId) setAgentStatusById((prev) => ({ ...prev, [agentId]: payload.event === "ui.agent.tool_call.start" ? "BUSY" : "IDLE" }));
        } else if (payload.event === "ui.agent.interrupt_all") {
          pushVizEvent(payload, "Interrupt all Agent", "agent");
          const ids = Array.isArray((payload.data as any)?.agentIds) ? (payload.data as any).agentIds : [];
          setAgentStatusById((prev) => { const next = { ...prev }; const targetIds = ids.length > 0 ? ids : Object.keys(next); for (const id of targetIds) next[id] = "IDLE"; return next; });
        } else if (payload.event === "ui.db.write") {
          const table = (payload.data as any)?.table ?? "db"; const action = (payload.data as any)?.action ?? "write";
          pushVizEvent(payload, `DB ${action}: ${table}`, "db");
        }
      }
      scheduleWorkspaceRefresh({ groups: true, agents: false, messages: true, llmHistory: false });
    };
    es.onerror = () => {}; // tolerate disconnects
    return () => es.close();
  }, [logVizDebug, pushBeam, pushVizEvent, scheduleWorkspaceRefresh, session]);

  // Connect agent stream when it changes
  useEffect(() => {
    if (!streamAgentId) return;
    connectAgentStream(streamAgentId); setLlmHistory(""); void refreshLlmHistory(streamAgentId);
  }, [connectAgentStream, refreshLlmHistory, streamAgentId]);

  // Refresh messages when active group changes
  useEffect(() => {
    if (!activeGroupId || !session) return;
    void refreshMessages(session, activeGroupId, { markRead: true }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [activeGroupId, refreshMessages, session]);

  // Cleanup on unmount
  useEffect(() => { return () => esRef.current?.close(); }, []);
  useEffect(() => {
    return () => { beamTimeoutsRef.current.forEach((id) => window.clearTimeout(id)); beamTimeoutsRef.current = []; };
  }, []);

  return {
    // State
    session, setSession, tokenLimit, setTokenLimit,
    groups, agents, activeGroupId, setActiveGroupId,
    messages, draft, setDraft, status, error, stoppingAgents,
    contentStream, reasoningStream, toolStream, llmHistory, agentError,
    vizEvents, vizBeams, vizSize, vizScale, setVizScale, vizOffset, setVizOffset,
    vizIsPanning, setVizIsPanning, agentStatusById, setAgentStatusById,
    vizDebug, vizEventsCollapsed, setVizEventsCollapsed,
    midSplitRatio, setMidSplitRatio, midStackHeight, nodeOffsets, setNodeOffsets,
    collapsedAgents, setCollapsedAgents, detailsCollapsed, setDetailsCollapsed,
    availableModels, selectedModel, setSelectedModel, uploading,
    // Refs
    bottomRef, esRef, activeGroupIdRef, streamAgentIdRef, vizRef, midStackRef,
    midChatHeightRef, vizPanStartRef, fileInputRef,
    // Computed
    activeGroup, agentRoleById, groupByAgentId, streamAgentId, extraGroups,
    llmHistoryParsed, llmHistoryFormatted,
    // Colors
    roleColor, statusColor,
    // Actions
    bootstrap, createWorkspace, hireSubAgent, onInterruptAllAgents, onSend,
    uploadFile, handleFileSelect, refreshAgents, refreshGroups, refreshMessages,
    connectAgentStream, pushVizEvent, pushBeam, logVizDebug,
    scheduleWorkspaceRefresh,
  };
}


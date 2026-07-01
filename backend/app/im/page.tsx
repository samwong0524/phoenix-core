"use client";

import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, TouchEvent as ReactTouchEvent } from "react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Brain, Briefcase, Code2, Network, User } from "lucide-react";
import { ErrorBoundary } from "../_components/error-boundary";
import { toast } from "@/components/ui";
import { IMShell } from "./IMShell";
import { IMMessageList } from "./IMMessageList";
import { useTopoNodes } from "./useTopoNodes";
import { useVizLayout } from "./useVizLayout";
import { FileCard } from "./FileCard";
const MarkdownContent = dynamic(() => import("./MarkdownContent").then(m => ({ default: m.MarkdownContent })), { ssr: false });
import { QuestionCard } from "./QuestionCard";
import { statusColor } from "./colors";
import { useAgentStream } from "./useAgentStream";
import { useUiStream } from "./useUiStream";
import { useImActions } from "./useImActions";
import { useI18n } from "@/lib/i18n/context";
import { useIMStore } from "./store";
import type {
  Group, Message,
} from "./types";
import {
  MID_GRAPH_MIN_HEIGHT, MID_SPLITTER_SIZE,
  RIGHT_PANEL_MIN_HEIGHT,
  api, fmtTime, cx,
} from "./helpers";
import { AgentSidebar } from "./AgentSidebar";
import { useTaskMonitorData } from "./useTaskMonitorData";
import { useMidResize } from "./useMidResize";

// Dynamic imports for heavy components (code-split, no SSR needed)
const TopoAnimCanvas = dynamic(() => import("./TopoAnimCanvas").then(m => m.TopoAnimCanvas), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-surface-2 h-32 rounded" />,
});

const TaskMonitor = dynamic(() => import("./TaskMonitor").then(m => m.TaskMonitor), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-surface-2 h-full rounded" />,
});

export default function IMPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <IMPageInner />
    </Suspense>
  );
}

function IMPageInner() {
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const workspaceOverrideId = searchParams.get("workspaceId");
  const {
    // Session slice
    session, groups, agents, activeGroupId, availableModels, selectedModel,
    // Messages slice
    messages, contentStream, reasoningStream, toolStream, llmHistory,
    // UI slice
    status, error, draft, reasoningExpanded, agentActivity, agentActivityTool,
    agentError, uploading, answeredQuestions, stoppingAgents,
    vizEvents, vizBeams, vizSize, vizScale, vizOffset, vizIsPanning,
    rightPanels, midStackHeight,
    nodeOffsets,
    skillPopupOpen, skillSelectedIndex,
    // Agent status slice
    agentStatusById,
    // Session actions
    setActiveGroupId,
    setAvailableModels, setSelectedModel,
    // Messages actions
    setMessages,
    // UI actions
    setError, setDraft, setReasoningExpanded,
    setAnsweredQuestions,
    setVizSize, setVizScale, setVizOffset, setVizIsPanning,
    setRightPanels,
    setNodeOffsets,
    setSkillList, setSkillPopupOpen, setSkillSelectedIndex,
    setWorkingDir,
    // Skill suggestions (A-05)
    skillSuggestions, dismissSkillSuggestion,
  } = useIMStore();

  // Round vizSize to 10px granularity to avoid vizLayout recalc on every ResizeObserver pixel
  const vizSizeRounded = useMemo(() => ({
    width: Math.round(vizSize.width / 10) * 10,
    height: Math.round(vizSize.height / 10) * 10,
  }), [vizSize.width, vizSize.height]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const activeGroupIdRef = useRef<string | null>(null);
  const streamAgentIdValueRef = useRef<string | null>(null);
  const vizRef = useRef<HTMLDivElement | null>(null);
  const nodeOffsetsRef = useRef<Record<string, { x: number; y: number }>>({});
  const messagesRef = useRef<Message[]>([]);
  const vizPanStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId]
  );

  const agentRoleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.role);
    return map;
  }, [agents]);

  const vizLayout = useVizLayout(agents, session, vizSizeRounded, nodeOffsets);

  // Topo animation nodes (pixel positions for canvas overlay)
  const topoNodes = useTopoNodes(vizLayout, agentStatusById, agents);

  const getGroupLabel = useCallback(
    (g: Group | null | undefined) => {
      if (!g) return t("im.group");
      if (g.name) return g.name;
      if (g.id === session?.defaultGroupId) return t("im.p2p_human");

      const memberRoles = g.memberIds
        .filter((id) => id !== session?.humanAgentId)
        .map((id) => agentRoleById.get(id) ?? id.slice(0, 8));

      if (memberRoles.length === 1) return t("im.p2p_with_role", { role: memberRoles[0] });
      if (memberRoles.length === 2) return t("im.p2p_two_roles", { role1: memberRoles[0], role2: memberRoles[1] });
      if (memberRoles.length > 2) return t("im.group_count", { count: memberRoles.length });
      return t("im.group");
    },
    [agentRoleById, session?.defaultGroupId, session?.humanAgentId, t]
  );

  const streamAgentId = useMemo(() => {
    if (!session) return null;
    if (!activeGroupId) return session.assistantAgentId;
    const group = groups.find((g) => g.id === activeGroupId);
    if (!group) return session.assistantAgentId;
    return group.memberIds.find((id) => id !== session.humanAgentId) ?? session.assistantAgentId;
  }, [activeGroupId, groups, session]);

  const { reconnect: connectAgentStream } = useAgentStream(streamAgentId);

  const {
    refreshAgents, refreshGroups, refreshMessages, refreshLlmHistory,
    bootstrap, createWorkspace,
    hireSubAgent, onInterruptAllAgents,
    onSend, uploadFile,
    filteredSkills, handleDraftChange, selectSkill, handleSkillKeyDown,
  } = useImActions(connectAgentStream, bottomRef, messagesRef);

  const taskMonitorData = useTaskMonitorData();

  // Workspace list for switcher dropdown
  const [workspaceList, setWorkspaceList] = useState<Array<{ id: string; name: string; createdAt: string }>>([]);
  const refreshWorkspaceList = useCallback(() => {
    api<{ workspaces: Array<{ id: string; name: string; createdAt: string }> }>("/api/workspaces")
      .then((r) => setWorkspaceList(r.workspaces))
      .catch(() => {});
  }, []);

  // Switch workspace handler
  const handleSwitchWorkspace = useCallback((id: string) => {
    void bootstrap(id).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    void refreshWorkspaceList();
  }, [bootstrap, setError, refreshWorkspaceList]);

  // Create workspace handler
  const handleCreateWorkspace = useCallback(() => {
    void createWorkspace().then(() => refreshWorkspaceList()).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [createWorkspace, refreshWorkspaceList, setError]);

  // Delete workspace handler
  const handleDeleteWorkspace = useCallback(async () => {
    if (!session) return;
    if (workspaceList.length <= 1) {
      toast.error("Cannot delete the only workspace");
      return;
    }
    const name = workspaceList.find((w) => w.id === session.workspaceId)?.name ?? session.workspaceId.slice(0, 8);
    if (!window.confirm(`Delete workspace "${name}" and all its data?`)) return;
    try {
      await api(`/api/workspaces/${encodeURIComponent(session.workspaceId)}`, { method: "DELETE" });
      toast.success("Workspace deleted");
      // Switch to the most recent remaining workspace
      const remaining = workspaceList.filter((w) => w.id !== session.workspaceId);
      if (remaining.length > 0) {
        void bootstrap(remaining[0]!.id);
      }
      void refreshWorkspaceList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [session, workspaceList, bootstrap, refreshWorkspaceList, setError]);

  // Delete agent handler
  const handleDeleteAgent = useCallback(async (agentId: string) => {
    if (!session) return;
    const agent = agents.find((a) => a.id === agentId);
    const label = agent?.role ?? agentId.slice(0, 8);
    if (!window.confirm(`Delete agent "${label}"? This will remove its conversation history.`)) return;
    try {
      await api(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: "DELETE",
        body: JSON.stringify({ workspaceId: session.workspaceId }),
      });
      toast.success(`Agent "${label}" deleted`);
      void refreshAgents(session);
      void refreshGroups(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [session, agents, refreshAgents, refreshGroups, setError]);

  // Models remain separate via /api/models (FreeLLMAPI, may be slow)
  // NOTE: workspace-init is handled by bootstrap() in useImActions.
  useEffect(() => {
    api<{ models: Array<{ id: string; displayName: string; platform: string }> }>("/api/models")
      .then((r) => setAvailableModels(r.models))
      .catch(() => {});
    // Fetch skills for @skill autocomplete
    fetch("/api/skills")
      .then((r) => r.json())
      .then((data) => setSkillList(data.skills ?? data ?? []))
      .catch(() => {});
  }, []);

  // Show error as unified toast
  useEffect(() => {
    if (error) {
      toast.error(error);
      setError(null);
    }
  }, [error, setError]);

  useUiStream(
    session,
    agents,
    groups,
    { groups: refreshGroups, agents: refreshAgents, messages: refreshMessages, llmHistory: refreshLlmHistory },
    activeGroupIdRef,
    streamAgentIdValueRef,
  );

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    void uploadFile(files[0]);
    e.target.value = "";
  }

  useEffect(() => {
    void bootstrap(workspaceOverrideId).catch((e) =>
      setError(e instanceof Error ? e.message : String(e))
    );
    void refreshWorkspaceList();
  }, [bootstrap, workspaceOverrideId, refreshWorkspaceList]);

  useEffect(() => {
    activeGroupIdRef.current = activeGroupId;
  }, [activeGroupId]);

  useEffect(() => {
    streamAgentIdValueRef.current = streamAgentId;
  }, [streamAgentId]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    nodeOffsetsRef.current = nodeOffsets;
  }, [nodeOffsets]);

  useEffect(() => {
    const el = vizRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.contentRect;
        if (!rect.width || !rect.height) continue;
        setVizSize({ width: rect.width, height: rect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = vizRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      setVizScale((s) => Math.min(Math.max(s + delta, 0.5), 2));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // NOTE: bootstrap() already loads agents + groups, so no need to refresh here.
  // Individual actions (hireSubAgent, sendMessage) call refreshAgents/refreshGroups as needed.

  useEffect(() => {
    if (!activeGroupId || !session) return;
    void refreshMessages(session, activeGroupId, { markRead: true }).catch((e) =>
      setError(e instanceof Error ? e.message : String(e))
    );
  }, [activeGroupId, refreshMessages, session]);

  // ── Mid-stack resize (hook) ──
  const { midStackRef, midChatHeight, handleMidResizeStart, handleMidMouseDown, handleMidTouchStart } = useMidResize();

  // ── Right panel resize ──
  const handleRightPanelResizeStart = useCallback(
    (index: number, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const first = rightPanels[index];
      const second = rightPanels[index + 1];
      if (!first || !second) return;
      if (first.collapsed || second.collapsed) return;

      const startY = event.clientY;
      const startFirst = first.size;
      const startSecond = second.size;
      const min = RIGHT_PANEL_MIN_HEIGHT;

      const onMove = (e: PointerEvent) => {
        const delta = e.clientY - startY;
        const total = startFirst + startSecond;
        const nextFirst = Math.min(total - min, Math.max(min, startFirst + delta));
        const nextSecond = total - nextFirst;
        setRightPanels((prev) => {
          if (!prev[index] || !prev[index + 1]) return prev;
          if (prev[index].collapsed || prev[index + 1].collapsed) return prev;
          const next = [...prev];
          next[index] = { ...next[index], size: nextFirst };
          next[index + 1] = { ...next[index + 1], size: nextSecond };
          return next;
        });
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        document.body.style.cursor = "";
      };

      document.body.style.cursor = "row-resize";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [rightPanels]
  );

  // ── Node drag handlers ──
  const startNodeDrag = useCallback(
    (id: string, clientX: number, clientY: number) => {
      const startOffset = nodeOffsetsRef.current[id] ?? { x: 0, y: 0 };
      const startX = clientX;
      const startY = clientY;

      const onMove = (e: PointerEvent | MouseEvent) => {
        const dx = (e.clientX - startX) / (vizScale || 1);
        const dy = (e.clientY - startY) / (vizScale || 1);
        setNodeOffsets((prev) => ({
          ...prev,
          [id]: { x: startOffset.x + dx, y: startOffset.y + dy },
        }));
      };

      const onTouchMove = (e: TouchEvent) => {
        const touch = e.touches[0];
        if (!touch) return;
        const dx = (touch.clientX - startX) / (vizScale || 1);
        const dy = (touch.clientY - startY) / (vizScale || 1);
        setNodeOffsets((prev) => ({
          ...prev,
          [id]: { x: startOffset.x + dx, y: startOffset.y + dy },
        }));
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("touchmove", onTouchMove);
        window.removeEventListener("touchend", onUp);
        document.body.style.cursor = "";
      };

      document.body.style.cursor = "grabbing";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      window.addEventListener("touchend", onUp);
    },
    [vizScale]
  );

  const handleNodePointerDown = useCallback(
    (id: string, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      startNodeDrag(id, event.clientX, event.clientY);
    },
    [startNodeDrag]
  );

  const handleNodeMouseDown = useCallback(
    (id: string, event: ReactMouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      startNodeDrag(id, event.clientX, event.clientY);
    },
    [startNodeDrag]
  );

  const handleNodeTouchStart = useCallback(
    (id: string, event: ReactTouchEvent<HTMLDivElement>) => {
      event.stopPropagation();
      const touch = event.touches[0];
      if (!touch) return;
      startNodeDrag(id, touch.clientX, touch.clientY);
    },
    [startNodeDrag]
  );

  // Title for chat header (computed from activeGroup)
  const title = getGroupLabel(activeGroup);

  const renderContent = useCallback((content: string, contentType: string, message?: { id: string; senderId: string }) => {
    if (contentType === 'image') {
      try {
        const img = JSON.parse(content) as { url?: string; name?: string };
        if (img?.url) {
          return <img src={img.url} alt={img.name || ''} style={{ maxWidth: '100%', maxHeight: 300, borderRadius: "var(--radius-sm)", cursor: 'pointer' }} onClick={() => window.open(img.url!, '_blank')} />;
        }
      } catch { /* fallthrough */ }
    }
    if (contentType === 'file') {
      try {
        const file = JSON.parse(content) as { url?: string; name?: string; size?: number };
        if (file?.url && file?.name) {
          return <FileCard url={file.url} name={file.name} size={file.size} />;
        }
      } catch { /* fallthrough */ }
    }
    if (contentType === 'question') {
      try {
        const payload = JSON.parse(content) as { question?: string; options?: Array<{ label: string; description?: string }> };
        if (payload?.question && payload?.options) {
          return (
            <QuestionCard
              questionId={message?.id ?? ""}
              question={payload.question}
              options={payload.options}
              answered={answeredQuestions.has(message?.id ?? "")}
              onAnswer={(label) => {
                if (message?.id) {
                  setAnsweredQuestions((prev) => new Set(prev).add(message.id));
                }
                if (session && activeGroupId) {
                  const optimistic: Message = {
                    id: `optimistic-${Date.now()}`,
                    senderId: session.humanAgentId,
                    content: label,
                    contentType: "text",
                    sendTime: new Date().toISOString(),
                  };
                  setMessages((m) => [...m, optimistic]);
                  queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
                  void api(`/api/groups/${activeGroupId}/messages`, {
                    method: "POST",
                    body: JSON.stringify({ senderId: session.humanAgentId, content: label, contentType: "text" }),
                  });
                }
              }}
            />
          );
        }
      } catch { /* fallthrough */ }
    }
    return <MarkdownContent content={content} />;
  }, [answeredQuestions]);

  return (
    <IMShell
      left={
        <AgentSidebar
          session={session}
          groups={groups}
          agents={agents}
          activeGroupId={activeGroupId}
          collapsedAgents={useIMStore((s) => s.collapsedAgents)}
          detailsCollapsed={useIMStore((s) => s.detailsCollapsed)}
          workingDir={useIMStore((s) => s.workingDir)}
          showDirInput={useIMStore((s) => s.showDirInput)}
          dirBrowsePath={useIMStore((s) => s.dirBrowsePath)}
          dirBrowseEntries={useIMStore((s) => s.dirBrowseEntries)}
          dirBrowseParent={useIMStore((s) => s.dirBrowseParent)}
          dirBrowseLoading={useIMStore((s) => s.dirBrowseLoading)}
          setActiveGroupId={setActiveGroupId}
          setCollapsedAgents={useIMStore((s) => s.setCollapsedAgents)}
          setDetailsCollapsed={useIMStore((s) => s.setDetailsCollapsed)}
          setShowDirInput={useIMStore((s) => s.setShowDirInput)}
          setDirBrowsePath={useIMStore((s) => s.setDirBrowsePath)}
          setDirBrowseLoading={useIMStore((s) => s.setDirBrowseLoading)}
          setDirBrowseEntries={useIMStore((s) => s.setDirBrowseEntries)}
          setDirBrowseParent={useIMStore((s) => s.setDirBrowseParent)}
          setWorkingDir={setWorkingDir}
          onCreateWorkspace={handleCreateWorkspace}
          onSwitchWorkspace={handleSwitchWorkspace}
          onDeleteWorkspace={handleDeleteWorkspace}
          onHireSubAgent={() => void hireSubAgent()}
          onDeleteAgent={(id) => void handleDeleteAgent(id)}
          workspaces={workspaceList}
        />
      }
      mid={
        <ErrorBoundary name="IM.ChatPanel">
        <main className="panel panel-mid">
        <div className="chat-header">
          <span className="chat-header-title">{title}</span>
          <div className="chat-header-actions">
            <button
              className={cx("btn-action", "danger")}
              onClick={() => void onInterruptAllAgents()}
              disabled={!session || stoppingAgents}
              title={t("im.stop_all_tooltip")}
            >
              ■ {stoppingAgents ? t("im.stopping") : t("im.stop_all")}
            </button>
            {status !== "idle" ? (
              <span className="muted" style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>{status}...</span>
            ) : null}
          </div>
        </div>

        <div className="mid-stack" ref={midStackRef} style={{
          gridTemplateRows: midStackHeight > 0
            ? `${Math.max(0, Math.round(midChatHeight))}px ${MID_SPLITTER_SIZE}px minmax(${MID_GRAPH_MIN_HEIGHT}px, 1fr)`
            : `1fr ${MID_SPLITTER_SIZE}px minmax(${MID_GRAPH_MIN_HEIGHT}px, 1fr)`
        }}>
          <div className="chat" role="log" aria-live="polite" aria-label="Chat messages">
            {/* Agent activity status indicator */}
            {agentActivity && (
              <div className="chat-agent-status" role="status" aria-label={agentActivity === "thinking" ? "Agent is thinking" : agentActivity === "executing" ? "Agent is executing a tool" : "Agent is generating a response"} style={{
                position: "sticky", top: 0, zIndex: 10,
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 12px", fontSize: 11, fontFamily: "var(--font-mono)",
                background: agentActivity === "thinking" ? "var(--yellow-soft)" : agentActivity === "executing" ? "var(--blue-soft)" : "var(--green-soft)",
                borderBottom: agentActivity === "thinking" ? "1px solid var(--yellow-dim)" : agentActivity === "executing" ? "1px solid var(--cyan-dim)" : "1px solid var(--green-dim)",
                color: agentActivity === "thinking" ? "var(--yellow)" : agentActivity === "executing" ? "var(--cyan)" : "var(--green)",
                transition: "all 0.2s ease",
              }}>
                <span style={{ fontSize: 14, lineHeight: 1 }}>
                  {agentActivity === "thinking" ? "🧠" : agentActivity === "executing" ? "🔧" : "💬"}
                </span>
                <span>
                  {agentActivity === "thinking" ? "深度思考…" : agentActivity === "executing" ? `执行中 ${agentActivityTool.length > 16 ? agentActivityTool.slice(0, 14) + "…" : agentActivityTool}…` : "生成中…"}
                </span>
              </div>
            )}
            {/* Collapsible reasoning/thinking panel */}
            {reasoningStream && (
              <div style={{
                margin: "4px 12px",
                border: "1px solid var(--border)",
                borderRadius: 6,
                background: "var(--bg-elevated)",
                overflow: "hidden",
              }}>
                <button
                  onClick={() => setReasoningExpanded(!reasoningExpanded)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    width: "100%", padding: "6px 10px",
                    background: "none", border: "none", cursor: "pointer",
                    color: "var(--cyan)", fontSize: 11, fontFamily: "var(--font-mono)",
                    fontWeight: 500, textAlign: "left",
                  }}
                >
                  <Brain size={14} style={{ flexShrink: 0, color: "var(--cyan)" }} />
                  <span style={{ flex: 1 }}>
                    {agentActivity === "thinking" ? "Thinking…" : "Thinking"}
                  </span>
                  <span style={{
                    fontSize: 10, color: "var(--text-dim)",
                    transform: reasoningExpanded ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.2s ease",
                    display: "inline-block",
                  }}>▾</span>
                </button>
                {reasoningExpanded && (
                  <div style={{
                    maxHeight: 200, overflow: "auto",
                    padding: "0 10px 8px 10px",
                    borderTop: "1px solid var(--border)",
                  }}>
                    <pre style={{
                      margin: 0, padding: "6px 0",
                      fontSize: 11, lineHeight: 1.5,
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-secondary)",
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                    }}>
                      {reasoningStream}
                    </pre>
                  </div>
                )}
              </div>
            )}
            <IMMessageList
              messages={messages}
              humanAgentId={session?.humanAgentId ?? null}
              agentRoleById={agentRoleById}
              fmtTime={fmtTime}
              renderContent={renderContent}
              cx={cx}
            />
            <div ref={bottomRef} />
          </div>

          <div
            className="mid-resizer"
            onPointerDown={handleMidResizeStart}
            onMouseDown={handleMidMouseDown}
            onTouchStart={handleMidTouchStart}
          />

          <div className="viz-shell">
            <div
              ref={vizRef}
              className="viz-canvas"
              style={{
                position: "relative",
                minHeight: 200,
                background:
                  "radial-gradient(circle at 30% 30%, var(--cyan-glow), transparent 50%), radial-gradient(circle at 70% 60%, var(--purple-dim), transparent 45%), var(--bg-void)",
                cursor: vizIsPanning ? "grabbing" : "grab",
              }}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                setVizIsPanning(true);
                vizPanStartRef.current = { x: e.clientX, y: e.clientY, ox: vizOffset.x, oy: vizOffset.y };
              }}
              onMouseMove={(e) => {
                if (!vizIsPanning || !vizPanStartRef.current) return;
                const dx = e.clientX - vizPanStartRef.current.x;
                const dy = e.clientY - vizPanStartRef.current.y;
                setVizOffset({ x: vizPanStartRef.current.ox + dx, y: vizPanStartRef.current.oy + dy });
              }}
              onMouseUp={() => {
                setVizIsPanning(false);
                vizPanStartRef.current = null;
              }}
              onMouseLeave={() => {
                setVizIsPanning(false);
                vizPanStartRef.current = null;
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 12,
                  top: 12,
                  zIndex: "var(--z-raised)",
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid var(--border)",
                  background: "var(--bg-panel)",
                  fontSize: 12,
                  color: "var(--text-primary)",
                }}
              >
                <span className="mono">{t("im.zoom", { value: Math.round(vizScale * 100) })}</span>
                <button
                  className="btn"
                  style={{ padding: "2px 8px", fontSize: 12 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setVizScale((s) => Math.min(s + 0.1, 2));
                  }}
                >
                  +
                </button>
                <button
                  className="btn"
                  style={{ padding: "2px 8px", fontSize: 12 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setVizScale((s) => Math.max(s - 0.1, 0.5));
                  }}
                >
                  -
                </button>
                <button
                  className="btn"
                  style={{ padding: "2px 8px", fontSize: 12 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setVizScale(0.9);
                    setVizOffset({ x: 0, y: 0 });
                  }}
                >
                  {t("common.reset")}
                </button>
                <span className="muted mono">{t("im.zoom_hint")}</span>
              </div>

              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  transform: `translate(${vizOffset.x}px, ${vizOffset.y}px) scale(${vizScale})`,
                  transformOrigin: "center center",
                  transition: vizIsPanning ? "none" : "transform 120ms ease-out",
                }}
              >
                {/* Topology animated canvas overlay */}
                <TopoAnimCanvas
                  width={vizSize.width}
                  height={vizSize.height}
                  nodes={topoNodes}
                  edges={vizLayout.edges}
                />

                <svg
                  width={vizSize.width}
                  height={vizSize.height}
                  style={{ position: "absolute", inset: 0 }}
                >
                  <g>
                    {vizLayout.edges.map((edge) => {
                      const from = vizLayout.positions.get(edge.fromId);
                      const to = vizLayout.positions.get(edge.toId);
                      if (!from || !to) return null;
                      return (
                        <line
                          key={`edge-${edge.fromId}-${edge.toId}`}
                          x1={from.x}
                          y1={from.y}
                          x2={to.x}
                          y2={to.y}
                          stroke="var(--border-bright)"
                          strokeWidth={1.5}
                          opacity={0.4}
                        />
                      );
                    })}
                  </g>
                  <AnimatePresence>
                    {vizBeams.map((beam) => {
                      const from = vizLayout.positions.get(beam.fromId);
                      const to = vizLayout.positions.get(beam.toId);
                      if (!from || !to) return null;
                      const color = beam.kind === "create" ? "var(--purple)" : "var(--cyan)";
                      return (
                        <motion.g
                          key={beam.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 0.9 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.6 }}
                        >
                          <motion.line
                            x1={from.x}
                            y1={from.y}
                            x2={to.x}
                            y2={to.y}
                            stroke={color}
                            strokeWidth={beam.kind === "create" ? 2.5 : 1.6}
                            strokeDasharray={beam.kind === "create" ? "8 6" : "0"}
                            initial={{ pathLength: 0, opacity: 0 }}
                            animate={{ pathLength: 1, opacity: beam.kind === "create" ? 0.5 : 0.35 }}
                            transition={{ duration: 0.5 }}
                          />
                          <motion.circle
                            r={beam.kind === "create" ? 7 : 4}
                            fill={color}
                            initial={{ cx: from.x, cy: from.y }}
                            animate={{ cx: to.x, cy: to.y }}
                            transition={{ duration: 0.8, ease: "easeInOut" }}
                            style={{ filter: `drop-shadow(0 0 ${beam.kind === "create" ? "12px" : "5px"} ${color})` }}
                          />
                          {beam.label ? (
                            <foreignObject
                              x={(from.x + to.x) / 2 - 80}
                              y={(from.y + to.y) / 2 - 40}
                              width={160}
                              height={40}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  fontWeight: 700,
                                  color: beam.kind === "create" ? "var(--beam-create-text)" : "var(--beam-msg-text)",
                                  border: `1px solid ${beam.kind === "create" ? "var(--beam-create-border)" : "var(--beam-msg-border)"}`,
                                  background:
                                    beam.kind === "create"
                                      ? "var(--beam-create-bg)"
                                      : "var(--beam-msg-bg)",
                                  borderRadius: 999,
                                  padding: "4px 8px",
                                  textAlign: "center",
                                }}
                              >
                                {beam.kind === "create" ? `create_agent(${beam.label})` : "send_message"}
                              </div>
                            </foreignObject>
                          ) : null}
                        </motion.g>
                      );
                    })}
                  </AnimatePresence>
                </svg>

                {vizLayout.ordered.map((agent) => {
                  const pos = vizLayout.positions.get(agent.id);
                  if (!pos) return null;
                  const status = agentStatusById[agent.id] ?? "IDLE";
                  const ring = statusColor(status);
                  const isHuman = agent.role === "human";
                  const isActive = streamAgentId === agent.id;
                  const Icon =
                    agent.role === "productmanager"
                      ? Briefcase
                      : agent.role === "coder"
                        ? Code2
                        : agent.role === "assistant"
                          ? Network
                          : User;
                  return (
                    <motion.div
                      key={agent.id}
                      initial={{ scale: 0, opacity: 0, x: pos.x, y: pos.y }}
                      animate={{ scale: 1, opacity: 1, x: pos.x, y: pos.y }}
                      transition={{ type: "spring", stiffness: 220, damping: 18 }}
                      className={cx("viz-node", isActive && "active")}
                      style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        width: 90,
                        height: 90,
                        marginLeft: -45,
                        marginTop: -45,
                        cursor: "grab",
                      }}
                      title={agent.id}
                      onPointerDown={(e) => handleNodePointerDown(agent.id, e)}
                      onMouseDown={(e) => handleNodeMouseDown(agent.id, e)}
                      onTouchStart={(e) => handleNodeTouchStart(agent.id, e)}
                    >
                      {isActive ? (
                        <div className="viz-reticle">
                          <div className="viz-reticle-pulse" />
                        </div>
                      ) : null}
                      <div
                        style={{
                          width: 90,
                          height: 90,
                          borderRadius: "50%",
                          border: `2px solid ${ring}`,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "var(--bg-void)",
                          boxShadow: "0 0 30px var(--cyan-dim)",
                          position: "relative",
                        }}
                      >
                        <div
                          style={{
                            width: 70,
                            height: 70,
                            borderRadius: "50%",
                            border: `2px solid ${isHuman ? "var(--text-primary)" : "var(--green)"}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "var(--bg-overlay)",
                          }}
                        >
                          <Icon size={24} color={isHuman ? "var(--text-primary)" : "var(--text-primary)"} />
                        </div>
                        {status === "BUSY" ? (
                          <motion.div
                            style={{
                              position: "absolute",
                              inset: 6,
                              borderRadius: "50%",
                              border: "2px solid var(--red)",
                              borderTopColor: "transparent",
                              borderRightColor: "transparent",
                            }}
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                          />
                        ) : null}
                      </div>
                      <div
                        style={{
                          position: "absolute",
                          top: 94,
                          left: "50%",
                          transform: "translateX(-50%)",
                          textAlign: "center",
                          width: 120,
                          fontSize: 11,
                          fontWeight: 700,
                          color: "var(--text-primary)",
                        }}
                      >
                        {agent.role}
                        <div style={{ fontSize: 9, color: ring, marginTop: 2 }}>{status}</div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

          </div>
        </div>

        {/* Skill suggestion chips (A-05) — non-intrusive hints above the input */}
        {skillSuggestions.length > 0 && (
          <div style={{
            display: "flex",
            gap: 6,
            padding: "4px 12px",
            flexWrap: "wrap",
            alignItems: "center",
          }}>
            {skillSuggestions.map((sug) => (
              <div
                key={sug.id}
                title={sug.reason}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const prefix = draft ? draft + " " : ""; setDraft(prefix + "@" + sug.skillName + " "); dismissSkillSuggestion(sug.id); } }}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 8px",
                  borderRadius: 12,
                  fontSize: 11,
                  background: "var(--surface-2, #2a2a3a)",
                  border: "1px solid var(--border, #3a3a4a)",
                  color: "var(--text-secondary, #aaa)",
                  cursor: "pointer",
                  transition: "background 0.15s, color 0.15s",
                  maxWidth: 260,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  textOverflow: "ellipsis",
                }}
                onClick={() => {
                  const prefix = draft ? draft + " " : "";
                  setDraft(prefix + "@" + sug.skillName + " ");
                  dismissSkillSuggestion(sug.id);
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "var(--surface-3, #3a3a5a)";
                  (e.currentTarget as HTMLDivElement).style.color = "var(--text-primary, #ddd)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "var(--surface-2, #2a2a3a)";
                  (e.currentTarget as HTMLDivElement).style.color = "var(--text-secondary, #aaa)";
                }}
              >
                <span style={{ opacity: 0.6, fontSize: 10 }} aria-hidden="true">💡</span>
                <span style={{ fontWeight: 500 }}>@{sug.skillName}</span>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`忽略 ${sug.skillName} 建议`}
                  style={{
                    opacity: 0.5,
                    fontSize: 10,
                    cursor: "pointer",
                    marginLeft: 2,
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissSkillSuggestion(sug.id);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); dismissSkillSuggestion(sug.id); } }}
                >
                  ✕
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="chat-input-area">
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: "none" }}
            accept="image/*,.pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.pptx,.js,.ts,.tsx,.py,.rs,.go,.java,.c,.cpp,.h,.css,.html,.json,.yaml,.yml,.xml,.sh,.sql,.rb,.swift,.kt"
            onChange={handleFileSelect}
          />
          <button
            className="chat-attach"
            title={t("im.upload_file")}
            aria-label={t("im.upload_file")}
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            style={{ opacity: uploading ? 0.5 : 1, cursor: uploading ? "wait" : "pointer" }}
          >
            {uploading ? t("im.uploading") : "+"}
          </button>
          <input
            className="chat-input-field"
            type="text"
            value={draft}
            onChange={handleDraftChange}
            placeholder={t("im.input_placeholder")}
            aria-label="Message input"
            onKeyDown={(e) => {
              // Skill popup takes priority for navigation keys
              if (skillPopupOpen && filteredSkills.length > 0) {
                if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Tab") {
                  e.preventDefault();
                  handleSkillKeyDown(e);
                  return;
                }
                if (e.key === "Enter" && !(e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSkillKeyDown(e);
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setSkillPopupOpen(false);
                  return;
                }
              }
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void onSend();
              }
            }}
          />
          {/* Skill autocomplete popup */}
          {skillPopupOpen && filteredSkills.length > 0 && (
            <div className="skill-autocomplete">
              {filteredSkills.map((skill, i) => (
                <div
                  key={skill.name}
                  className={"skill-autocomplete-item" + (i === skillSelectedIndex ? " active" : "")}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectSkill(skill.name);
                  }}
                  onMouseEnter={() => setSkillSelectedIndex(i)}
                >
                  <span className="skill-autocomplete-name">@{skill.name}</span>
                  {skill.description && (
                    <span className="skill-autocomplete-desc">{skill.description}</span>
                  )}
                </div>
              ))}
            </div>
          )}
          <select
            className="chat-model"
            value={selectedModel}
            aria-label="Select model"
            onChange={(e) => {
              const model = e.target.value;
              setSelectedModel(model);
              // Tell backend to use this model for subsequent LLM calls
              fetch("/api/settings/model", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ model }),
              }).catch(() => {});
            }}
          >
            <option value="auto">{t("im.model_auto")}</option>
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} ({m.platform})
              </option>
            ))}
          </select>
          <button className="send-btn" onClick={() => void onSend()} disabled={!draft.trim() || status === "send"} aria-label="Send message">
            {t("im.send")}
          </button>
        </div>
        </main>
        </ErrorBoundary>
      }
      right={
        <ErrorBoundary name="IM.TaskMonitor">
        <TaskMonitor
          agents={agents}
          agentStatusById={agentStatusById}
          groups={groups}
          activeGroupId={activeGroupId}
          vizEvents={vizEvents}
          streamAgentId={streamAgentId}
          contentStream={contentStream}
          reasoningStream={reasoningStream}
          toolStream={toolStream}
          agentError={agentError}
          llmHistory={llmHistory}
          todoItems={taskMonitorData.todoItems}
          artifacts={taskMonitorData.artifacts}
          usedSkills={taskMonitorData.usedSkills}
        />
        </ErrorBoundary>
      }
    />
  );
}

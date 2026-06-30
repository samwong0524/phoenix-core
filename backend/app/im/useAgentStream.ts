import { useCallback, useEffect, useRef } from "react";
import { useIMStore } from "./store";
import type { AgentStreamEvent, WorkspaceDefaults } from "./types";
import { loadSession, api } from "./helpers";
import { useI18n } from "@/lib/i18n/context";

/**
 * Manages the per-agent SSE context-stream.
 * Reads/writes Zustand store directly for stable references.
 */
export function useAgentStream(streamAgentId: string | null) {
  const { t } = useI18n();
  const {
    activeGroupId, agentError,
    setLlmHistory, setContentStream, setReasoningStream, setToolStream,
    setAgentError, setAgentActivity, setAgentActivityTool,
    setMessages, setGroups,
  } = useIMStore();

  const esRef = useRef<EventSource | null>(null);
  const streamAgentIdRef = useRef<string | null>(null);
  const activeGroupIdRef = useRef<string | null>(null);
  const toolCallBuffersRef = useRef(new Map<string, string>());
  const toolResultBuffersRef = useRef(new Map<string, string>());
  const activityDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const llmHistoryReqIdRef = useRef(0);

  useEffect(() => { activeGroupIdRef.current = activeGroupId; }, [activeGroupId]);

  const setActivityDebounced = useCallback((kind: string, tool?: string) => {
    if (activityDebounceRef.current) clearTimeout(activityDebounceRef.current);
    setAgentActivity(kind);
    setAgentActivityTool(tool ?? "");
    activityDebounceRef.current = setTimeout(() => {
      setAgentActivity(null);
      setAgentActivityTool("");
    }, 4000);
  }, [setAgentActivity, setAgentActivityTool]);

  // Internal refresh functions (duplicated from page.tsx — will be consolidated in 2.2.7)
  const refreshMessages = useCallback(
    async (s: WorkspaceDefaults, groupId: string, opts?: { markRead?: boolean; silent?: boolean }) => {
      try {
        const url = `/api/workspaces/${encodeURIComponent(s.workspaceId)}/groups/${encodeURIComponent(groupId)}/messages`;
        const { messages } = await api<{ messages: Array<{ id: string; senderId: string; content: string; contentType: string; sendTime: string }> }>(url);
        if (messages) {
          setMessages(messages);
          if (opts?.markRead) {
            fetch(`/api/workspaces/${encodeURIComponent(s.workspaceId)}/groups/${encodeURIComponent(groupId)}/read`, { method: "POST" }).catch(() => {});
          }
        }
      } catch {
        // silent
      }
    },
    [setMessages],
  );

  const refreshGroups = useCallback(
    async (s: WorkspaceDefaults) => {
      try {
        const { groups } = await api<{ groups: unknown[] }>(`/api/workspaces/${encodeURIComponent(s.workspaceId)}/groups`);
        if (groups) setGroups(groups as any);
      } catch {
        // silent
      }
    },
    [setGroups],
  );

  const refreshLlmHistory = useCallback(
    async (agentId: string) => {
      const reqId = (llmHistoryReqIdRef.current += 1);
      try {
        const res = await api<{ llmHistory: string }>(`/api/agents/${agentId}`);
        if (reqId !== llmHistoryReqIdRef.current) return;
        setLlmHistory(res.llmHistory ?? "");
      } catch (e) {
        if (reqId !== llmHistoryReqIdRef.current) return;
        setLlmHistory(
          e instanceof Error ? `(failed to load llm_history: ${e.message})` : "(failed to load llm_history)",
        );
      }
    },
    [setLlmHistory],
  );

  const connectAgentStream = useCallback(
    (agentId: string) => {
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
              if (payload.data.kind === "content") {
                setContentStream((prev: string) => prev + chunk);
                setActivityDebounced("generating");
              } else if (payload.data.kind === "reasoning") {
                setReasoningStream((prev: string) => prev + chunk);
                setActivityDebounced("thinking");
              } else {
                const name = payload.data.tool_call_name ?? payload.data.tool_call_id ?? "tool";
                setActivityDebounced("executing", name);
                const key = payload.data.tool_call_id ?? name;
                const buffers =
                  payload.data.kind === "tool_result"
                    ? toolResultBuffersRef.current
                    : toolCallBuffersRef.current;
                const next = `${buffers.get(key) ?? ""}${chunk}`;
                buffers.set(key, next);
                const callLines = Array.from(toolCallBuffersRef.current.entries()).map(
                  ([id, value]) => `tool_calls[${id}]: ${value}`,
                );
                const resultLines = Array.from(toolResultBuffersRef.current.entries()).map(
                  ([id, value]) => `tool_result[${id}]: ${value}`,
                );
                setToolStream([...callLines, ...resultLines].join("\n\n"));
              }
            }
            return;
          }
          if (payload.event === "agent.wakeup") {
            setContentStream("");
            setReasoningStream("");
            setToolStream("");
            setActivityDebounced("thinking");
            toolCallBuffersRef.current = new Map();
            toolResultBuffersRef.current = new Map();
            return;
          }
          if (payload.event === "agent.unread") {
            setContentStream("");
            setReasoningStream("");
            setToolStream("");
            toolCallBuffersRef.current = new Map();
            toolResultBuffersRef.current = new Map();
            return;
          }
          if (payload.event === "agent.done") {
            setAgentActivity(null);
            setAgentActivityTool("");
            setAgentError(null);
            toolCallBuffersRef.current = new Map();
            toolResultBuffersRef.current = new Map();
            const gid = activeGroupIdRef.current;
            const nextSession = loadSession();
            if (nextSession && gid) void refreshMessages(nextSession, gid, { markRead: false, silent: true });
            if (nextSession) void refreshGroups(nextSession);
            const aid = streamAgentIdRef.current;
            if (aid) void refreshLlmHistory(aid);
            return;
          }
          if (payload.event === "agent.error") {
            setAgentError(payload.data.message);
          }
        } catch {
          // ignore
        }
      };

      es.onerror = () => setAgentError(t("im.sse_disconnected"));
    },
    [
      agentError, setLlmHistory, setContentStream, setReasoningStream, setToolStream,
      setAgentError, setActivityDebounced, refreshMessages, refreshGroups, refreshLlmHistory, t,
    ],
  );

  // Connect when streamAgentId changes
  useEffect(() => {
    if (!streamAgentId) return;
    connectAgentStream(streamAgentId);
    setLlmHistory("");
    void refreshLlmHistory(streamAgentId);
  }, [connectAgentStream, refreshLlmHistory, streamAgentId, setLlmHistory]);

  // Cleanup on unmount
  useEffect(() => {
    return () => esRef.current?.close();
  }, []);

  /** Force-connect to a specific agent (used by hireSubAgent / onSend after creating new agents). */
  const reconnect = useCallback(
    (agentId: string) => {
      streamAgentIdRef.current = agentId;
      esRef.current?.close();
      connectAgentStream(agentId);
      setLlmHistory("");
      void refreshLlmHistory(agentId);
    },
    [connectAgentStream, refreshLlmHistory, setLlmHistory],
  );

  return { esRef, reconnect };
}

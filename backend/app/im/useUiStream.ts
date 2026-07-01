import { useCallback, useEffect, useRef } from "react";
import { useIMStore } from "./store";
import type {
  UUID, WorkspaceDefaults, AgentMeta, AgentStatus,
  UiStreamEvent, VizEvent, VizBeam, VizDebugEntry, Group,
} from "./types";
import { useI18n } from "@/lib/i18n/context";

/**
 * Manages the workspace UI stream (EventSource /api/ui-stream).
 * Handles all ui.* events: agent created/deleted, message, llm, tool_call, db, skill suggestion.
 * Also owns viz helpers (pushVizEvent, pushBeam, logVizDebug) and the debounced refresh scheduler.
 */
export function useUiStream(
  session: WorkspaceDefaults | null,
  agents: AgentMeta[],
  groups: Group[],
  refresh: {
    groups: (s: WorkspaceDefaults, opts?: { silent?: boolean }) => Promise<void>;
    agents: (s: WorkspaceDefaults) => Promise<void>;
    messages: (s: WorkspaceDefaults, groupId: string, opts?: {
      markRead?: boolean; silent?: boolean; skipGroupRefresh?: boolean; scrollToBottom?: boolean;
    }) => Promise<void>;
    llmHistory: (agentId: string) => Promise<void>;
  },
  activeGroupIdRef: React.RefObject<string | null>,
  streamAgentIdValueRef: React.RefObject<string | null>,
) {
  const { t } = useI18n();
  const {
    setVizEvents, setVizBeams, setVizDebug, setAgentStatusById,
    setAgents, setGroups, addSkillSuggestion,
  } = useIMStore();

  // Internal refs (only used by UI stream logic)
  const agentRoleByIdRef = useRef<Map<string, string>>(new Map());
  const groupsRef = useRef<Group[]>([]);
  const beamTimeoutsRef = useRef<number[]>([]);
  const workingAgentIdsRef = useRef<Set<string>>(new Set());
  const refreshQueueRef = useRef<{
    timer: number | null;
    pending: { groups: boolean; agents: boolean; messages: boolean; llmHistory: boolean };
  }>({ timer: null, pending: { groups: false, agents: false, messages: false, llmHistory: false } });

  // Keep refs in sync with latest state
  useEffect(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.role);
    agentRoleByIdRef.current = map;
  }, [agents]);

  useEffect(() => { groupsRef.current = groups; }, [groups]);

  // Cleanup beam timeouts on unmount
  useEffect(() => {
    return () => {
      beamTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
      beamTimeoutsRef.current = [];
    };
  }, []);

  // ── Viz helpers ──────────────────────────────────────────────

  const pushVizEvent = useCallback(
    (event: UiStreamEvent, label: string, kind: VizEvent["kind"]) => {
      const at = typeof event.at === "number" ? event.at : Date.now();
      const id = `${event.id ?? at}-${Math.random().toString(16).slice(2)}`;
      setVizEvents((prev) => [...prev, { id, kind, label, at }].slice(-20));
    },
    [],
  );

  const pushBeam = useCallback((beam: Omit<VizBeam, "id" | "createdAt">) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const createdAt = Date.now();
    setVizBeams((prev) => [...prev, { ...beam, id, createdAt }].slice(-12));
    const timeoutId = window.setTimeout(() => {
      setVizBeams((prev) => prev.filter((b) => b.id !== id));
    }, 2400);
    beamTimeoutsRef.current.push(timeoutId);
  }, []);

  const logVizDebug = useCallback((entry: Omit<VizDebugEntry, "id" | "at">) => {
    const record: VizDebugEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: Date.now(),
    };
    setVizDebug((prev) => [...prev, record].slice(-200));
    if (typeof window !== "undefined") {
      (window as any).__imVizDebug = (window as any).__imVizDebug ?? [];
      (window as any).__imVizDebug.push(record);
      // eslint-disable-next-line no-console
      console.debug("[im-viz]", record);
    }
  }, []);

  // ── Debounced workspace refresh ──────────────────────────────

  const scheduleWorkspaceRefresh = useCallback(
    (opts?: { groups?: boolean; agents?: boolean; messages?: boolean; llmHistory?: boolean }) => {
      if (!session) return;
      const pending = refreshQueueRef.current.pending;
      pending.groups = opts?.groups ?? true;
      pending.agents = opts?.agents ?? false;
      pending.messages = opts?.messages ?? true;
      pending.llmHistory = opts?.llmHistory ?? false;

      if (refreshQueueRef.current.timer !== null) return;
      refreshQueueRef.current.timer = window.setTimeout(() => {
        const next = refreshQueueRef.current.pending;
        refreshQueueRef.current.pending = {
          groups: false,
          agents: false,
          messages: false,
          llmHistory: false,
        };
        refreshQueueRef.current.timer = null;

        if (next.groups) void refresh.groups(session, { silent: true });
        if (next.agents) void refresh.agents(session);
        if (next.llmHistory && streamAgentIdValueRef.current) {
          void refresh.llmHistory(streamAgentIdValueRef.current);
        }
        if (next.messages && activeGroupIdRef.current) {
          void refresh.messages(session, activeGroupIdRef.current, {
            markRead: false,
            silent: true,
            skipGroupRefresh: true,
            scrollToBottom: false,
          });
        }
      }, 500);
    },
    [refresh, session, activeGroupIdRef, streamAgentIdValueRef],
  );

  // ── UI EventSource ───────────────────────────────────────────

  useEffect(() => {
    if (!session) return;
    const es = new EventSource(`/api/ui-stream?workspaceId=${encodeURIComponent(session.workspaceId)}`);

    es.onmessage = (evt) => {
      let payload: UiStreamEvent | null = null;
      try {
        payload = JSON.parse(evt.data) as UiStreamEvent;
      } catch {
        payload = null;
      }
      if (payload) {
        if (payload.event === "ui.agent.created") {
          const role = payload.data?.agent?.role ?? "agent";
          const agentId = payload.data?.agent?.id as UUID | undefined;
          const parentId = payload.data?.agent?.parentId as UUID | null | undefined;
          pushVizEvent(payload, t("im.create_agent", { role }), "agent");
          if (agentId) {
            const fromId = parentId || session.humanAgentId;
            pushBeam({ fromId, toId: agentId, kind: "create", label: role });
          }
          if (agentId) {
            setAgentStatusById((prev) => ({ ...prev, [agentId]: "IDLE" }));
          }
          // Optimistic update: append new agent to list without API refresh (avoids flash)
          if (agentId) {
            setAgents((prev) => {
              if (prev.some((a) => a.id === agentId)) return prev; // dedup
              return [...prev, { id: agentId, role, parentId: parentId ?? null, createdAt: new Date().toISOString() }];
            });
          }
        } else if (payload.event === "ui.agent.deleted") {
          const agentId = payload.data?.agentId as UUID | undefined;
          if (agentId) {
            setAgents((prev) => prev.filter((a) => a.id !== agentId));
            setAgentStatusById((prev) => {
              const next: Record<string, AgentStatus> = { ...prev };
              delete next[agentId];
              return next;
            });
          }
        } else if (payload.event === "ui.group.created") {
          // Optimistic update: insert new group immediately so agents become visible
          const groupData = payload.data?.group as { id: string; name: string; memberIds: string[] } | undefined;
          if (groupData?.id) {
            setGroups((prev) => {
              if (prev.some((g) => g.id === groupData.id)) return prev; // dedup
              const now = new Date().toISOString();
              return [...prev, {
                id: groupData.id as UUID,
                name: groupData.name,
                memberIds: (groupData.memberIds ?? []) as UUID[],
                unreadCount: 0,
                contextTokens: 0,
                updatedAt: now,
                createdAt: now,
              }];
            });
          }
        } else if (payload.event === "ui.message.created") {
          const senderId = payload.data?.message?.senderId as UUID | undefined;
          const groupId = payload.data?.groupId as UUID | undefined;
          const senderRole = senderId
            ? agentRoleByIdRef.current.get(senderId) ?? senderId.slice(0, 6)
            : "unknown";
          pushVizEvent(payload, t("im.message_from", { sender: senderRole }), "message");
          logVizDebug({
            type: "message_event",
            data: {
              messageId: payload.data?.message?.id,
              groupId,
              senderId,
              senderRole,
              hasGroup: !!groupsRef.current.find((g) => g.id === groupId),
            },
          });
          if (senderId && groupId) {
            const payloadMembers = Array.isArray(payload.data?.memberIds) ? payload.data.memberIds : null;
            const groupMembers =
              payloadMembers ??
              groupsRef.current.find((g) => g.id === groupId)?.memberIds ??
              [];
            const targetIds = groupMembers.filter((id: UUID) => id !== senderId);
            if (targetIds.length === 0) {
              logVizDebug({
                type: "beam_skipped",
                data: { reason: "no_targets", groupId, senderId },
              });
            } else {
              targetIds.forEach((targetId) => {
                pushBeam({ fromId: senderId, toId: targetId, kind: "message" });
                logVizDebug({
                  type: "beam_created",
                  data: { groupId, senderId, targetId },
                });
              });
            }
          }
        } else if (payload.event === "ui.agent.working.start") {
          const agentId = payload.data?.agentId as UUID | undefined;
          if (agentId) {
            workingAgentIdsRef.current.add(agentId);
            setAgentStatusById((prev) => ({ ...prev, [agentId]: "BUSY" }));
            pushVizEvent(payload, t("im.working_start", { agent: agentId.slice(0, 8) }), "agent");
          }
        } else if (payload.event === "ui.agent.working.done") {
          const agentId = payload.data?.agentId as UUID | undefined;
          if (agentId) {
            workingAgentIdsRef.current.delete(agentId);
            setAgentStatusById((prev) => ({ ...prev, [agentId]: "IDLE" }));
            pushVizEvent(payload, t("im.working_done", { agent: agentId.slice(0, 8) }), "agent");
          }
        } else if (payload.event === "ui.agent.llm.start" || payload.event === "ui.agent.llm.done") {
          const agentId = payload.data?.agentId as UUID | undefined;
          const role = agentId
            ? agentRoleByIdRef.current.get(agentId) ?? agentId.slice(0, 6)
            : "agent";
          const label = payload.event === "ui.agent.llm.start"
            ? t("im.llm_start", { role })
            : t("im.llm_done", { role });
          pushVizEvent(payload, label, "llm");
          if (agentId) {
            if (payload.event === "ui.agent.llm.start") {
              setAgentStatusById((prev) => ({ ...prev, [agentId]: "BUSY" }));
            } else {
              // Only set IDLE if agent is not in working state
              if (!workingAgentIdsRef.current.has(agentId)) {
                setAgentStatusById((prev) => ({ ...prev, [agentId]: "IDLE" }));
              }
            }
          }
        } else if (
          payload.event === "ui.agent.tool_call.start" ||
          payload.event === "ui.agent.tool_call.done"
        ) {
          const agentId = payload.data?.agentId as UUID | undefined;
          const toolName = payload.data?.toolName ?? "tool";
          const role = agentId
            ? agentRoleByIdRef.current.get(agentId) ?? agentId.slice(0, 6)
            : "agent";
          const label = payload.event === "ui.agent.tool_call.start"
            ? t("im.tool_start", { role, name: toolName })
            : t("im.tool_done", { role, name: toolName });
          pushVizEvent(payload, label, "tool");
          if (agentId) {
            if (payload.event === "ui.agent.tool_call.start") {
              setAgentStatusById((prev) => ({ ...prev, [agentId]: "BUSY" }));
            } else {
              // Only set IDLE if agent is not in working state
              if (!workingAgentIdsRef.current.has(agentId)) {
                setAgentStatusById((prev) => ({ ...prev, [agentId]: "IDLE" }));
              }
            }
          }
        } else if (payload.event === "ui.agent.interrupt_all") {
          pushVizEvent(payload, t("im.stop_all_event"), "agent");
          const ids = Array.isArray(payload.data?.agentIds)
            ? (payload.data.agentIds as UUID[])
            : [];
          // Clear working state for interrupted agents
          if (ids.length > 0) {
            for (const id of ids) workingAgentIdsRef.current.delete(id);
          } else {
            workingAgentIdsRef.current.clear();
          }
          setAgentStatusById((prev) => {
            const next = { ...prev };
            const targetIds = ids.length > 0 ? ids : Object.keys(next);
            for (const id of targetIds) {
              next[id] = "IDLE";
            }
            return next;
          });
        } else if (payload.event === "ui.db.write") {
          const table = payload.data?.table ?? "db";
          const action = payload.data?.action ?? "write";
          pushVizEvent(payload, `DB ${action}: ${table}`, "db");
        } else if (payload.event === "ui.skill.suggestion") {
          const skillName = (payload.data?.skillName as string) ?? "";
          const confidence = (payload.data?.confidence as number) ?? 0;
          const reason = (payload.data?.reason as string) ?? "";
          const triggerPattern = (payload.data?.triggerPattern as string) ?? "";
          if (skillName && confidence >= 0.8) {
            addSkillSuggestion({ skillName, confidence, reason, triggerPattern });
          }
        }
      }

      // any change in workspace => refresh only what changed
      // Refresh llmHistory on tool_call.done so task monitor stays current during agent runs
      const shouldRefreshLlmHistory = payload?.event === "ui.agent.tool_call.done";
      scheduleWorkspaceRefresh({ groups: true, agents: false, messages: true, llmHistory: shouldRefreshLlmHistory });
    };
    es.onerror = () => {
      // tolerate disconnects; user can refresh manually
    };

    return () => es.close();
  }, [
    logVizDebug,
    pushBeam,
    pushVizEvent,
    scheduleWorkspaceRefresh,
    session,
  ]);
}

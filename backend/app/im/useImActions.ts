import { useCallback, useMemo, useRef } from "react";
import { useIMStore } from "./store";
import type { WorkspaceDefaults, AgentMeta, Group, Message } from "./types";
import { useI18n } from "@/lib/i18n/context";
import { useConfirm } from "../_components/confirm-dialog";
import { ROUTES } from "@/app/_components/routes";
import { detectAtTrigger } from "@/lib/skill-utils";
import { loadSession, saveSession, api } from "./helpers";

/**
 * IM page action hooks: data refresh, workspace lifecycle, messaging,
 * agent management, skill autocomplete, and file upload.
 */
export function useImActions(
  connectAgentStream: (agentId: string) => void,
  bottomRef: React.RefObject<HTMLDivElement | null>,
  messagesRef: React.RefObject<Message[]>,
) {
  const { t } = useI18n();
  const confirmAction = useConfirm();
  const llmHistoryReqIdRef = useRef(0);

  const {
    // State
    session, agents, activeGroupId, draft, stoppingAgents,
    skillList, skillPopupOpen, skillFilter, skillSelectedIndex, atTriggerPos,
    workingDir,
    // Setters
    setSession, setTokenLimit, setGroups, setAgents, setActiveGroupId,
    setMessages, setLlmHistory, setStatus, setError, setDraft,
    setAgentError, setAgentStatusById, setStopping, setUploading,
    setSkillPopupOpen, setSkillFilter, setSkillSelectedIndex, setAtTriggerPos,
  } = useIMStore();

  // ── Data refresh ─────────────────────────────────────────────

  const refreshAgents = useCallback(async (s: WorkspaceDefaults) => {
    const { agents } = await api<{ agents: AgentMeta[] }>(
      `/api/agents?workspaceId=${encodeURIComponent(s.workspaceId)}&meta=true`
    );
    // Merge: preserve any optimistic entries not yet in the API response
    setAgents((prev) => {
      const apiIds = new Set(agents.map((a) => a.id));
      const optimisticOnly = prev.filter((a) => !apiIds.has(a.id));
      if (optimisticOnly.length === 0 && agents.length === prev.length) return agents;
      return [...agents, ...optimisticOnly];
    });
  }, []);

  const refreshGroupsLastCall = useRef(0);
  const REFRESH_GROUPS_DEBOUNCE_MS = 2000; // Prevent more than 1 call per 2 seconds

  const refreshGroups = useCallback(async (s: WorkspaceDefaults, opts?: { silent?: boolean }) => {
    // Debounce: skip if called too recently (unless forced)
    const now = Date.now();
    if (now - refreshGroupsLastCall.current < REFRESH_GROUPS_DEBOUNCE_MS) {
      return;
    }
    refreshGroupsLastCall.current = now;

    if (!opts?.silent) setStatus("groups");
    const q = new URLSearchParams({ workspaceId: s.workspaceId, agentId: s.humanAgentId });
    const { groups } = await api<{ groups: Group[] }>(`/api/groups?${q.toString()}`);
    setGroups(groups);
    if (!opts?.silent) setStatus("idle");
  }, []);

  const refreshMessagesLastCall = useRef<Map<string, number>>(new Map());
  const REFRESH_MESSAGES_DEBOUNCE_MS = 1000; // Prevent more than 1 call per second per group

  const refreshMessages = useCallback(
    async (
      s: WorkspaceDefaults,
      groupId: string,
      opts?: { markRead?: boolean; silent?: boolean; scrollToBottom?: boolean }
    ) => {
      // Debounce: skip if called too recently for this groupId
      const now = Date.now();
      const lastCall = refreshMessagesLastCall.current.get(groupId) ?? 0;
      if (now - lastCall < REFRESH_MESSAGES_DEBOUNCE_MS) {
        return;
      }
      refreshMessagesLastCall.current.set(groupId, now);

      if (!opts?.silent) setStatus("messages");
      const q = new URLSearchParams();
      if (opts?.markRead ?? true) q.set("markRead", "true");
      q.set("readerId", s.humanAgentId);
      const suffix = q.size ? `?${q.toString()}` : "";
      const { messages } = await api<{ messages: Message[] }>(
        `/api/groups/${groupId}/messages${suffix}`
      );
      const prev = messagesRef.current!;
      // Only update state if messages actually changed — calling setMessages
      // with a new array reference triggers a full re-render of IMPageInner,
      // which causes the white flash.
      if (messages.length !== prev.length) {
        (messagesRef as React.MutableRefObject<Message[]>).current = messages;
        setMessages(messages);
      } else if (messages.length > 0) {
        const lastPrev = prev[prev.length - 1];
        const lastNew = messages[messages.length - 1];
        if (lastPrev.id !== lastNew.id) {
          (messagesRef as React.MutableRefObject<Message[]>).current = messages;
          setMessages(messages);
        }
      }
      if (!opts?.silent) setStatus("idle");
      // Note: caller is responsible for firing refreshGroups in parallel if needed.
      // Previously this was chained here causing a waterfall (messages → groups sequential).
      if (opts?.scrollToBottom ?? messages.length > prev.length) {
        queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
      }
    },
    [bottomRef, messagesRef],
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
          e instanceof Error ? `(failed to load llm_history: ${e.message})` : "(failed to load llm_history)"
        );
      }
    },
    [],
  );

  // ── Workspace lifecycle ──────────────────────────────────────

  const bootstrap = useCallback(async (overrideWorkspaceId: string | null) => {
    setError(null);
    setAgentError(null);
    setStatus("boot");

    setGroups([]);
    setMessages([]);
    setLlmHistory("");

    if (overrideWorkspaceId) {
      const init = await api<{
        session: WorkspaceDefaults;
        config: { tokenLimit: number };
        agents: AgentMeta[];
        groups: Group[];
      }>(`/api/workspace-init?overrideWorkspaceId=${encodeURIComponent(overrideWorkspaceId)}${workingDir ? `&workingDir=${encodeURIComponent(workingDir)}` : ""}`);
      setTokenLimit(init.config.tokenLimit);
      saveSession(init.session);
      setSession(init.session);
      setAgents(init.agents);
      setGroups(init.groups);
      setActiveGroupId(init.session.defaultGroupId);
      setStatus("idle");
      return;
    }

    const existing = loadSession();
    if (existing) {
      try {
        const init = await api<{
          session: WorkspaceDefaults;
          config: { tokenLimit: number };
          agents: AgentMeta[];
          groups: Group[];
        }>(`/api/workspace-init?workspaceId=${encodeURIComponent(existing.workspaceId)}${workingDir ? `&workingDir=${encodeURIComponent(workingDir)}` : ""}`);
        setTokenLimit(init.config.tokenLimit);
        saveSession(init.session);
        setSession(init.session);
        setAgents(init.agents);
        setGroups(init.groups);
        setActiveGroupId(init.session.defaultGroupId);
        setStatus("idle");
        return;
      } catch {
        // fall through
      }
    }

    try {
      const recent = await api<{
        workspaces: Array<{ id: string; name: string; createdAt: string }>;
      }>(`/api/workspaces`);
      if (recent.workspaces.length > 0) {
        const targetId = recent.workspaces[0]!.id;
        const init = await api<{
          session: WorkspaceDefaults;
          config: { tokenLimit: number };
          agents: AgentMeta[];
          groups: Group[];
        }>(`/api/workspace-init?workspaceId=${encodeURIComponent(targetId)}${workingDir ? `&workingDir=${encodeURIComponent(workingDir)}` : ""}`);
        setTokenLimit(init.config.tokenLimit);
        saveSession(init.session);
        setSession(init.session);
        setAgents(init.agents);
        setGroups(init.groups);
        setActiveGroupId(init.session.defaultGroupId);
        setStatus("idle");
        return;
      }
    } catch {
      // fall through
    }

    const created = await api<WorkspaceDefaults>(`/api/workspaces`, {
      method: "POST",
      body: JSON.stringify({ name: t("im.default_workspace") }),
    });
    saveSession(created);
    setSession(created);
    setActiveGroupId(created.defaultGroupId);
    setStatus("idle");
    void refreshAgents(created);
  }, [refreshAgents, workingDir]);

  const createWorkspace = useCallback(async (name?: string) => {
    setError(null);
    setAgentError(null);
    setStatus("boot");
    const created = await api<WorkspaceDefaults>(`/api/workspaces`, {
      method: "POST",
      body: JSON.stringify({ name: name?.trim() || t("im.new_workspace") }),
    });
    saveSession(created);
    setSession(created);
    setActiveGroupId(created.defaultGroupId);
    setStatus("idle");
    window.history.replaceState(null, "", ROUTES.CHAT);
    void refreshAgents(created);
    return created;
  }, [refreshAgents]);

  // ── Agent actions ────────────────────────────────────────────

  const hireSubAgent = useCallback(async () => {
    if (!session) return;
    const role = (window.prompt(t("im.sub_agent_role_prompt"), t("im.sub_agent_role_default")) ?? "").trim();
    if (!role) return;

    setError(null);
    setAgentError(null);
    setStatus("boot");

    try {
      const created = await api<{ agentId: string; groupId: string }>(`/api/agents`, {
        method: "POST",
        body: JSON.stringify({
          workspaceId: session.workspaceId,
          creatorId: session.humanAgentId,
          role,
        }),
      });

      setStatus("idle");
      void refreshGroups(session);
      void refreshAgents(session);
      setActiveGroupId(created.groupId);
      connectAgentStream(created.agentId);
    } catch (e) {
      setStatus("idle");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [connectAgentStream, refreshGroups, refreshAgents, session]);

  const onInterruptAllAgents = useCallback(async () => {
    if (!session || stoppingAgents) return;

    const ok = await confirmAction({
      title: "Interrupt All Agents",
      message: "This will stop all running agents in this workspace. Any in-progress tasks will be interrupted and may need to be restarted.",
      confirmLabel: "Stop All Agents",
      variant: "warning",
    });
    if (!ok) return;

    setStopping(true);
    setError(null);
    setAgentError(null);

    try {
      const res = await api<{ ok: boolean; interrupted: number; agentIds: string[] }>(
        `/api/agents/interrupt-all`,
        {
          method: "POST",
          body: JSON.stringify({ workspaceId: session.workspaceId }),
        }
      );

      setAgentStatusById((prev) => {
        const next = { ...prev };
        const ids = res.agentIds.length > 0 ? res.agentIds : agents.map((agent) => agent.id);
        for (const id of ids) {
          next[id] = "IDLE";
        }
        return next;
      });
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStopping(false);
    }
  }, [agents, session, stoppingAgents, confirmAction]);

  // ── Messaging ────────────────────────────────────────────────

  const onSend = useCallback(async () => {
    if (!session || !activeGroupId) return;
    const text = draft.trim();
    if (!text) return;

    if (text.startsWith("/create") || text.startsWith("/hire")) {
      const role = text.replace(/^\/(create|hire)\s*/i, "").trim();
      if (!role) {
        setError(t("im.usage_create"));
        return;
      }

      setStatus("boot");
      setError(null);

      try {
        const created = await api<{ agentId: string; groupId: string }>(`/api/agents`, {
          method: "POST",
          body: JSON.stringify({
            workspaceId: session.workspaceId,
            creatorId: session.humanAgentId,
            role,
          }),
        });
        setDraft("");
        setStatus("idle");
        void refreshGroups(session);
        void refreshAgents(session);
        setActiveGroupId(created.groupId);
        connectAgentStream(created.agentId);
        return;
      } catch (e) {
        setStatus("idle");
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }

    setStatus("send");
    setError(null);

    const optimistic: Message = {
      id: `optimistic-${Date.now()}`,
      senderId: session.humanAgentId,
      content: text,
      contentType: "text",
      sendTime: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimistic]);
    setDraft("");
    queueMicrotask(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));

    try {
      await api(`/api/groups/${activeGroupId}/messages`, {
        method: "POST",
        body: JSON.stringify({ senderId: session.humanAgentId, content: text, contentType: "text" }),
      });
    } finally {
      // keep going
    }

    setStatus("idle");
    void refreshMessages(session, activeGroupId, { markRead: false, scrollToBottom: false, silent: true });
    void refreshGroups(session, { silent: true });
  }, [
    activeGroupId,
    connectAgentStream,
    draft,
    refreshAgents,
    refreshGroups,
    refreshMessages,
    session,
    bottomRef,
  ]);

  // ── File upload ──────────────────────────────────────────────

  const uploadFile = useCallback(async (file: File) => {
    if (!session || !activeGroupId) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) { alert(t("im.upload_failed", { error: data.error })); return; }

      const content = JSON.stringify({ url: data.url, name: data.name, size: data.size });
      const contentType = data.isImage ? "image" : "file";

      const optimistic: Message = {
        id: `optimistic-${Date.now()}`,
        senderId: session.humanAgentId,
        content,
        contentType,
        sendTime: new Date().toISOString(),
      };
      setMessages((m) => [...m, optimistic]);

      try {
        await api(`/api/groups/${activeGroupId}/messages`, {
          method: "POST",
          body: JSON.stringify({ senderId: session.humanAgentId, content, contentType }),
        });
      } finally { /* keep going */ }

      void refreshMessages(session, activeGroupId, { markRead: false, scrollToBottom: false });
      void refreshGroups(session);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }, [activeGroupId, refreshGroups, refreshMessages, session]);

  // ── Skill autocomplete ──────────────────────────────────────

  const filteredSkills = useMemo(() => {
    if (!skillPopupOpen || !skillFilter) return skillList.slice(0, 8);
    const q = skillFilter.toLowerCase();
    return skillList
      .filter((s) => s.name.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [skillPopupOpen, skillFilter, skillList]);

  const handleDraftChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setDraft(val);
      const cursor = e.target.selectionStart ?? val.length;
      const trigger = detectAtTrigger(val, cursor);
      if (trigger && skillList.length > 0) {
        setSkillPopupOpen(true);
        setSkillFilter(trigger.filter);
        setSkillSelectedIndex(0);
        setAtTriggerPos(trigger.atIndex);
      } else {
        setSkillPopupOpen(false);
      }
    },
    [skillList.length],
  );

  const selectSkill = useCallback(
    (skillName: string) => {
      if (atTriggerPos < 0) return;
      const before = draft.slice(0, atTriggerPos);
      const after = draft.slice(atTriggerPos + 1 + skillFilter.length);
      setDraft(before + "@" + skillName + " " + after);
      setSkillPopupOpen(false);
      setSkillFilter("");
      setAtTriggerPos(-1);
    },
    [draft, atTriggerPos, skillFilter],
  );

  const handleSkillKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!skillPopupOpen || filteredSkills.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSkillSelectedIndex((skillSelectedIndex + 1) % filteredSkills.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSkillSelectedIndex((skillSelectedIndex - 1 + filteredSkills.length) % filteredSkills.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectSkill(filteredSkills[skillSelectedIndex].name);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSkillPopupOpen(false);
      }
    },
    [skillPopupOpen, filteredSkills, skillSelectedIndex, selectSkill],
  );

  return {
    // Data refresh
    refreshAgents, refreshGroups, refreshMessages, refreshLlmHistory,
    // Workspace lifecycle
    bootstrap, createWorkspace,
    // Agent actions
    hireSubAgent, onInterruptAllAgents,
    // Messaging
    onSend, uploadFile,
    // Skill autocomplete
    filteredSkills, handleDraftChange, selectSkill, handleSkillKeyDown,
  };
}

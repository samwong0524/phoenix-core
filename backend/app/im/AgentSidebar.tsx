"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, ChevronDown } from "lucide-react";
import { useI18n } from "@/lib/i18n/context";
import { useAgentTreeLayout } from "./useAgentTreeLayout";
import { ErrorBoundary } from "../_components/error-boundary";
import { ROUTES } from "@/app/_components/routes";
import { cx } from "./helpers";
import { useIMStore } from "./store";
import type { Group, AgentMeta } from "./types";

// ── Types ──

export interface DirEntry {
  name: string;
  fullPath: string;
}

export interface AgentSidebarProps {
  session: import("./types").WorkspaceDefaults | null;
  groups: Group[];
  agents: AgentMeta[];
  activeGroupId: string | null;
  // UI state
  collapsedAgents: Record<string, boolean>;
  detailsCollapsed: Record<string, boolean>;
  // Directory browser state
  workingDir: string;
  showDirInput: boolean;
  dirBrowsePath: string;
  dirBrowseEntries: DirEntry[];
  dirBrowseParent: string | null;
  dirBrowseLoading: boolean;
  // Actions
  setActiveGroupId: (id: string | null) => void;
  setCollapsedAgents: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  setDetailsCollapsed: (fn: (prev: Record<string, boolean>) => Record<string, boolean>) => void;
  setShowDirInput: (v: boolean) => void;
  setDirBrowsePath: (v: string) => void;
  setDirBrowseLoading: (v: boolean) => void;
  setDirBrowseEntries: (v: DirEntry[]) => void;
  setDirBrowseParent: (v: string | null) => void;
  setWorkingDir: (v: string) => void;
  // Workspace & agent management
  onCreateWorkspace: () => void;
  onSwitchWorkspace: (id: string) => void;
  onDeleteWorkspace: () => void;
  onHireSubAgent: () => void;
  onDeleteAgent: (agentId: string) => void;
  workspaces: Array<{ id: string; name: string; createdAt: string }>;
}

// ── Component ──

export function AgentSidebar(props: AgentSidebarProps) {
  const { t } = useI18n();
  const {
    session, groups, agents, activeGroupId,
    collapsedAgents, detailsCollapsed,
    workingDir, showDirInput, dirBrowsePath, dirBrowseEntries, dirBrowseParent, dirBrowseLoading,
    setActiveGroupId, setCollapsedAgents, setDetailsCollapsed,
    setShowDirInput, setDirBrowsePath, setDirBrowseLoading, setDirBrowseEntries, setDirBrowseParent,
    setWorkingDir,
    onCreateWorkspace, onSwitchWorkspace, onDeleteWorkspace, onHireSubAgent, onDeleteAgent,
    workspaces,
  } = props;

  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);

  // Read store values directly to avoid excessive prop drilling
  const agentStatusById = useIMStore((s) => s.agentStatusById);
  const tokenLimit = useIMStore((s) => s.tokenLimit);

  // ── Derived state ──

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId) ?? null,
    [groups, activeGroupId]
  );

  const agentRoleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of agents) map.set(a.id, a.role);
    return map;
  }, [agents]);

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

  const { rows: agentTreeRows, groupByAgentId } = useAgentTreeLayout(
    agents, groups, collapsedAgents, session?.humanAgentId ?? null, !!session
  );

  const extraGroups = useMemo(() => {
    if (!session) return groups;
    const mappedIds = new Set(Array.from(groupByAgentId.values()).map((g) => g.id));
    return groups.filter((g) => !mappedIds.has(g.id));
  }, [groupByAgentId, groups, session]);

  // ── Directory browser helpers ──

  const fetchDirEntries = useCallback(async (browsePath: string) => {
    setDirBrowseLoading(true);
    try {
      const qs = browsePath ? `?path=${encodeURIComponent(browsePath)}` : "";
      const res = await fetch(`/api/browse-dir${qs}`);
      const data = await res.json();
      if (data.error) {
        console.warn("[browse-dir]", data.error);
        return;
      }
      setDirBrowsePath(data.path ?? "");
      setDirBrowseEntries(data.entries ?? []);
      setDirBrowseParent(data.parent ?? null);
    } catch (err) {
      console.warn("[browse-dir] fetch failed:", err);
    } finally {
      setDirBrowseLoading(false);
    }
  }, [setDirBrowseLoading, setDirBrowsePath, setDirBrowseEntries, setDirBrowseParent]);

  const openDirBrowser = useCallback(() => {
    setShowDirInput(true);
    fetchDirEntries(workingDir || "");
  }, [workingDir, fetchDirEntries, setShowDirInput]);

  const confirmDirSelection = useCallback(() => {
    if (dirBrowsePath) {
      localStorage.setItem("workingDir", dirBrowsePath);
      setWorkingDir(dirBrowsePath);
    }
    setShowDirInput(false);
  }, [dirBrowsePath, setWorkingDir, setShowDirInput]);

  // Initialize workingDir from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("workingDir");
      if (stored) setWorkingDir(stored);
    } catch { /* ignore */ }
  }, [setWorkingDir]);

  // ── Agent tree helpers ──

  const toggleAgentCollapsed = useCallback((agentId: string) => {
    setCollapsedAgents((prev) => ({ ...prev, [agentId]: !prev[agentId] }));
  }, [setCollapsedAgents]);

  const toggleDetailCollapsed = useCallback((groupId: string) => {
    setDetailsCollapsed((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  }, [setDetailsCollapsed]);

  const getGroupStatus = useCallback(
    (g: Group, agentId?: string): "online" | "busy" | "idle" | "error" => {
      const aid = agentId ?? g.memberIds.find((id) => id !== session?.humanAgentId);
      if (!aid) return "idle";
      const status = agentStatusById[aid];
      if (status === "BUSY" || status === "WAKING") return "busy";
      if (g.unreadCount > 0) return "online";
      return "idle";
    },
    [agentStatusById, session?.humanAgentId]
  );

  // ── Row renderer ──

  interface TreeInfo {
    depth: number;
    hasChildren: boolean;
    collapsed: boolean;
    agentId: string;
    guides: boolean[];
    isLast: boolean;
  }

  const renderGroupRow = (g: Group, tree?: TreeInfo) => {
    const depth = tree?.depth ?? 0;
    const isCollapsed = tree?.collapsed ?? false;
    const agentId = tree?.agentId;
    const status = getGroupStatus(g, agentId);
    const isActive = g.id === activeGroupId;

    if (depth === 0) {
      const isDetailCollapsed = detailsCollapsed[g.id] ?? true;
      return (
        <div key={g.id} className="agent-group">
          <div
            className={cx("agent-group-header", isActive && "active")}
            role="button"
            tabIndex={0}
            onClick={() => setActiveGroupId(g.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveGroupId(g.id); } }}
          >
            {tree?.hasChildren ? (
              <span
                className={cx("group-chevron", !isCollapsed && "open")}
                role="button"
                tabIndex={0}
                aria-label={isCollapsed ? t("im.agent_expand") : t("im.agent_collapse")}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleAgentCollapsed(tree.agentId);
                  toggleDetailCollapsed(g.id);
                }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleAgentCollapsed(tree.agentId); toggleDetailCollapsed(g.id); } }}
              >▶</span>
            ) : (
              <span
                className={cx("group-chevron", !isDetailCollapsed && "open")}
                role="button"
                tabIndex={0}
                aria-label={isDetailCollapsed ? t("im.agent_expand_details") : t("im.agent_collapse_details")}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleDetailCollapsed(g.id);
                }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); toggleDetailCollapsed(g.id); } }}
              >▶</span>
            )}
            <span className={cx("status-dot", status)} aria-label={status} />
            <span className="group-name">{getGroupLabel(g)}</span>
            {g.unreadCount > 0 && <span className="badge phoenix">{g.unreadCount}</span>}
            {agentId && agentId !== session?.humanAgentId && (
              <button
                onClick={(e) => { e.stopPropagation(); onDeleteAgent(agentId); }}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onDeleteAgent(agentId); } }}
                title={t("im.delete_agent")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", padding: 1, display: "flex", alignItems: "center", opacity: 0.6, marginLeft: "auto", flexShrink: 0 }}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
          {!isCollapsed && !isDetailCollapsed ? (
            <div className="group-detail">
              {g.lastMessage ? (
                <div style={{ marginBottom: g.contextTokens > 0 ? 4 : 0 }}>{g.lastMessage.content}</div>
              ) : null}
              {g.contextTokens > 0 ? (
                <div className="ctx-bar">
                  <span className="ctx-bar-label">{t("im.context_label")}</span>
                  <div className="ctx-bar-track">
                    <div className="ctx-bar-fill" style={{ width: `${Math.min(100, (g.contextTokens / tokenLimit) * 100)}%` }} />
                  </div>
                  <span className="ctx-bar-text">{g.contextTokens.toLocaleString()} / {tokenLimit.toLocaleString()}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }

    // depth > 0: sub-agent row
    const isDetailCollapsed = detailsCollapsed[g.id] ?? true;
    return (
      <div key={g.id}>
        <div
          className={cx("agent-sub", isActive && "active")}
          role="button"
          tabIndex={0}
          onClick={() => setActiveGroupId(g.id)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveGroupId(g.id); } }}
        >
          <span className={cx("status-dot", status)} aria-label={status} />
          <span className={cx("sub-name", isActive && "highlight")}>{getGroupLabel(g)}</span>
          {g.unreadCount > 0 && <span className="badge phoenix">{g.unreadCount}</span>}
        </div>
        {!isCollapsed && !isDetailCollapsed && tree?.hasChildren ? (
          <div className="group-detail" style={{ paddingLeft: 54, paddingTop: 0 }}>
            {g.lastMessage ? (
              <div style={{ marginBottom: g.contextTokens > 0 ? 4 : 0 }}>{g.lastMessage.content}</div>
            ) : null}
            {g.contextTokens > 0 ? (
              <div className="ctx-bar">
                <span className="ctx-bar-label">{t("im.context_label")}</span>
                <div className="ctx-bar-track">
                  <div className="ctx-bar-fill" style={{ width: `${Math.min(100, (g.contextTokens / tokenLimit) * 100)}%` }} />
                </div>
                <span className="ctx-bar-text">{g.contextTokens.toLocaleString()} / {tokenLimit.toLocaleString()}</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  // ── Render ──

  return (
    <ErrorBoundary name="IM.LeftPanel">
      <aside className="panel panel-left" style={{ overflow: "hidden" }}>
        <div className="logo-bar">
          <img className="logo-icon" src="data:image/png;base64,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" alt="PHOENIX CORE" />
          <div className="logo-text">PHOENIX CORE</div>
        </div>
        <div className="ws-info">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div className="ws-title">{t("im.workspace")}</div>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={onCreateWorkspace}
                title={t("im.new_workspace")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 2, display: "flex", alignItems: "center" }}
              >
                <Plus size={14} />
              </button>
              <button
                onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: 2, display: "flex", alignItems: "center" }}
              >
                <ChevronDown size={14} style={{ transform: wsDropdownOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
              </button>
              <button
                onClick={onDeleteWorkspace}
                title={t("workspace.delete_tooltip", { name: "" })}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--danger)", padding: 2, display: "flex", alignItems: "center" }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          {wsDropdownOpen && workspaces.length > 1 && (
            <div style={{ marginTop: 6, maxHeight: 120, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 4, background: "var(--bg-elevated)" }}>
              {workspaces.filter((w) => w.id !== session?.workspaceId).map((w) => (
                <div
                  key={w.id}
                  onClick={() => { onSwitchWorkspace(w.id); setWsDropdownOpen(false); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { onSwitchWorkspace(w.id); setWsDropdownOpen(false); } }}
                  role="button"
                  tabIndex={0}
                  style={{ padding: "6px 8px", cursor: "pointer", fontSize: 11, borderBottom: "1px solid var(--border)" }}
                >
                  <div style={{ fontWeight: 500 }}>{w.name}</div>
                  <div style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{w.id.slice(0, 12)}…</div>
                </div>
              ))}
            </div>
          )}
          <div className="ws-id" style={{ marginTop: 4 }}>{session?.workspaceId ?? "-"}</div>
          <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid var(--border)" }}>
            <div style={{ fontSize: 9, color: "var(--text-dim)", marginBottom: 4 }}>{t("im.dir_working_dir")}</div>
            {showDirInput ? (
              <div className="dir-browser">
                <div className="dir-browser-path">
                  {dirBrowseParent !== null && (
                    <button className="dir-browser-up" onClick={() => fetchDirEntries(dirBrowseParent)} title={t("im.dir_up")}>↑</button>
                  )}
                  <span className="dir-browser-path-text" title={dirBrowsePath}>{dirBrowsePath || t("im.dir_select_prompt")}</span>
                </div>
                <div className="dir-browser-list">
                  {dirBrowseLoading ? (
                    <div className="dir-browser-empty">{t("im.dir_loading")}</div>
                  ) : dirBrowseEntries.length === 0 ? (
                    <div className="dir-browser-empty">{t("im.dir_empty")}</div>
                  ) : (
                    dirBrowseEntries.map((entry) => (
                      <div
                        key={entry.fullPath}
                        className="dir-browser-item"
                        onDoubleClick={() => fetchDirEntries(entry.fullPath)}
                        onClick={() => { setDirBrowsePath(entry.fullPath); }}
                        style={{ background: dirBrowsePath === entry.fullPath ? "rgba(0,255,255,0.08)" : undefined }}
                      >
                        <span style={{ fontSize: 11, flexShrink: 0 }}>📁</span>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name}</span>
                      </div>
                    ))
                  )}
                </div>
                <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                  <button onClick={confirmDirSelection} className="dir-browser-btn dir-browser-btn-primary">{t("im.dir_select_this")}</button>
                  <button onClick={() => setShowDirInput(false)} className="dir-browser-btn">{t("common.cancel")}</button>
                </div>
              </div>
            ) : (
              <div onClick={openDirBrowser} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDirBrowser(); } }} role="button" tabIndex={0} style={{ fontSize: 10, color: "var(--text-secondary)", cursor: "pointer", wordBreak: "break-all", display: "flex", alignItems: "center", gap: 4 }} title={t("im.dir_click_to_add")}>
                <span style={{ fontSize: 11 }}>📁</span>
                <span>{workingDir || t("im.dir_not_set")}</span>
              </div>
            )}
            {workingDir && !showDirInput && (
              <div style={{ fontSize: 8, color: "var(--text-dim)", marginTop: 3, fontStyle: "italic" }}>{t("im.dir_refresh_hint")}</div>
            )}
          </div>
          <div style={{ marginTop: 4, fontSize: 9 }}>
            {t("im.human_label")} {(session?.humanAgentId ?? "-").slice(0, 22)}…
          </div>
          <div style={{ fontSize: 9 }}>
            {t("im.assistant_label")} {(session?.assistantAgentId ?? "-").slice(0, 22)}…
          </div>
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
            <a href={ROUTES.HOME} style={{ color: "var(--text-secondary)", textDecoration: "none", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
              {t("common.back_home")}
            </a>
          </div>
        </div>
        <div className="agent-scroll">
          <div className="section-label" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>{t("im.agents")}</span>
            <button
              onClick={onHireSubAgent}
              disabled={!session}
              title={t("im.hire_sub_agent")}
              style={{ background: "none", border: "none", cursor: session ? "pointer" : "not-allowed", color: "var(--cyan)", padding: 2, display: "flex", alignItems: "center", opacity: session ? 1 : 0.4 }}
            >
              <Plus size={14} />
            </button>
          </div>
          {agentTreeRows.length === 0 && extraGroups.length === 0 ? (
            <div style={{ padding: 16 }} className="muted">
              {t("im.no_groups")}
            </div>
          ) : (
            <>
              {(() => {
                const lastDepth0Idx = agentTreeRows.reduce((acc, row, idx) => {
                  if (row.depth === 0 && row.group) return idx;
                  return acc;
                }, -1);
                return agentTreeRows.map(({ agent, group, depth, hasChildren, collapsed, guides, isLast }, idx) => (
                  <Fragment key={idx}>
                    {group
                      ? renderGroupRow(group, {
                          depth,
                          hasChildren,
                          collapsed,
                          agentId: agent.id,
                          guides,
                          isLast,
                        })
                      : null}
                    {depth === 0 && group && idx < lastDepth0Idx ? <div className="sidebar-divider" /> : null}
                  </Fragment>
                ));
              })()}
              {extraGroups.map((g) => renderGroupRow(g))}
            </>
          )}
        </div>
      </aside>
    </ErrorBoundary>
  );
}

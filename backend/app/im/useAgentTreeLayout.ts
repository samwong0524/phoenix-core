"use client";

import { useMemo } from "react";
import type { AgentMeta, Group } from "./types";

type AgentRow = {
  agent: AgentMeta;
  group: Group | null;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  guides: boolean[];
  isLast: boolean;
};

/**
 * Build tree-structured rows for the agent sidebar.
 * Extracted from IMPageInner (lines 548-612 of original page.tsx).
 */
export function useAgentTreeLayout(
  agents: AgentMeta[],
  groups: Group[],
  collapsedAgents: Record<string, boolean>,
): AgentRow[] {
  return useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a]));
    const childrenById = new Map<string, AgentMeta[]>();
    const roots: AgentMeta[] = [];
    const byCreatedAt = (a: AgentMeta, b: AgentMeta) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

    // Build parent-child relationships
    for (const agent of agents) {
      const pid = agent.parentId;
      if (!pid || !byId.has(pid)) {
        roots.push(agent);
      } else {
        const list = childrenById.get(pid) ?? [];
        list.push(agent);
        childrenById.set(pid, list);
      }
    }
    // Sort siblings by creation time
    for (const [, kids] of childrenById) kids.sort(byCreatedAt);
    roots.sort(byCreatedAt);

    // Build group lookup
    const groupByAgentId = new Map<string, Group>();
    for (const g of groups) {
      const nonHumanMember = g.memberIds.find((mid) => mid !== g.creatorId);
      if (nonHumanMember) groupByAgentId.set(nonHumanMember, g);
    }

    const rows: Array<{
      agent: AgentMeta;
      group: Group | null;
      depth: number;
      hasChildren: boolean;
      collapsed: boolean;
      guides: boolean[];
      isLast: boolean;
    }> = [];

    const walk = (agent: AgentMeta, depth: number, guides: boolean[], isLast: boolean) => {
      const group = groupByAgentId.get(agent.id) ?? null;
      const kids = childrenById.get(agent.id) ?? [];
      const collapsed = collapsedAgents[agent.id] ?? false;
      rows.push({
        agent,
        group,
        depth,
        hasChildren: kids.length > 0,
        collapsed,
        guides,
        isLast,
      });
      if (!collapsed && kids.length > 0) {
        for (let i = 0; i < kids.length; i++) {
          const child = kids[i];
          const childGuides = [...guides, !isLast];
          walk(child, depth + 1, childGuides, i === kids.length - 1);
        }
      }
    };

    for (let i = 0; i < roots.length; i++) {
      walk(roots[i], 0, [], i === roots.length - 1);
    }

    return rows;
  }, [agents, groups, collapsedAgents]);
}
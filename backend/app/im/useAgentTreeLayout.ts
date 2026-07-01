"use client";

import { useMemo } from "react";
import type { AgentMeta, Group } from "./types";

export type AgentRow = {
  agent: AgentMeta;
  group: Group | null;
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  guides: boolean[];
  isLast: boolean;
};

export type AgentTreeResult = {
  rows: AgentRow[];
  groupByAgentId: Map<string, Group>;
};

/**
 * Build tree-structured rows for the agent sidebar.
 * Returns both rows and groupByAgentId (used by extraGroups in page.tsx).
 */
export function useAgentTreeLayout(
  agents: AgentMeta[],
  groups: Group[],
  collapsedAgents: Record<string, boolean>,
  humanAgentId: string | null,
  sessionExists: boolean,
  defaultGroupId?: string | null,
): AgentTreeResult {
  return useMemo(() => {
    const groupByAgentId = new Map<string, Group>();
    if (!sessionExists) return { rows: [], groupByAgentId };

    // Build group lookup — exclude humanAgentId from memberIds
    // First pass: 1:1 P2P groups (human + exactly 1 other)
    for (const g of groups) {
      if (humanAgentId && !g.memberIds.includes(humanAgentId)) continue;
      const others = g.memberIds.filter((id) => id !== humanAgentId);
      if (others.length === 1) groupByAgentId.set(others[0], g);
    }

    // Second pass: map assistant to default P2P group if not already mapped
    if (defaultGroupId) {
      const defaultGroup = groups.find((g) => g.id === defaultGroupId);
      if (defaultGroup) {
        const others = defaultGroup.memberIds.filter((id) => id !== humanAgentId);
        // Map the first non-human agent (assistant) to the default group if it has no 1:1 group
        for (const agentId of others) {
          if (!groupByAgentId.has(agentId)) {
            groupByAgentId.set(agentId, defaultGroup);
            break; // Only map one agent to the default group
          }
        }
      }
    }

    const byId = new Map(agents.map((a) => [a.id, a]));
    const childrenById = new Map<string, AgentMeta[]>();
    const roots: AgentMeta[] = [];
    const byCreatedAt = (a: AgentMeta, b: AgentMeta) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

    for (const agent of agents) {
      if (agent.role === "human") continue;
      const parentId = agent.parentId;
      const parent = parentId && parentId !== agent.id ? byId.get(parentId) : null;
      if (parent && parent.role !== "human" && parent.id !== agent.id) {
        const list = childrenById.get(parent.id) ?? [];
        list.push(agent);
        childrenById.set(parent.id, list);
      } else {
        roots.push(agent);
      }
    }

    for (const list of childrenById.values()) list.sort(byCreatedAt);
    roots.sort(byCreatedAt);

    const rows: AgentRow[] = [];
    const walk = (agent: AgentMeta, depth: number, guides: boolean[], isLast: boolean) => {
      const children = childrenById.get(agent.id) ?? [];
      const collapsed = !!collapsedAgents[agent.id];
      rows.push({
        agent,
        group: groupByAgentId.get(agent.id) ?? null,
        depth,
        hasChildren: children.length > 0,
        collapsed,
        guides,
        isLast,
      });
      if (collapsed) return;
      const nextGuides = [...guides, !isLast];
      children.forEach((child, index) => {
        walk(child, depth + 1, nextGuides, index === children.length - 1);
      });
    };
    roots.forEach((root, index) => walk(root, 0, [], index === roots.length - 1));

    return { rows, groupByAgentId };
  }, [agents, groups, collapsedAgents, humanAgentId, sessionExists, defaultGroupId]);
}

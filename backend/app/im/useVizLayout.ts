"use client";

import { useMemo } from "react";
import type { AgentMeta } from "./types";

type VizLayoutResult = {
  positions: Map<string, { x: number; y: number }>;
  ordered: AgentMeta[];
  edges: Array<{ fromId: string; toId: string }>;
};

/**
 * Compute tree layout positions for the visualization panel.
 * Extracted from IMPageInner (lines 339-492 of original page.tsx).
 */
export function useVizLayout(
  agents: AgentMeta[],
  vizSizeRounded: { width: number; height: number },
  nodeOffsets: Record<string, { x: number; y: number }>,
): VizLayoutResult {
  return useMemo(() => {
    const width = Math.max(1, vizSizeRounded.width);
    const height = Math.max(1, vizSizeRounded.height);
    const paddingX = 70;
    const paddingY = 60;
    const byId = new Map(agents.map((a) => [a.id, a]));
    const parentById = new Map<string, string | null>();
    const childrenById = new Map<string, AgentMeta[]>();
    const roots: AgentMeta[] = [];
    const byCreatedAt = (a: AgentMeta, b: AgentMeta) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

    for (const agent of agents) {
      const pid = agent.parentId ?? null;
      parentById.set(agent.id, pid);
      if (!pid || !byId.has(pid)) {
        roots.push(agent);
      } else {
        const list = childrenById.get(pid) ?? [];
        list.push(agent);
        childrenById.set(pid, list);
      }
    }
    for (const [, kids] of childrenById) kids.sort(byCreatedAt);
    roots.sort(byCreatedAt);

    const nodeMeta = new Map<string, { xIndex: number; depth: number }>();
    let leafIndex = 0;
    let maxDepth = 0;
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const walk = (agent: AgentMeta, depth: number): { min: number; max: number } => {
      if (visited.has(agent.id)) return nodeMeta.get(agent.id)! as any;
      if (visiting.has(agent.id)) return { min: leafIndex, max: leafIndex };
      visiting.add(agent.id);
      const kids = childrenById.get(agent.id) ?? [];
      if (kids.length === 0) {
        const myIndex = leafIndex++;
        nodeMeta.set(agent.id, { xIndex: myIndex, depth });
        visited.add(agent.id);
        visiting.delete(agent.id);
        maxDepth = Math.max(maxDepth, depth);
        return { min: myIndex, max: myIndex };
      }
      let childMin = Infinity;
      let childMax = -Infinity;
      for (const child of kids) {
        const r = walk(child, depth + 1);
        childMin = Math.min(childMin, r.min);
        childMax = Math.max(childMax, r.max);
      }
      const center = Math.round((childMin + childMax) / 2);
      nodeMeta.set(agent.id, { xIndex: center, depth });
      visited.add(agent.id);
      visiting.delete(agent.id);
      maxDepth = Math.max(maxDepth, depth);
      return { min: childMin, max: childMax };
    };

    for (const root of roots) walk(root, 0);

    const leafCount = Math.max(1, leafIndex);
    const depthCount = Math.max(1, maxDepth + 1);
    const baseSpan = Math.max(1, width - paddingX * 2);
    const maxSpan =
      leafCount === 1
        ? baseSpan
        : Math.min(baseSpan, leafCount * 130);
    const xSpan = Math.max(1, maxSpan);
    const xStart = (width - xSpan) / 2;
    const ySpan = Math.max(1, height - paddingY * 2);
    const xStep = leafCount === 1 ? 0 : xSpan / (leafCount - 1);
    const yStep = depthCount === 1 ? 0 : ySpan / (depthCount - 1);

    const basePositions = new Map<string, { x: number; y: number }>();
    for (const [id, meta] of nodeMeta) {
      basePositions.set(id, {
        x: xStart + meta.xIndex * xStep,
        y: paddingY + meta.depth * yStep,
      });
    }

    const offsetCache = new Map<string, { x: number; y: number }>();
    const positions = new Map<string, { x: number; y: number }>();
    const getAccumulatedOffset = (id: string) => {
      if (offsetCache.has(id)) return offsetCache.get(id)!;
      let ox = 0;
      let oy = 0;
      let current: string | null = id;
      while (current) {
        const o = nodeOffsets[current];
        if (o) { ox += o.x; oy += o.y; }
        current = parentById.get(current!) ?? null;
      }
      const result = { x: ox, y: oy };
      offsetCache.set(id, result);
      return result;
    };

    for (const agent of agents) {
      const base = basePositions.get(agent.id);
      if (!base) continue;
      const off = getAccumulatedOffset(agent.id);
      positions.set(agent.id, { x: base.x + off.x, y: base.y + off.y });
    }

    const ordered = [...agents].sort((a, b) => {
      const pa = basePositions.get(a.id);
      const pb = basePositions.get(b.id);
      if (!pa || !pb) return 0;
      return pa.x - pb.x || pa.y - pb.y;
    });

    const edges: Array<{ fromId: string; toId: string }> = [];
    for (const agent of agents) {
      const pid = parentById.get(agent.id);
      if (pid) edges.push({ fromId: pid, toId: agent.id });
    }

    return { positions, ordered, edges };
  }, [agents, vizSizeRounded, nodeOffsets]);
}
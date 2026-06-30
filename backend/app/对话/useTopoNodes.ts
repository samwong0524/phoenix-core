import type { AgentMeta } from "./types";
import { useMemo } from "react";

type TopoNode = { id: string; x: number; y: number; color: string; r: number; status: string };

export function useTopoNodes(
  vizLayout: { positions: Map<string, { x: number; y: number }>; ordered: AgentMeta[] },
  agentStatusById: Record<string, string>,
): TopoNode[] {
  return useMemo(() => {
    const nodeColor = (role?: string) => {
      if (!role) return "#71717a";
      if (role === "human") return "#e4e4e7";
      if (role === "assistant") return "#06b6d4";
      if (role === "coordinator" || role === "productmanager" || role === "pm" || role === "manager" || role === "cto") return "#c026d3";
      if (role === "reviewer" || role === "qa") return "#8b5cf6";
      if (role === "researcher" || role === "analyst") return "#22c55e";
      if (role === "specialist" || role === "coder" || role === "developer" || role === "engineer") return "#22c55e";
      if (role === "creator" || role === "writer") return "#eab308";
      if (role === "editor") return "#eab308";
      if (role === "worker") return "#52525b";
      return "#eab308";
    };

    return vizLayout.ordered.map((agent) => {
      const pos = vizLayout.positions.get(agent.id);
      if (!pos) return null;
      const status = agentStatusById[agent.id] ?? "IDLE";
      return {
        id: agent.id,
        x: pos.x,
        y: pos.y,
        color: nodeColor(agent.role),
        r: 45,
        status,
      };
    }).filter(Boolean) as TopoNode[];
  }, [vizLayout, agentStatusById]);
}
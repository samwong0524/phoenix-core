import { useMemo } from "react";
import type { AgentMeta } from "./types";
import { roleColor } from "./colors";

export type TopoNode = {
  id: string;
  x: number;
  y: number;
  color: string;
  r: number;
  status: string;
};

export function useTopoNodes(
  vizLayout: { positions: Map<string, { x: number; y: number }>; ordered: AgentMeta[] },
  agentStatusById: Record<string, string>,
  agents: AgentMeta[],
): TopoNode[] {
  return useMemo(() => {
    return vizLayout.ordered.map((a) => {
      const pos = vizLayout.positions.get(a.id);
      const status = agentStatusById[a.id] ?? "IDLE";
      return {
        id: a.id,
        x: pos?.x ?? 0,
        y: pos?.y ?? 0,
        color: roleColor(a.role),
        r: 30,
        status,
      };
    });
  }, [vizLayout.ordered, vizLayout.positions, agentStatusById, agents]);
}

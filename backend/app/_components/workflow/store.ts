"use client";

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  WorkflowNode,
  WorkflowEdge,
  WorkflowDSL,
  AgentNodeData,
  ExecutionStatus,
} from "@/lib/workflow-types";

export interface WorkflowState {
  // Canvas state
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNodeId: string | null;

  // Workflow metadata
  workflowId: string | null;
  workflowName: string;
  workflowDescription: string;
  workflowStatus: "draft" | "active" | "paused";

  // Available roles from workspace agents
  availableRoles: string[];

  // Actions
  setNodes: (nodes: WorkflowNode[]) => void;
  setEdges: (edges: WorkflowEdge[]) => void;
  setSelectedNodeId: (id: string | null) => void;
  addAgentNode: (position: { x: number; y: number }, role?: string) => void;
  removeNode: (id: string) => void;
  updateAgentData: (id: string, data: Partial<AgentNodeData>) => void;
  setExecutionStatus: (nodeId: string, status: ExecutionStatus) => void;
  resetExecutionStatus: () => void;
  setAvailableRoles: (roles: string[]) => void;

  // Workflow metadata
  setWorkflowMeta: (meta: {
    id?: string;
    name?: string;
    description?: string;
    status?: "draft" | "active" | "paused";
  }) => void;

  // Serialization
  loadFromDSL: (dsl: WorkflowDSL) => void;
  toDSL: () => WorkflowDSL;
}

let nodeCounter = 0;
function nextNodeId() {
  return `agent-${++nodeCounter}`;
}

export const useWorkflowStore = create<WorkflowState>()(
  immer((set, get) => ({
    nodes: [],
    edges: [],
    selectedNodeId: null,
    workflowId: null,
    workflowName: "New Workflow",
    workflowDescription: "",
    workflowStatus: "draft",
    availableRoles: [],

    setNodes: (nodes) =>
      set((state) => {
        state.nodes = nodes;
      }),

    setEdges: (edges) =>
      set((state) => {
        state.edges = edges;
      }),

    setSelectedNodeId: (id) =>
      set((state) => {
        state.selectedNodeId = id;
      }),

    addAgentNode: (position, role = "assistant") => {
      const id = nextNodeId();
      set((state) => {
        state.nodes.push({
          id,
          type: "agent",
          position,
          data: {
            label: `${role} ${state.nodes.filter((n) => n.type === "agent").length + 1}`,
            role,
            description: "",
            expectedOutput: "",
            executionStatus: "idle",
          },
        } as WorkflowNode);
      });
    },

    removeNode: (id) =>
      set((state) => {
        const node = state.nodes.find((n) => n.id === id);
        if (node && (node.type === "start" || node.type === "end")) return;
        state.nodes = state.nodes.filter((n) => n.id !== id);
        state.edges = state.edges.filter(
          (e) => e.source !== id && e.target !== id
        );
        if (state.selectedNodeId === id) state.selectedNodeId = null;
      }),

    updateAgentData: (id, data) =>
      set((state) => {
        const node = state.nodes.find(
          (n) => n.id === id && n.type === "agent"
        );
        if (node) {
          Object.assign(node.data, data);
        }
      }),

    setExecutionStatus: (nodeId, status) =>
      set((state) => {
        const node = state.nodes.find(
          (n) => n.id === nodeId && n.type === "agent"
        );
        if (node && "executionStatus" in node.data) {
          (node.data as AgentNodeData).executionStatus = status;
        }
      }),

    resetExecutionStatus: () =>
      set((state) => {
        for (const node of state.nodes) {
          if (node.type === "agent" && "executionStatus" in node.data) {
            (node.data as AgentNodeData).executionStatus = "idle";
          }
        }
      }),

    setAvailableRoles: (roles) =>
      set((state) => {
        state.availableRoles = roles;
      }),

    setWorkflowMeta: (meta) =>
      set((state) => {
        if (meta.id !== undefined) state.workflowId = meta.id;
        if (meta.name !== undefined) state.workflowName = meta.name;
        if (meta.description !== undefined)
          state.workflowDescription = meta.description;
        if (meta.status !== undefined) state.workflowStatus = meta.status;
      }),

    loadFromDSL: (dsl) =>
      set((state) => {
        state.nodes = dsl.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          data: { ...n.data } as any,
        })) as WorkflowNode[];
        state.edges = dsl.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          ...(e.label ? { label: e.label } : {}),
        })) as WorkflowEdge[];
        // Reset counter to avoid ID collisions
        const maxNum = dsl.nodes
          .filter((n) => n.id.startsWith("agent-"))
          .reduce((max, n) => {
            const num = parseInt(n.id.split("-")[1] || "0", 10);
            return num > max ? num : max;
          }, 0);
        nodeCounter = maxNum;
      }),

    toDSL: (): WorkflowDSL => {
      const { nodes, edges } = get();
      return {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: n.type as "start" | "agent" | "end",
          position: { ...n.position },
          data: { ...n.data } as any,
        })),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          ...(e.label ? { label: String(e.label) } : {}),
        })),
      };
    },
  }))
);

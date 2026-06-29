/**
 * Workflow visual editor types.
 * Maps visual nodes/edges to the workflows + tasks database tables.
 */

import type { Node, Edge } from "@xyflow/react";

// ── Node data types ───────────────────────────────────────────────

export type ExecutionStatus = "idle" | "running" | "completed" | "failed";

export interface StartNodeData {
  label: string;
  [key: string]: unknown;
}

export interface EndNodeData {
  label: string;
  [key: string]: unknown;
}

export interface AgentNodeData {
  label: string;
  role: string;
  description?: string;
  expectedOutput?: string;
  executionStatus?: ExecutionStatus;
  [key: string]: unknown;
}

// ── Node / Edge union types ───────────────────────────────────────

export type WorkflowNode =
  | Node<StartNodeData, "start">
  | Node<AgentNodeData, "agent">
  | Node<EndNodeData, "end">;

export type WorkflowEdge = Edge;

// ── Serialization DSL ─────────────────────────────────────────────

export interface WorkflowDSL {
  nodes: Array<{
    id: string;
    type: "start" | "agent" | "end";
    position: { x: number; y: number };
    data: StartNodeData | AgentNodeData | EndNodeData;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    label?: string;
  }>;
}

// ── API types ─────────────────────────────────────────────────────

export interface WorkflowRecord {
  id: string;
  groupId: string;
  name: string;
  description: string | null;
  status: "draft" | "active" | "paused";
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  workflowId: string;
  name: string;
  description: string | null;
  assigneeRole: string | null;
  assigneeId: string | null;
  status: string;
  dependsOn: string[];
  expectedOutput: string | null;
}

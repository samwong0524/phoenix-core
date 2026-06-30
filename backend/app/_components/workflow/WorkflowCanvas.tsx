"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import StartNode from "./nodes/StartNode";
import EndNode from "./nodes/EndNode";
import AgentNode from "./nodes/AgentNode";
import ConditionNode from "./nodes/ConditionNode";
import NodePalette from "./NodePalette";
import PropertiesPanel from "./PropertiesPanel";
import { useWorkflowStore } from "./store";
import type { WorkflowNode, WorkflowEdge } from "@/lib/workflow-types";

// Register custom node types OUTSIDE the component
const nodeTypes = {
  start: StartNode,
  agent: AgentNode,
  condition: ConditionNode,
  end: EndNode,
};

// Connection validation: supports DAG with condition branching
function isValidConnection(conn: Connection | WorkflowEdge) {
  const store = useWorkflowStore.getState();
  const sourceNode = store.nodes.find((n) => n.id === conn.source);
  const targetNode = store.nodes.find((n) => n.id === conn.target);
  if (!sourceNode || !targetNode) return false;

  // End cannot have outgoing connections
  if (sourceNode.type === "end") return false;
  // Start cannot have incoming, and can connect to agent or condition
  if (targetNode.type === "start") return false;
  // Start can connect to agent or condition
  if (sourceNode.type === "start" && targetNode.type !== "agent" && targetNode.type !== "condition") return false;
  // No self-loops
  if (conn.source === conn.target) return false;

  // Condition nodes: max 2 outgoing edges (true/false)
  if (sourceNode.type === "condition") {
    const existingOutgoing = store.edges.filter((e) => e.source === conn.source);
    if (existingOutgoing.length >= 2) return false;
  }

  return true;
}

function WorkflowCanvasInner() {
  const { screenToFlowPosition } = useReactFlow();
  const store = useWorkflowStore();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Sync store ↔ React Flow local state
  const [nodes, setNodes, onNodesChange] = useNodesState(store.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(store.edges);

  // Sync store → RF on external changes (loadFromDSL, addAgentNode, etc.)
  useEffect(() => {
    setNodes(store.nodes);
  }, [store.nodes, setNodes]);

  useEffect(() => {
    setEdges(store.edges);
  }, [store.edges, setEdges]);

  // Sync RF → store on user interactions
  const handleNodesChange = useCallback(
    (changes: NodeChange<WorkflowNode>[]) => {
      onNodesChange(changes);
      // Sync selection
      const selectChange = changes.find((c) => c.type === "select");
      if (selectChange) {
        const selected = store.nodes.find(
          (n) => n.id === selectChange.id
        );
        if (selected && selectChange.selected) {
          store.setSelectedNodeId(selected.id);
        }
      }
      // Sync removals
      const removeChanges = changes.filter((c) => c.type === "remove");
      if (removeChanges.length > 0) {
        // Let store handle removal (it also cleans up edges)
        for (const c of removeChanges) {
          if ("id" in c) store.removeNode(c.id as string);
        }
      }
      // Sync position changes
      const positionChanges = changes.filter(
        (c) => c.type === "position" && c.dragging === false
      );
      if (positionChanges.length > 0) {
        const updatedNodes = store.nodes.map((n) => {
          const change = positionChanges.find(
            (c) => "id" in c && c.id === n.id
          );
          if (change && "position" in change && change.position) {
            return { ...n, position: change.position };
          }
          return n;
        });
        store.setNodes(updatedNodes);
      }
    },
    [onNodesChange, store]
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<WorkflowEdge>[]) => {
      onEdgesChange(changes);
      // Sync to store
      const removeChanges = changes.filter((c) => c.type === "remove");
      if (removeChanges.length > 0) {
        // Rebuild edges in store from current RF state
        setTimeout(() => {
          const currentEdges = useWorkflowStore.getState().edges;
          const remainingIds = new Set(
            removeChanges.map((c) => ("id" in c ? c.id : ""))
          );
          store.setEdges(currentEdges.filter((e) => !remainingIds.has(e.id)));
        }, 0);
      }
    },
    [onEdgesChange, store]
  );

  const onConnect = useCallback(
    (params: Connection) => {
      if (!isValidConnection(params)) return;

      // Auto-assign branch labels for condition node edges
      const sourceNode = useWorkflowStore.getState().nodes.find((n) => n.id === params.source);
      let branchLabel: string | undefined;
      if (sourceNode?.type === "condition") {
        const existingCount = useWorkflowStore.getState().edges.filter((e) => e.source === params.source).length;
        branchLabel = existingCount === 0 ? "true" : "false";
      }

      const newEdge = {
        id: `e-${params.source}${params.sourceHandle ? `-${params.sourceHandle}` : ""}-${params.target}`,
        source: params.source!,
        target: params.target!,
        ...(branchLabel ? { data: { branchLabel } } : {}),
      };
      setEdges((eds) => addEdge({ ...params, ...newEdge }, eds));
      // Sync to store
      store.setEdges([...store.edges, newEdge] as WorkflowEdge[]);
    },
    [setEdges, store]
  );

  // Drag-and-drop from palette
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const nodeType = e.dataTransfer.getData("application/workflow-node-type");
      const role = e.dataTransfer.getData("application/workflow-role");

      const position = screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });

      if (nodeType === "condition") {
        store.addConditionNode(position);
      } else if (role) {
        store.addAgentNode(position, role);
      }
    },
    [screenToFlowPosition, store]
  );

  // Click on canvas background → deselect
  const onPaneClick = useCallback(() => {
    store.setSelectedNodeId(null);
  }, [store]);

  // Delete key handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Delete" || e.key === "Backspace") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
        const selectedId = useWorkflowStore.getState().selectedNodeId;
        if (selectedId) {
          store.removeNode(selectedId);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [store]);

  // Default nodes: Start + End
  const defaultNodes = useMemo(
    () =>
      store.nodes.length === 0
        ? ([
            {
              id: "start",
              type: "start",
              position: { x: 80, y: 200 },
              data: { label: "Start" },
            },
            {
              id: "end",
              type: "end",
              position: { x: 700, y: 200 },
              data: { label: "End" },
            },
          ] as WorkflowNode[])
        : null,
    [] // Only compute once
  );

  useEffect(() => {
    if (defaultNodes && store.nodes.length === 0) {
      store.setNodes(defaultNodes);
    }
  }, [defaultNodes, store]);

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%" }}>
      {/* Left: Node Palette */}
      <NodePalette />

      {/* Center: Canvas */}
      <div ref={reactFlowWrapper} style={{ flex: 1, position: "relative" }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onPaneClick={onPaneClick}
          nodeTypes={nodeTypes}
          isValidConnection={isValidConnection}
          snapToGrid
          snapGrid={[16, 16]}
          fitView
          minZoom={0.3}
          maxZoom={2}
          defaultEdgeOptions={{
            type: "smoothstep",
            style: { stroke: "var(--cyan-dim, rgba(0,240,255,0.4))", strokeWidth: 2 },
          }}
          style={{ background: "var(--bg-void, #060a14)" }}
        >
          <Controls
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          />
          <MiniMap
            nodeColor={(n) => {
              if (n.type === "start") return "#4ade80";
              if (n.type === "end") return "#ef4444";
              return "#00f0ff";
            }}
            maskColor="rgba(0, 0, 0, 0.6)"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          />
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="var(--border-hairline, rgba(255,255,255,0.04))"
          />
        </ReactFlow>
      </div>

      {/* Right: Properties Panel */}
      <PropertiesPanel />
    </div>
  );
}

// Wrap in ReactFlowProvider (required for useReactFlow)
export default function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner />
    </ReactFlowProvider>
  );
}

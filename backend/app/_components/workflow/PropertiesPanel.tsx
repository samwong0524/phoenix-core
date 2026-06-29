"use client";

import { useWorkflowStore } from "./store";
import type { AgentNodeData, ConditionNodeData } from "@/lib/workflow-types";

export default function PropertiesPanel() {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const nodes = useWorkflowStore((s) => s.nodes);
  const availableRoles = useWorkflowStore((s) => s.availableRoles);
  const workflowName = useWorkflowStore((s) => s.workflowName);
  const workflowDescription = useWorkflowStore((s) => s.workflowDescription);
  const workflowStatus = useWorkflowStore((s) => s.workflowStatus);
  const updateAgentData = useWorkflowStore((s) => s.updateAgentData);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const setWorkflowMeta = useWorkflowStore((s) => s.setWorkflowMeta);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const isAgentSelected = selectedNode?.type === "agent";
  const isConditionSelected = selectedNode?.type === "condition";
  const agentData = isAgentSelected ? (selectedNode.data as AgentNodeData) : null;
  const condData = isConditionSelected ? (selectedNode.data as ConditionNodeData) : null;

  return (
    <div
      style={{
        width: 280,
        borderLeft: "1px solid var(--border)",
        background: "var(--bg-panel)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          fontWeight: 700,
          color: "var(--cyan)",
          fontFamily: "var(--font-display)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        {isAgentSelected ? "Agent Properties" : isConditionSelected ? "Condition" : "Workflow"}
      </div>

      <div style={{ padding: 14, overflowY: "auto", flex: 1 }}>
        {isAgentSelected && agentData ? (
          /* ── Agent node selected ─────────────────────────── */
          <AgentProperties
            nodeId={selectedNodeId!}
            data={agentData}
            availableRoles={availableRoles}
            updateAgentData={updateAgentData}
          />
        ) : isConditionSelected && condData ? (
          /* ── Condition node selected ─────────────────────── */
          <ConditionProperties
            nodeId={selectedNodeId!}
            data={condData}
            updateNodeData={updateNodeData}
          />
        ) : (
          /* ── No node selected — show workflow meta ──────── */
          <WorkflowMeta
            name={workflowName}
            description={workflowDescription}
            status={workflowStatus}
            setWorkflowMeta={setWorkflowMeta}
          />
        )}
      </div>
    </div>
  );
}

// ── Shared styles ──────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  fontWeight: 700,
  color: "var(--text-dim)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  fontSize: 12,
  fontFamily: "var(--font-body)",
  color: "var(--text-primary)",
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  outline: "none",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

// ── Status color helper ────────────────────────────────────────

function statusColor(status?: string): string {
  switch (status) {
    case "running": return "var(--cyan)";
    case "completed": return "var(--green)";
    case "failed": return "var(--red)";
    default: return "var(--text-dim)";
  }
}

// ── Sub-components ─────────────────────────────────────────────

function AgentProperties({
  nodeId,
  data,
  availableRoles,
  updateAgentData,
}: {
  nodeId: string;
  data: AgentNodeData;
  availableRoles: string[];
  updateAgentData: (id: string, d: Partial<AgentNodeData>) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={labelStyle}>Role</label>
        <select
          value={data.role}
          onChange={(e) => updateAgentData(nodeId, { role: e.target.value })}
          style={selectStyle}
        >
          {(availableRoles.length > 0
            ? availableRoles
            : ["assistant", "coordinator", "researcher", "creator", "reviewer", "specialist"]
          ).map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Name</label>
        <input
          value={data.label}
          onChange={(e) => updateAgentData(nodeId, { label: e.target.value })}
          style={inputStyle}
        />
      </div>
      <div>
        <label style={labelStyle}>Task Description</label>
        <textarea
          value={data.description || ""}
          onChange={(e) => updateAgentData(nodeId, { description: e.target.value })}
          placeholder="What should this agent do?"
          rows={3}
          style={{ ...inputStyle, resize: "vertical" as const }}
        />
      </div>
      <div>
        <label style={labelStyle}>Expected Output</label>
        <textarea
          value={data.expectedOutput || ""}
          onChange={(e) => updateAgentData(nodeId, { expectedOutput: e.target.value })}
          placeholder="What should the agent produce?"
          rows={2}
          style={{ ...inputStyle, resize: "vertical" as const }}
        />
      </div>
      <div>
        <label style={labelStyle}>Status</label>
        <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: statusColor(data.executionStatus) }}>
          {data.executionStatus?.toUpperCase() || "IDLE"}
        </div>
      </div>
    </div>
  );
}

function ConditionProperties({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: ConditionNodeData;
  updateNodeData: (id: string, d: Record<string, unknown>) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={labelStyle}>Name</label>
        <input
          value={data.label}
          onChange={(e) => updateNodeData(nodeId, { label: e.target.value })}
          style={inputStyle}
        />
      </div>
      <div>
        <label style={labelStyle}>Condition</label>
        <textarea
          value={data.condition}
          onChange={(e) => updateNodeData(nodeId, { condition: e.target.value })}
          placeholder="e.g. result.contains('approved') or upstream.score > 0.8"
          rows={4}
          style={{ ...inputStyle, resize: "vertical" as const, fontFamily: "var(--font-mono)", fontSize: 11 }}
        />
      </div>
      <div>
        <label style={labelStyle}>Input Variable (optional)</label>
        <input
          value={data.inputVariable || ""}
          onChange={(e) => updateNodeData(nodeId, { inputVariable: e.target.value })}
          placeholder="e.g. upstream.researcher.output"
          style={inputStyle}
        />
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 4, lineHeight: 1.5 }}>
          Reference an upstream agent&apos;s output to evaluate the condition against.
        </div>
      </div>
      <div>
        <label style={labelStyle}>Branches</label>
        <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.6 }}>
          <span style={{ color: "var(--green)", fontWeight: 600 }}>Right</span> = true branch
          <br />
          <span style={{ color: "var(--red)", fontWeight: 600 }}>Bottom</span> = false branch
        </div>
      </div>
      <div>
        <label style={labelStyle}>Status</label>
        <div style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: statusColor(data.executionStatus) }}>
          {data.executionStatus?.toUpperCase() || "IDLE"}
        </div>
      </div>
    </div>
  );
}

function WorkflowMeta({
  name,
  description,
  status,
  setWorkflowMeta,
}: {
  name: string;
  description: string;
  status: string;
  setWorkflowMeta: (meta: { name?: string; description?: string; status?: "draft" | "active" | "paused" }) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <label style={labelStyle}>Workflow Name</label>
        <input
          value={name}
          onChange={(e) => setWorkflowMeta({ name: e.target.value })}
          style={inputStyle}
        />
      </div>
      <div>
        <label style={labelStyle}>Description</label>
        <textarea
          value={description}
          onChange={(e) => setWorkflowMeta({ description: e.target.value })}
          placeholder="What does this workflow do?"
          rows={3}
          style={{ ...inputStyle, resize: "vertical" as const }}
        />
      </div>
      <div>
        <label style={labelStyle}>Status</label>
        <div
          style={{
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            color:
              status === "active"
                ? "var(--green)"
                : status === "paused"
                  ? "var(--yellow)"
                  : "var(--text-dim)",
          }}
        >
          {status.toUpperCase()}
        </div>
      </div>
      <div
        style={{
          marginTop: 8,
          padding: 12,
          background: "var(--bg-card)",
          borderRadius: 8,
          border: "1px solid var(--border)",
        }}
      >
        <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.6 }}>
          Drag agent or condition nodes from the left panel onto the canvas.
          Connect them by dragging between handles.
          Condition nodes branch into true (right) and false (bottom) paths.
        </div>
      </div>
    </div>
  );
}

"use client";

import { useWorkflowStore } from "./store";
import type { AgentNodeData } from "@/lib/workflow-types";

export default function PropertiesPanel() {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const nodes = useWorkflowStore((s) => s.nodes);
  const availableRoles = useWorkflowStore((s) => s.availableRoles);
  const workflowName = useWorkflowStore((s) => s.workflowName);
  const workflowDescription = useWorkflowStore((s) => s.workflowDescription);
  const workflowStatus = useWorkflowStore((s) => s.workflowStatus);
  const updateAgentData = useWorkflowStore((s) => s.updateAgentData);
  const setWorkflowMeta = useWorkflowStore((s) => s.setWorkflowMeta);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const isAgentSelected = selectedNode?.type === "agent";
  const agentData = isAgentSelected ? (selectedNode.data as AgentNodeData) : null;

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
        {isAgentSelected ? "Agent Properties" : "Workflow"}
      </div>

      <div style={{ padding: 14, overflowY: "auto", flex: 1 }}>
        {isAgentSelected && agentData ? (
          /* ── Agent node selected ─────────────────────────── */
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Role select */}
            <div>
              <label style={labelStyle}>Role</label>
              <select
                value={agentData.role}
                onChange={(e) =>
                  updateAgentData(selectedNodeId!, { role: e.target.value })
                }
                style={selectStyle}
              >
                {(availableRoles.length > 0
                  ? availableRoles
                  : ["assistant", "coordinator", "researcher", "creator", "reviewer", "specialist"]
                ).map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            {/* Label */}
            <div>
              <label style={labelStyle}>Name</label>
              <input
                value={agentData.label}
                onChange={(e) =>
                  updateAgentData(selectedNodeId!, { label: e.target.value })
                }
                style={inputStyle}
              />
            </div>

            {/* Description */}
            <div>
              <label style={labelStyle}>Task Description</label>
              <textarea
                value={agentData.description || ""}
                onChange={(e) =>
                  updateAgentData(selectedNodeId!, {
                    description: e.target.value,
                  })
                }
                placeholder="What should this agent do?"
                rows={3}
                style={{ ...inputStyle, resize: "vertical" as const }}
              />
            </div>

            {/* Expected output */}
            <div>
              <label style={labelStyle}>Expected Output</label>
              <textarea
                value={agentData.expectedOutput || ""}
                onChange={(e) =>
                  updateAgentData(selectedNodeId!, {
                    expectedOutput: e.target.value,
                  })
                }
                placeholder="What should the agent produce?"
                rows={2}
                style={{ ...inputStyle, resize: "vertical" as const }}
              />
            </div>

            {/* Status indicator */}
            <div>
              <label style={labelStyle}>Status</label>
              <div
                style={{
                  fontSize: 12,
                  fontFamily: "var(--font-mono)",
                  color:
                    agentData.executionStatus === "running"
                      ? "var(--cyan)"
                      : agentData.executionStatus === "completed"
                        ? "var(--green)"
                        : agentData.executionStatus === "failed"
                          ? "var(--red)"
                          : "var(--text-dim)",
                }}
              >
                {agentData.executionStatus?.toUpperCase() || "IDLE"}
              </div>
            </div>
          </div>
        ) : (
          /* ── No agent selected — show workflow meta ──────── */
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <label style={labelStyle}>Workflow Name</label>
              <input
                value={workflowName}
                onChange={(e) => setWorkflowMeta({ name: e.target.value })}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Description</label>
              <textarea
                value={workflowDescription}
                onChange={(e) =>
                  setWorkflowMeta({ description: e.target.value })
                }
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
                    workflowStatus === "active"
                      ? "var(--green)"
                      : workflowStatus === "paused"
                        ? "var(--yellow)"
                        : "var(--text-dim)",
                }}
              >
                {workflowStatus.toUpperCase()}
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
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-dim)",
                  lineHeight: 1.6,
                }}
              >
                Drag agent nodes from the left panel onto the canvas.
                Connect them by dragging from one node&apos;s right handle to the next node&apos;s left handle.
              </div>
            </div>
          </div>
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

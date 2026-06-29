"use client";

import { useWorkflowStore } from "./store";

export default function NodePalette() {
  const availableRoles = useWorkflowStore((s) => s.availableRoles);

  function onDragStartAgent(e: React.DragEvent, role: string) {
    e.dataTransfer.setData("application/workflow-role", role);
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragStartCondition(e: React.DragEvent) {
    e.dataTransfer.setData("application/workflow-node-type", "condition");
    e.dataTransfer.effectAllowed = "move";
  }

  return (
    <div
      style={{
        width: 200,
        borderRight: "1px solid var(--border)",
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
        Nodes
      </div>

      <div style={{ padding: "12px 14px", overflowY: "auto", flex: 1 }}>
        {/* Control Flow section */}
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-dim)",
            marginBottom: 8,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Control Flow
        </div>
        <div
          draggable
          onDragStart={onDragStartCondition}
          style={{
            padding: "8px 12px",
            background: "var(--bg-card)",
            border: "1px solid #a855f730",
            borderRadius: 8,
            cursor: "grab",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "var(--font-mono)",
            color: "#a855f7",
            marginBottom: 16,
            transition: "border-color 0.15s, box-shadow 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.target as HTMLElement).style.borderColor = "#a855f7";
            (e.target as HTMLElement).style.boxShadow = "0 0 8px rgba(168,85,247,0.15)";
          }}
          onMouseLeave={(e) => {
            (e.target as HTMLElement).style.borderColor = "#a855f730";
            (e.target as HTMLElement).style.boxShadow = "none";
          }}
        >
          ◇ Condition
        </div>

        {/* Agent Nodes section */}
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-dim)",
            marginBottom: 8,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Agent Nodes
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--text-dim)",
            marginBottom: 12,
            lineHeight: 1.5,
          }}
        >
          Drag a role onto the canvas.
        </div>

        {/* Role list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(availableRoles.length > 0 ? availableRoles : ["assistant", "coordinator", "researcher", "creator", "reviewer", "specialist"]).map(
            (role) => (
              <div
                key={role}
                draggable
                onDragStart={(e) => onDragStartAgent(e, role)}
                style={{
                  padding: "8px 12px",
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  cursor: "grab",
                  fontSize: 12,
                  fontWeight: 600,
                  fontFamily: "var(--font-mono)",
                  color: "var(--cyan)",
                  transition: "border-color 0.15s, box-shadow 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLElement).style.borderColor = "var(--cyan-dim)";
                  (e.target as HTMLElement).style.boxShadow = "0 0 8px rgba(0,240,255,0.15)";
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLElement).style.borderColor = "var(--border)";
                  (e.target as HTMLElement).style.boxShadow = "none";
                }}
              >
                + {role}
              </div>
            )
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)" }}>
        <div style={{ fontSize: 10, color: "var(--text-dim)", lineHeight: 1.6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--green)", display: "inline-block" }} />
            Start
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 4, background: "var(--bg-card)", border: "1px solid var(--border)", display: "inline-block" }} />
            Agent Step
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ width: 10, height: 10, transform: "rotate(45deg)", background: "var(--bg-card)", border: "1px solid #a855f7", display: "inline-block" }} />
            Condition
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--red)", display: "inline-block" }} />
            End
          </div>
        </div>
      </div>
    </div>
  );
}

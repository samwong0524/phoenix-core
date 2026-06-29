"use client";

import { useWorkflowStore } from "./store";

export default function NodePalette() {
  const availableRoles = useWorkflowStore((s) => s.availableRoles);

  function onDragStart(e: React.DragEvent, role: string) {
    e.dataTransfer.setData("application/workflow-role", role);
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

      {/* Draggable agent node template */}
      <div style={{ padding: "12px 14px" }}>
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
          Drag a role onto the canvas to add an agent step.
        </div>

        {/* Role list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(availableRoles.length > 0 ? availableRoles : ["assistant", "coordinator", "researcher", "creator", "reviewer", "specialist"]).map(
            (role) => (
              <div
                key={role}
                draggable
                onDragStart={(e) => onDragStart(e, role)}
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
      <div style={{ marginTop: "auto", padding: "12px 14px", borderTop: "1px solid var(--border)" }}>
        <div style={{ fontSize: 10, color: "var(--text-dim)", lineHeight: 1.6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--green)", display: "inline-block" }} />
            Start
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <span style={{ width: 10, height: 10, borderRadius: 4, background: "var(--bg-card)", border: "1px solid var(--border)", display: "inline-block" }} />
            Agent Step
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

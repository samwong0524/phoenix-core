"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { AgentNodeData } from "@/lib/workflow-types";

const statusStyles: Record<string, { border: string; shadow: string; badge: string }> = {
  idle: {
    border: "var(--border)",
    shadow: "none",
    badge: "",
  },
  running: {
    border: "var(--cyan, #00f0ff)",
    shadow: "0 0 16px rgba(0, 240, 255, 0.4)",
    badge: "⏳",
  },
  completed: {
    border: "var(--green, #4ade80)",
    shadow: "0 0 12px rgba(74, 222, 128, 0.3)",
    badge: "✓",
  },
  failed: {
    border: "var(--red, #ef4444)",
    shadow: "0 0 12px rgba(239, 68, 68, 0.3)",
    badge: "✗",
  },
};

export default function AgentNode({ data, selected }: NodeProps) {
  const agentData = data as unknown as AgentNodeData;
  const status = agentData.executionStatus || "idle";
  const style = statusStyles[status];
  const isRunning = status === "running";

  return (
    <div
      style={{
        minWidth: 180,
        maxWidth: 240,
        background: "var(--bg-card)",
        border: `2px solid ${selected ? "var(--cyan-dim, rgba(0, 240, 255, 0.4))" : style.border}`,
        borderRadius: 10,
        boxShadow: selected
          ? "0 0 20px rgba(0, 240, 255, 0.2)"
          : style.shadow,
        transition: "border-color 0.3s, box-shadow 0.3s",
        overflow: "hidden",
        animation: isRunning ? "agentPulse 2s ease-in-out infinite" : undefined,
      }}
    >
      {/* Pulse animation keyframes */}
      {isRunning && (
        <style>{`
          @keyframes agentPulse {
            0%, 100% { box-shadow: 0 0 8px rgba(0, 240, 255, 0.2); }
            50% { box-shadow: 0 0 24px rgba(0, 240, 255, 0.5); }
          }
          @keyframes progressSlide {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(200%); }
          }
        `}</style>
      )}

      {/* Input handle */}
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: isRunning ? "var(--cyan, #00f0ff)" : "var(--border-bright)",
          width: 10,
          height: 10,
          border: "2px solid var(--bg-panel, #0a0e1a)",
        }}
      />

      {/* Header */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: isRunning ? "var(--cyan)" : "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            transition: "color 0.3s",
          }}
        >
          {agentData.role || "agent"}
        </span>
        {status !== "idle" && (
          <span style={{ fontSize: 14 }}>{style.badge}</span>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: "8px 12px" }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-primary)",
            marginBottom: 4,
          }}
        >
          {agentData.label}
        </div>
        {agentData.description && (
          <div
            style={{
              fontSize: 11,
              color: "var(--text-dim)",
              lineHeight: 1.4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {agentData.description}
          </div>
        )}
      </div>

      {/* Running progress bar */}
      {isRunning && (
        <div
          style={{
            height: 2,
            background: "var(--bg-panel)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: "40%",
              height: "100%",
              background: "var(--cyan, #00f0ff)",
              animation: "progressSlide 1.5s ease-in-out infinite",
            }}
          />
        </div>
      )}

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: isRunning ? "var(--cyan, #00f0ff)" : "var(--border-bright)",
          width: 10,
          height: 10,
          border: "2px solid var(--bg-panel, #0a0e1a)",
        }}
      />
    </div>
  );
}

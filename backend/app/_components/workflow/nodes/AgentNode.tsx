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
    shadow: "0 2px 8px rgba(0,0,0,0.2)",
    badge: "⏳",
  },
  completed: {
    border: "var(--green, #4ade80)",
    shadow: "0 2px 6px rgba(0,0,0,0.15)",
    badge: "✓",
  },
  failed: {
    border: "var(--red, #ef4444)",
    shadow: "0 2px 6px rgba(0,0,0,0.15)",
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
      className="min-w-[180px] max-w-[240px] bg-card rounded-[10px] overflow-hidden transition duration-300"
      style={{
        border: `2px solid ${selected ? "var(--cyan-dim, rgba(0, 240, 255, 0.4))" : style.border}`,
        boxShadow: selected
          ? "0 4px 12px rgba(0,0,0,0.25)"
          : style.shadow,
        animation: isRunning ? "agentPulse 2s ease-in-out infinite" : undefined,
      }}
    >
      {/* Pulse animation keyframes */}
      {isRunning && (
        <style>{`
          @keyframes agentPulse {
            0%, 100% { border-color: var(--cyan, #00f0ff); }
            50% { border-color: var(--cyan-dim, rgba(0, 240, 255, 0.3)); }
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
        className="w-[10px] h-[10px] border-2 border-panel"
        style={{
          background: isRunning ? "var(--cyan, #00f0ff)" : "var(--border-bright)",
        }}
      />

      {/* Header */}
      <div className="py-2 px-3 border-b border-border flex items-center justify-between gap-2">
        <span
          className={`text-[11px] font-bold font-[family-name:var(--font-mono)] uppercase tracking-wider transition-colors duration-300 ${isRunning ? "text-[var(--cyan)]" : "text-text-dim"}`}
        >
          {agentData.role || "agent"}
        </span>
        {status !== "idle" && (
          <span className="text-sm">{style.badge}</span>
        )}
      </div>

      {/* Body */}
      <div className="py-2 px-3">
        <div className="text-[13px] font-semibold text-text mb-1">
          {agentData.label}
        </div>
        {agentData.description && (
          <div className="text-[11px] text-text-dim leading-[1.4] line-clamp-2">
            {agentData.description}
          </div>
        )}
      </div>

      {/* Running progress bar */}
      {isRunning && (
        <div className="h-[2px] bg-panel overflow-hidden">
          <div
            className="w-2/5 h-full bg-[var(--cyan,#00f0ff)]"
            style={{ animation: "progressSlide 1.5s ease-in-out infinite" }}
          />
        </div>
      )}

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        className="w-[10px] h-[10px] border-2 border-panel"
        style={{
          background: isRunning ? "var(--cyan, #00f0ff)" : "var(--border-bright)",
        }}
      />
    </div>
  );
}

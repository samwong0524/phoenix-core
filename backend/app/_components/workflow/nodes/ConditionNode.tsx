"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ConditionNodeData } from "@/lib/workflow-types";

const statusStyles: Record<string, { border: string; shadow: string }> = {
  idle: { border: "var(--border)", shadow: "none" },
  running: { border: "#a855f7", shadow: "0 0 16px rgba(168, 85, 247, 0.4)" },
  completed: { border: "var(--green, #4ade80)", shadow: "0 0 12px rgba(74, 222, 128, 0.3)" },
  failed: { border: "var(--red, #ef4444)", shadow: "0 0 12px rgba(239, 68, 68, 0.3)" },
};

export default function ConditionNode({ data, selected }: NodeProps) {
  const condData = data as unknown as ConditionNodeData;
  const status = condData.executionStatus || "idle";
  const style = statusStyles[status];
  const isRunning = status === "running";

  return (
    <div
      style={{
        width: 120,
        height: 120,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {isRunning && (
        <style>{`
          @keyframes condPulse {
            0%, 100% { box-shadow: 0 0 8px rgba(168, 85, 247, 0.2); }
            50% { box-shadow: 0 0 24px rgba(168, 85, 247, 0.5); }
          }
        `}</style>
      )}

      {/* Diamond shape */}
      <div
        style={{
          width: 90,
          height: 90,
          transform: "rotate(45deg)",
          background: "var(--bg-card)",
          border: `2px solid ${selected ? "#a855f7" : style.border}`,
          borderRadius: 8,
          boxShadow: selected
            ? "0 0 20px rgba(168, 85, 247, 0.3)"
            : style.shadow,
          transition: "border-color 0.3s, box-shadow 0.3s",
          animation: isRunning ? "condPulse 2s ease-in-out infinite" : undefined,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Content (counter-rotated to stay upright) */}
        <div
          style={{
            transform: "rotate(-45deg)",
            textAlign: "center",
            padding: 4,
            maxWidth: 80,
          }}
        >
          <div
            style={{
              fontSize: 14,
              marginBottom: 2,
            }}
          >
            {status === "completed" ? "✓" : status === "failed" ? "✗" : "◇"}
          </div>
          <div
            style={{
              fontSize: 9,
              fontWeight: 700,
              color: "var(--text-primary)",
              lineHeight: 1.2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {condData.label || "Condition"}
          </div>
        </div>
      </div>

      {/* Input handle (left) */}
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: "#a855f7",
          width: 10,
          height: 10,
          border: "2px solid var(--bg-panel, #0a0e1a)",
          left: 4,
        }}
      />

      {/* True branch (right) */}
      <Handle
        type="source"
        id="true"
        position={Position.Right}
        style={{
          background: "var(--green, #4ade80)",
          width: 10,
          height: 10,
          border: "2px solid var(--bg-panel, #0a0e1a)",
          right: 4,
        }}
      />

      {/* False branch (bottom) */}
      <Handle
        type="source"
        id="false"
        position={Position.Bottom}
        style={{
          background: "var(--red, #ef4444)",
          width: 10,
          height: 10,
          border: "2px solid var(--bg-panel, #0a0e1a)",
          bottom: 4,
        }}
      />

      {/* Branch labels */}
      <div
        style={{
          position: "absolute",
          right: -4,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 8,
          fontWeight: 700,
          color: "var(--green, #4ade80)",
          fontFamily: "var(--font-mono)",
          pointerEvents: "none",
        }}
      >
        T
      </div>
      <div
        style={{
          position: "absolute",
          bottom: -4,
          left: "50%",
          transform: "translateX(-50%)",
          fontSize: 8,
          fontWeight: 700,
          color: "var(--red, #ef4444)",
          fontFamily: "var(--font-mono)",
          pointerEvents: "none",
        }}
      >
        F
      </div>
    </div>
  );
}

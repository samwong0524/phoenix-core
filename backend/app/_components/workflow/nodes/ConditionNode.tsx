"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ConditionNodeData } from "@/lib/workflow-types";

const statusStyles: Record<string, { border: string; shadow: string }> = {
  idle: { border: "var(--border)", shadow: "none" },
  running: { border: "#a855f7", shadow: "0 2px 8px rgba(0,0,0,0.2)" },
  completed: { border: "var(--green, #4ade80)", shadow: "0 2px 6px rgba(0,0,0,0.15)" },
  failed: { border: "var(--red, #ef4444)", shadow: "0 2px 6px rgba(0,0,0,0.15)" },
};

export default function ConditionNode({ data, selected }: NodeProps) {
  const condData = data as unknown as ConditionNodeData;
  const status = condData.executionStatus || "idle";
  const style = statusStyles[status];
  const isRunning = status === "running";

  return (
    <div className="w-[120px] h-[120px] flex items-center justify-center">
      {isRunning && (
        <style>{`
          @keyframes condPulse {
            0%, 100% { border-color: #a855f7; }
            50% { border-color: rgba(168, 85, 247, 0.3); }
          }
        `}</style>
      )}

      {/* Diamond shape */}
      <div
        className="w-[90px] h-[90px] bg-card rounded-[8px] transition duration-300 flex items-center justify-center"
        style={{
          transform: "rotate(45deg)",
          border: `2px solid ${selected ? "#a855f7" : style.border}`,
          boxShadow: selected
            ? "0 4px 12px rgba(0,0,0,0.25)"
            : style.shadow,
          animation: isRunning ? "condPulse 2s ease-in-out infinite" : undefined,
        }}
      >
        {/* Content (counter-rotated to stay upright) */}
        <div
          className="text-center p-1 max-w-[80px]"
          style={{ transform: "rotate(-45deg)" }}
        >
          <div className="text-sm mb-0.5">
            {status === "completed" ? "✓" : status === "failed" ? "✗" : "◇"}
          </div>
          <div className="text-[9px] font-bold text-text leading-[1.2] overflow-hidden text-ellipsis whitespace-nowrap">
            {condData.label || "Condition"}
          </div>
        </div>
      </div>

      {/* Input handle (left) */}
      <Handle
        type="target"
        position={Position.Left}
        className="w-[10px] h-[10px] border-2 border-panel bg-purple left-1"
      />

      {/* True branch (right) */}
      <Handle
        type="source"
        id="true"
        position={Position.Right}
        className="w-[10px] h-[10px] border-2 border-panel bg-green right-1"
      />

      {/* False branch (bottom) */}
      <Handle
        type="source"
        id="false"
        position={Position.Bottom}
        className="w-[10px] h-[10px] border-2 border-panel bg-red bottom-1"
      />

      {/* Branch labels */}
      <div
        className="text-[8px] font-bold text-green font-[family-name:var(--font-mono)] pointer-events-none"
        style={{
          position: "absolute",
          right: -4,
          top: "50%",
          transform: "translateY(-50%)",
        }}
      >
        T
      </div>
      <div
        className="text-[8px] font-bold text-red font-[family-name:var(--font-mono)] pointer-events-none"
        style={{
          position: "absolute",
          bottom: -4,
          left: "50%",
          transform: "translateX(-50%)",
        }}
      >
        F
      </div>
    </div>
  );
}

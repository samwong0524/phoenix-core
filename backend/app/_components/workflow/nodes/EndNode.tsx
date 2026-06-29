"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

export default function EndNode({}: NodeProps) {
  return (
    <div
      style={{
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: "var(--red-soft, rgba(239, 68, 68, 0.12))",
        border: "2px solid var(--red, #ef4444)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 16,
        boxShadow: "0 0 12px rgba(239, 68, 68, 0.3)",
      }}
    >
      ■
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: "var(--red, #ef4444)",
          width: 10,
          height: 10,
          border: "2px solid var(--bg-panel, #0a0e1a)",
        }}
      />
    </div>
  );
}

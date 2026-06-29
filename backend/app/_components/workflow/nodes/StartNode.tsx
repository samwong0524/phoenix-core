"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

export default function StartNode({}: NodeProps) {
  return (
    <div
      style={{
        width: 48,
        height: 48,
        borderRadius: "50%",
        background: "var(--green-soft, rgba(74, 222, 128, 0.12))",
        border: "2px solid var(--green, #4ade80)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 18,
        boxShadow: "0 0 12px rgba(74, 222, 128, 0.3)",
      }}
    >
      ▶
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: "var(--green, #4ade80)",
          width: 10,
          height: 10,
          border: "2px solid var(--bg-panel, #0a0e1a)",
        }}
      />
    </div>
  );
}

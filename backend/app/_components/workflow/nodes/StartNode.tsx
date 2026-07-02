"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

export default function StartNode({}: NodeProps) {
  return (
    <div className="w-12 h-12 rounded-full bg-green-soft border-2 border-green flex items-center justify-center text-lg shadow-[0_2px_6px_rgba(0,0,0,0.15)]">
      ▶
      <Handle
        type="source"
        position={Position.Right}
        className="w-[10px] h-[10px] border-2 border-panel bg-green"
      />
    </div>
  );
}

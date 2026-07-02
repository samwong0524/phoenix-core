"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";

export default function EndNode({}: NodeProps) {
  return (
    <div className="w-12 h-12 rounded-full bg-red-soft border-2 border-red flex items-center justify-center text-base shadow-[0_2px_6px_rgba(0,0,0,0.15)]">
      ■
      <Handle
        type="target"
        position={Position.Left}
        className="w-[10px] h-[10px] border-2 border-panel bg-red"
      />
    </div>
  );
}

"use client";

import React from "react";

type ScrollAreaProps = {
  children: React.ReactNode;
  maxHeight?: string | number;
  style?: React.CSSProperties;
};

export function ScrollArea({ children, maxHeight, style }: ScrollAreaProps) {
  return (
    <div
      style={{
        overflowY: "auto",
        ...(maxHeight !== undefined ? { maxHeight } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

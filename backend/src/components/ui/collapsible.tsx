"use client";

import React, { useState } from "react";

type CollapsibleProps = {
  title: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  style?: React.CSSProperties;
  headerStyle?: React.CSSProperties;
};

const headerBaseStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "8px 0",
  cursor: "pointer",
  userSelect: "none",
};

const chevronStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-dim)",
  transition: "transform 0.2s ease",
  display: "inline-block",
  lineHeight: 1,
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-primary)",
};

const contentWrapperStyle: React.CSSProperties = {
  padding: "var(--space-2) 0 var(--space-3)",
};

const contentOpenStyle: React.CSSProperties = {
  maxHeight: 2000,
  opacity: 1,
  overflow: "hidden",
  transition: "max-height 0.25s ease, opacity 0.2s ease",
};

const contentClosedStyle: React.CSSProperties = {
  maxHeight: 0,
  opacity: 0,
  overflow: "hidden",
  transition: "max-height 0.25s ease, opacity 0.2s ease",
};

export function Collapsible({
  title,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  children,
  style,
  headerStyle,
}: CollapsibleProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);

  // Controlled mode: use open prop if provided; otherwise use internal state
  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const handleToggle = () => {
    const next = !isOpen;
    if (!isControlled) {
      setInternalOpen(next);
    }
    onOpenChange?.(next);
  };

  return (
    <div style={style}>
      <div
        style={{ ...headerBaseStyle, ...headerStyle }}
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
      >
        <span
          style={{
            ...chevronStyle,
            transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
          }}
        >
          ▸
        </span>
        <span style={titleStyle}>{title}</span>
      </div>
      <div style={isOpen ? contentOpenStyle : contentClosedStyle}>
        <div style={contentWrapperStyle}>{children}</div>
      </div>
    </div>
  );
}

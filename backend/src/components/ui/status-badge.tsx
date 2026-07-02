"use client";

import React from "react";

type StatusType = "agent" | "task" | "workflow" | "pipeline";

type StatusConfig = {
  color: string;
  label: string;
  pulse?: boolean;
};

/** Unified status configuration for all entity types */
const STATUS_MAP: Record<StatusType, Record<string, StatusConfig>> = {
  agent: {
    idle: { color: "var(--green)", label: "Idle" },
    working: { color: "var(--yellow)", label: "Working", pulse: true },
    waking: { color: "var(--color-primary)", label: "Waking", pulse: true },
    error: { color: "var(--red)", label: "Error" },
    waiting: { color: "var(--purple)", label: "Waiting" },
  },
  task: {
    pending: { color: "var(--text-dim)", label: "Pending" },
    in_progress: { color: "var(--yellow)", label: "In Progress", pulse: true },
    review: { color: "var(--blue-text)", label: "Review" },
    done: { color: "var(--green)", label: "Done" },
    approved: { color: "var(--green)", label: "Approved" },
    failed: { color: "var(--red)", label: "Failed" },
  },
  workflow: {
    draft: { color: "var(--text-dim)", label: "Draft" },
    active: { color: "var(--green)", label: "Active", pulse: true },
    paused: { color: "var(--yellow)", label: "Paused" },
  },
  pipeline: {
    idle: { color: "var(--text-dim)", label: "Idle" },
    working: { color: "var(--yellow)", label: "Working", pulse: true },
    waiting: { color: "var(--purple)", label: "Waiting" },
    error: { color: "var(--red)", label: "Error" },
    paused: { color: "var(--yellow)", label: "Paused" },
  },
};

type StatusBadgeProps = {
  type: StatusType;
  status: string;
  /** Hide the text label, show only the dot */
  dotOnly?: boolean;
  /** Custom label override */
  label?: string;
  /** Additional inline styles */
  style?: React.CSSProperties;
};

/**
 * Unified status indicator for Agent/Pipeline/Task/Workflow entities.
 * Renders a colored dot with optional pulse animation and a text label.
 */
export function StatusBadge({
  type,
  status,
  dotOnly = false,
  label: labelOverride,
  style,
}: StatusBadgeProps) {
  const config = STATUS_MAP[type]?.[status] ?? {
    color: "var(--text-dim)",
    label: status,
  };

  const displayLabel = labelOverride ?? config.label;

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        color: "var(--text-secondary)",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: config.color,
          flexShrink: 0,
          animation: config.pulse ? "sb-pulse 2s ease-in-out infinite" : undefined,
        }}
      />
      {!dotOnly && displayLabel}
      {config.pulse && (
        <style>{`
          @keyframes sb-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>
      )}
    </span>
  );
}

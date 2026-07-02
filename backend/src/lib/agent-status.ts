/**
 * Unified Agent status enum — the single source of truth for how
 * Agent status is displayed across the application.
 *
 * All internal state systems (IM SSE events, Pipeline runtime, etc.)
 * should map to this enum at the display layer.
 *
 * States:
 *   idle    — Agent is ready, can receive messages (green dot)
 *   working — Agent is actively processing (amber pulsing dot)
 *   waking  — Agent is booting up, not yet ready (blue pulsing dot)
 *   error   — Agent encountered a failure (red dot)
 *   waiting — Agent needs user input to continue (purple dot)
 */

export type AgentStatus = "idle" | "working" | "waking" | "error" | "waiting";

/**
 * Map legacy IM uppercase states to unified lowercase enum.
 * "IDLE" → idle, "BUSY" → working, "WAKING" → waking
 */
export function fromImStatus(status: string): AgentStatus {
  switch (status) {
    case "IDLE":
    case "idle":
      return "idle";
    case "BUSY":
    case "busy":
    case "working":
      return "working";
    case "WAKING":
    case "waking":
      return "waking";
    case "ERROR":
    case "error":
      return "error";
    case "WAITING":
    case "waiting":
    case "paused":
      return "waiting";
    default:
      return "idle";
  }
}

/**
 * Map Pipeline/Workflow execution states to unified agent status.
 * idle→idle, running→working, completed→idle, failed→error
 */
export function fromExecutionStatus(status: string): AgentStatus {
  switch (status) {
    case "running":
      return "working";
    case "completed":
    case "done":
      return "idle";
    case "failed":
    case "error":
      return "error";
    case "paused":
    case "waiting":
      return "waiting";
    default:
      return "idle";
  }
}

/** Status metadata for display purposes */
export const AGENT_STATUS_META: Record<
  AgentStatus,
  { color: string; label: string; labelZh: string; pulse: boolean }
> = {
  idle: { color: "var(--green)", label: "Idle", labelZh: "空闲", pulse: false },
  working: { color: "var(--yellow)", label: "Working", labelZh: "运行中", pulse: true },
  waking: { color: "var(--color-primary)", label: "Waking", labelZh: "启动中", pulse: true },
  error: { color: "var(--red)", label: "Error", labelZh: "错误", pulse: false },
  waiting: { color: "var(--purple)", label: "Waiting", labelZh: "等待输入", pulse: false },
};

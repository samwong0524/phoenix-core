import type { AgentStatus } from "./types";

/** Map agent role to a CSS variable color for avatars, nodes, dots. */
export function roleColor(role?: string): string {
  if (!role || role === "human") return "var(--text-primary)";
  if (role === "assistant") return "var(--cyan)";
  if (role === "coordinator" || role === "productmanager" || role === "pm" || role === "manager" || role === "cto") return "var(--magenta)";
  if (role === "reviewer" || role === "qa") return "var(--purple)";
  if (role === "researcher" || role === "analyst" || role === "specialist" || role === "coder" || role === "developer" || role === "engineer") return "var(--green)";
  if (role === "creator" || role === "writer" || role === "editor" || role === "worker") return "var(--yellow)";
  return "var(--yellow)";
}

/** Map agent status to a CSS variable color for status dots. */
export function statusColor(status?: AgentStatus): string {
  if (status === "BUSY") return "var(--red)";
  if (status === "WAKING") return "var(--yellow)";
  return "var(--green)";
}

/** Accent color for LLM history entries by role. */
export function historyAccent(role?: string): string {
  if (!role) return "var(--purple)";
  if (role === "human") return "var(--text-primary)";
  if (role === "assistant") return "var(--cyan)";
  if (role === "coordinator" || role === "productmanager" || role === "pm" || role === "manager") return "var(--magenta)";
  if (role === "reviewer") return "var(--purple)";
  if (role === "researcher" || role === "specialist" || role === "coder" || role === "developer") return "var(--green)";
  if (role === "creator" || role === "editor") return "var(--yellow)";
  if (role === "tool") return "var(--yellow)";
  if (role === "system") return "var(--purple)";
  return "var(--purple)";
}

export type UUID = string;

export function uuid(): UUID {
  return crypto.randomUUID();
}

export type MultimodalContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export const EXT_TO_MEDIA: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
};

export type HistoryMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string | MultimodalContentPart[];
      tool_calls?: unknown;
      reasoning_content?: string;
    }
  | { role: "tool"; content: string | MultimodalContentPart[]; tool_call_id?: string; name?: string };

export type ToolCall = {
  index: number;
  id?: string;
  name?: string;
  argumentsText: string;
};

export const SKILLS_MARKER = "[skills:loaded]";
export const SOUL_MARKER = "[soul:loaded]";
export const MAX_TOOL_RESULT_CHARS = 200_000; // guardrail: support large results (screenshot paths + metadata, vision content)
export const SEND_TOOL_NAMES = new Set(["send", "send_group_message", "send_direct_message"]);
export const CREATE_TOOL_NAMES = new Set(["create"]);
export const REPLY_TOOL_NAMES = new Set(["send_group_message"]);

/**
 * Per-group agent turn counter for cascade prevention.
 * Incremented each time an agent sends a message to the group.
 * Reset to 0 when a human sends a message.
 * When >= MAX_AGENT_TURNS, non-human-triggered processing is skipped.
 */
export const MAX_AGENT_TURNS = 10;
export const groupAgentTurnCount = new Map<string, number>();

// Circuit breaker for LLM calls: prevents repeated failed calls from wasting tokens
export const llmFailureCount = new Map<string, { count: number; lastFailure: number }>();
export const LLM_CIRCUIT_BREAKER_THRESHOLD = 3;  // consecutive failures to trip
export const LLM_CIRCUIT_BREAKER_COOLDOWN = 5 * 60 * 1000;  // 5 min cooldown

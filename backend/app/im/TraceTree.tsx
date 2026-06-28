/**
 * TraceTree — LangSmith-inspired trace visualization for Agent LLM history.
 *
 * Parses HistoryMessage[] into Rounds, each containing:
 * - Reasoning (collapsible)
 * - Content (assistant text)
 * - Tool Calls (collapsible with args + result)
 */

import { memo, useState, useMemo, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────

type HistoryMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string | Array<{ type: string; text?: string }>;
      tool_calls?: Array<{
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }>;
      reasoning_content?: string;
    }
  | {
      role: "tool";
      content: string;
      tool_call_id?: string;
      name?: string;
    };

type ToolCallNode = {
  id: string;
  name: string;
  args: string;
  result: string | null;
};

type Round = {
  index: number;
  reasoning: string | undefined;
  content: string;
  toolCalls: ToolCallNode[];
};

type TraceTreeProps = {
  llmHistory: string;
  streamAgentId: string | null;
};

// ─── Parser ──────────────────────────────────────────────────

function buildRounds(history: HistoryMessage[]): Round[] {
  const rounds: Round[] = [];
  let current: Round | null = null;
  let roundIdx = 0;

  for (const msg of history) {
    if (msg.role === "system" || msg.role === "user") continue;

    if (msg.role === "assistant") {
      roundIdx++;
      const textContent = typeof msg.content === "string"
        ? msg.content
        : msg.content.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");

      current = {
        index: roundIdx,
        reasoning: msg.reasoning_content,
        content: textContent,
        toolCalls: [],
      };

      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          current.toolCalls.push({
            id: tc.id,
            name: tc.function?.name ?? "unknown",
            args: tc.function?.arguments ?? "{}",
            result: null,
          });
        }
      }
      rounds.push(current);
    } else if (msg.role === "tool" && current) {
      const call = current.toolCalls.find((tc) => tc.id === msg.tool_call_id);
      if (call) {
        call.result = msg.content;
        call.name = msg.name ?? call.name;
      }
    }
  }
  return rounds;
}

// ─── Helpers ─────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `… (${text.length - max} chars omitted)`;
}

function tryFormatJson(str: string): string {
  try {
    return JSON.stringify(JSON.parse(str), null, 2);
  } catch {
    return str;
  }
}

function isToolResultOk(result: string): boolean {
  try {
    const parsed = JSON.parse(result);
    return parsed.ok !== false;
  } catch {
    return true; // non-JSON results are treated as ok
  }
}

// ─── Tool icon map ───────────────────────────────────────────

const TOOL_ICONS: Record<string, string> = {
  bash: "🖥",
  send: "📨",
  send_group_message: "💬",
  send_direct_message: "📩",
  get_skill: "📖",
  create_skill: "✏️",
  search_skill: "🔍",
  create: "🤖",
  list_agents: "📋",
  list_groups: "📋",
  create_group: "👥",
  memory_add: "🧠",
  memory_search: "🧠",
  ask_user: "❓",
};

function getToolIcon(name: string): string {
  return TOOL_ICONS[name] ?? "🔧";
}

// ─── Component ───────────────────────────────────────────────

export const TraceTree = memo(function TraceTree({ llmHistory, streamAgentId }: TraceTreeProps) {
  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set());
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  const rounds = useMemo(() => {
    if (!llmHistory) return [];
    try {
      const history: HistoryMessage[] = JSON.parse(llmHistory);
      return buildRounds(history);
    } catch {
      return [];
    }
  }, [llmHistory]);

  // Auto-expand last round when new data arrives
  const lastRoundIdx = rounds.length > 0 ? rounds[rounds.length - 1].index : -1;

  const toggleRound = useCallback((idx: number) => {
    setExpandedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const toggleTool = useCallback((id: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (rounds.length === 0) {
    return (
      <div className="trace-empty">
        {streamAgentId ? "等待 Agent 活动…" : "选择 Agent 查看 Trace"}
      </div>
    );
  }

  return (
    <div className="trace-tree">
      <div className="trace-header">
        <span className="trace-header-title">Trace</span>
        <span className="trace-header-badge">{rounds.length} rounds</span>
        {streamAgentId && (
          <span className="trace-header-agent">{streamAgentId.slice(0, 8)}…</span>
        )}
      </div>

      <div className="trace-rounds">
        {rounds.map((round) => {
          const isExpanded = expandedRounds.has(round.index) || round.index === lastRoundIdx;
          return (
            <div key={round.index} className="trace-round">
              {/* Round header */}
              <div
                className="trace-round-header"
                onClick={() => toggleRound(round.index)}
              >
                <span className="trace-round-arrow">{isExpanded ? "▾" : "▸"}</span>
                <span className="trace-round-label">Round {round.index}</span>
                {round.toolCalls.length > 0 && (
                  <span className="trace-round-tools-badge">{round.toolCalls.length} tool{round.toolCalls.length > 1 ? "s" : ""}</span>
                )}
                {round.content && !round.toolCalls.length && (
                  <span className="trace-round-content-preview">{truncate(round.content, 50)}</span>
                )}
              </div>

              {/* Round body */}
              {isExpanded && (
                <div className="trace-round-body">
                  {/* Reasoning */}
                  {round.reasoning && (
                    <div className="trace-node trace-reasoning">
                      <div className="trace-node-label">💭 Reasoning</div>
                      <div className="trace-node-content trace-reasoning-text">
                        {truncate(round.reasoning, 300)}
                      </div>
                    </div>
                  )}

                  {/* Content */}
                  {round.content && (
                    <div className="trace-node trace-content">
                      <div className="trace-node-label">💬 Content</div>
                      <div className="trace-node-content trace-content-text">
                        {truncate(round.content, 500)}
                      </div>
                    </div>
                  )}

                  {/* Tool Calls */}
                  {round.toolCalls.map((tc) => {
                    const isToolExpanded = expandedTools.has(tc.id);
                    const ok = tc.result !== null ? isToolResultOk(tc.result) : true;
                    return (
                      <div key={tc.id} className="trace-node trace-tool">
                        <div
                          className="trace-tool-header"
                          onClick={() => toggleTool(tc.id)}
                        >
                          <span className="trace-tool-arrow">{isToolExpanded ? "▾" : "▸"}</span>
                          <span className="trace-tool-icon">{getToolIcon(tc.name)}</span>
                          <span className="trace-tool-name">{tc.name}</span>
                          {tc.result && (
                            <span className={`trace-tool-status ${ok ? "ok" : "err"}`}>
                              {ok ? "✓" : "✗"}
                            </span>
                          )}
                        </div>
                        {isToolExpanded && (
                          <div className="trace-tool-body">
                            <div className="trace-tool-section">
                              <div className="trace-tool-section-label">Args</div>
                              <pre className="trace-tool-pre">{truncate(tryFormatJson(tc.args), 500)}</pre>
                            </div>
                            {tc.result !== null && (
                              <div className="trace-tool-section">
                                <div className="trace-tool-section-label">Result</div>
                                <pre className="trace-tool-pre">{truncate(tryFormatJson(tc.result), 1000)}</pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

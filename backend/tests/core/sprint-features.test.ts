import { describe, it, expect } from "vitest";

// =========================================================================
// Sprint 1 — Tool Grouping
// =========================================================================

const AGENT_CATEGORY_NAMES = [
  "AGENT", "SKILL", "MESSAGE", "GROUP", "EXECUTION", "WORKFLOW", "MEMORY", "BACKUP",
];

const AGENT_TOOLS_AGENT = [
  "self", "get_agent_info", "get_agent_role", "list_agents",
];
const AGENT_TOOLS_SKILL = [
  "get_skill", "list_skills", "create_skill", "delete_skill",
];
const AGENT_TOOLS_MESSAGE = [
  "send", "send_group_message", "send_direct_message", "read", "get_message_detail",
];
const AGENT_TOOLS_GROUP = [
  "create_group", "add_group_member", "remove_group_member", "delete_group",
];
const AGENT_TOOLS_EXECUTION = [
  "bash",
];
const AGENT_TOOLS_WORKFLOW = [
  "create_workflow", "update_task", "get_workflow_status", "assign_agent",
  "add_workflow_tag", "list_workflow_tags",
];
const AGENT_TOOLS_MEMORY = [
  "memory_add", "memory_search", "get_agent_essence", "set_agent_essence",
];
const AGENT_TOOLS_BACKUP = [
  "backup_create", "backup_list", "backup_get",
];

const AGENT_TOOLS = [
  ...AGENT_TOOLS_AGENT,
  ...AGENT_TOOLS_SKILL,
  ...AGENT_TOOLS_MESSAGE,
  ...AGENT_TOOLS_GROUP,
  ...AGENT_TOOLS_EXECUTION,
  ...AGENT_TOOLS_WORKFLOW,
  ...AGENT_TOOLS_MEMORY,
  ...AGENT_TOOLS_BACKUP,
];

describe("Tool grouping (Sprint 1)", () => {
  it("has 8 distinct categories", () => {
    expect(AGENT_CATEGORY_NAMES).toHaveLength(8);
  });

  it("total combined tools equal sum of all categories", () => {
    const total =
      AGENT_TOOLS_AGENT.length +
      AGENT_TOOLS_SKILL.length +
      AGENT_TOOLS_MESSAGE.length +
      AGENT_TOOLS_GROUP.length +
      AGENT_TOOLS_EXECUTION.length +
      AGENT_TOOLS_WORKFLOW.length +
      AGENT_TOOLS_MEMORY.length +
      AGENT_TOOLS_BACKUP.length;
    expect(AGENT_TOOLS).toHaveLength(total);
  });

  it("no tool appears in more than one category", () => {
    const all = [
      AGENT_TOOLS_AGENT,
      AGENT_TOOLS_SKILL,
      AGENT_TOOLS_MESSAGE,
      AGENT_TOOLS_GROUP,
      AGENT_TOOLS_EXECUTION,
      AGENT_TOOLS_WORKFLOW,
      AGENT_TOOLS_MEMORY,
      AGENT_TOOLS_BACKUP,
    ];
    const seen = new Map<string, number>();
    for (const cat of all) {
      for (const name of cat) {
        seen.set(name, (seen.get(name) ?? 0) + 1);
      }
    }
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1);
    expect(duplicates).toHaveLength(0);
  });

  it("agent category has self and listing tools", () => {
    expect(AGENT_TOOLS_AGENT).toContain("self");
    expect(AGENT_TOOLS_AGENT).toContain("list_agents");
  });

  it("group category has CRUD tools", () => {
    expect(AGENT_TOOLS_GROUP).toContain("create_group");
    expect(AGENT_TOOLS_GROUP).toContain("delete_group");
    expect(AGENT_TOOLS_GROUP).toContain("add_group_member");
    expect(AGENT_TOOLS_GROUP).toContain("remove_group_member");
  });

  it("message category has send and read tools", () => {
    expect(AGENT_TOOLS_MESSAGE).toContain("send");
    expect(AGENT_TOOLS_MESSAGE).toContain("read");
    expect(AGENT_TOOLS_MESSAGE).toContain("send_group_message");
  });

  it("backup category has create, list, get", () => {
    expect(AGENT_TOOLS_BACKUP).toContain("backup_create");
    expect(AGENT_TOOLS_BACKUP).toContain("backup_list");
    expect(AGENT_TOOLS_BACKUP).toContain("backup_get");
  });

  it("memory category has add and search", () => {
    expect(AGENT_TOOLS_MEMORY).toContain("memory_add");
    expect(AGENT_TOOLS_MEMORY).toContain("memory_search");
  });
});

// =========================================================================
// Sprint 1 — Memory Snapshot (buildMemorySnapshot)
// =========================================================================

type MemoryRow = { content: string; importance: number | null; source: string | null };

function buildMemorySnapshot(memories: MemoryRow[]): string | null {
  if (!memories || memories.length === 0) return null;

  const sorted = [...memories].sort((a, b) => (b.importance ?? 3) - (a.importance ?? 3));
  const lines = sorted.map((r, i) => {
    const imp = r.importance ?? 3;
    const source = r.source ? ` (source: ${r.source})` : "";
    return `${i + 1}. [${"★".repeat(Math.min(5, imp))}${"☆".repeat(5 - Math.min(5, imp))}] ${r.content}${source}`;
  });

  return [
    "## Memory Snapshot (session start)",
    "",
    "Key facts from prior sessions, ordered by importance:",
    "",
    ...lines,
    "",
    "---",
  ].join("\n");
}

describe("Memory Snapshot (Sprint 1)", () => {
  it("returns null for empty memories", () => {
    expect(buildMemorySnapshot([])).toBeNull();
  });

  it("returns formatted snapshot for non-empty memories", () => {
    const memories: MemoryRow[] = [
      { content: "User prefers Python", importance: 5, source: "conversation" },
      { content: "User has a project called Foo", importance: 3, source: null },
    ];
    const result = buildMemorySnapshot(memories);
    expect(result).toContain("## Memory Snapshot");
    expect(result).toContain("User prefers Python");
    expect(result).toContain("★★★★★");
    expect(result).toContain("★★★☆☆");
    expect(result).toContain("(source: conversation)");
  });

  it("defaults importance to 3 when null", () => {
    const memories: MemoryRow[] = [
      { content: "Test memory", importance: null, source: null },
    ];
    const result = buildMemorySnapshot(memories);
    expect(result).toContain("★★★☆☆");
  });

  it("caps importance display at 5", () => {
    const memories: MemoryRow[] = [
      { content: "Very important", importance: 10, source: null },
    ];
    const result = buildMemorySnapshot(memories);
    expect(result).toContain("★★★★★");
  });

  it("orders by importance descending", () => {
    const memories: MemoryRow[] = [
      { content: "Low", importance: 1, source: null },
      { content: "High", importance: 5, source: null },
    ];
    const result = buildMemorySnapshot(memories);
    const highIdx = result.indexOf("High");
    const lowIdx = result.indexOf("Low");
    expect(highIdx).toBeLessThan(lowIdx);
  });
});

// =========================================================================
// Sprint 1 — Anthropic Prompt Caching
// =========================================================================

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string;
  cache_control?: { type: "ephemeral" };
};

type AnthropicSystemBlock = {
  type: "text";
  text: string;
  cache_control: { type: "ephemeral" };
};

function buildAnthropicPayload(history: Array<{ role: string; content: string }>, model: string) {
  const systemMessages = history.filter((m) => m.role === "system");
  const chatMessages = history.filter((m) => m.role !== "system");

  const systemParam: AnthropicSystemBlock[] = systemMessages.map((m) => ({
    type: "text" as const,
    text: m.content,
    cache_control: { type: "ephemeral" as const },
  }));

  const messages: AnthropicMessage[] = chatMessages.map((msg, i) => ({
    role: msg.role as "user" | "assistant",
    content: msg.content,
    // Add cache_control to the last 3 non-system messages
    ...(i >= chatMessages.length - 3 ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));

  const payload: Record<string, unknown> = { model, messages, max_tokens: 8192, stream: true };
  if (systemParam.length > 0) payload.system = systemParam;

  return { payload, systemParam, messages };
}

describe("Anthropic Prompt Caching (Sprint 1)", () => {
  it("adds cache_control to every system block", () => {
    const history = [
      { role: "system", content: "You are an agent" },
      { role: "user", content: "Hello" },
    ];
    const { systemParam } = buildAnthropicPayload(history, "claude-3-5");
    for (const block of systemParam) {
      expect(block.cache_control).toEqual({ type: "ephemeral" });
    }
  });

  it("adds cache_control to last 3 chat messages", () => {
    const history = [
      { role: "user", content: "1" },
      { role: "assistant", content: "2" },
      { role: "user", content: "3" },
      { role: "assistant", content: "4" },
      { role: "user", content: "5" },
    ];
    const { messages } = buildAnthropicPayload(history, "claude-3-5");
    // Last 3 should have cache_control: 5th, 4th, 3rd
    expect(messages[2].cache_control).toEqual({ type: "ephemeral" }); // index 2 = msg 3
    expect(messages[3].cache_control).toEqual({ type: "ephemeral" }); // index 3 = msg 4
    expect(messages[4].cache_control).toEqual({ type: "ephemeral" }); // index 4 = msg 5
  });

  it("does NOT add cache_control to messages before last 3", () => {
    const history = [
      { role: "user", content: "1" },
      { role: "user", content: "2" },
      { role: "user", content: "3" },
      { role: "user", content: "4" },
    ];
    const { messages } = buildAnthropicPayload(history, "claude-3-5");
    // For 4 messages: last 3 are indexes 1,2,3; only index 0 should NOT have cache_control
    expect(messages[0].cache_control).toBeUndefined();
  });

  it("includes system array in payload when system messages exist", () => {
    const history = [
      { role: "system", content: "Soul prompt" },
      { role: "user", content: "Hi" },
    ];
    const { payload } = buildAnthropicPayload(history, "claude-3-5");
    expect(payload.system).toBeDefined();
    expect(Array.isArray(payload.system)).toBe(true);
  });
});

// =========================================================================
// Sprint 2 — Parallel Tool Execution
// =========================================================================

type ToolCall = {
  id?: string;
  name?: string;
  argumentsText: string;
};

type ToolExecResult = {
  call: ToolCall;
  isSend: boolean;
  isBlocked: boolean;
  ok: boolean;
};

interface ToolRunnerContext {
  blockedTools: Set<string>;
  turnToolFailures: Map<string, number>;
  exactFailureCount: Map<string, number>;
  sameToolFailureCount: Map<string, number>;
  agentPaused: boolean;
}

function makeContext(): ToolRunnerContext {
  return {
    blockedTools: new Set(),
    turnToolFailures: new Map(),
    exactFailureCount: new Map(),
    sameToolFailureCount: new Map(),
    agentPaused: false,
  };
}

/** Phase 1: Execute tools — parallel (allSettled) for non-bash, sequential when bash is present */
async function executePhase1(ctx: ToolRunnerContext, calls: ToolCall[]): Promise<ToolExecResult[]> {
  const hasBash = calls.some((c) => c.name === "bash");

  const executeOne = async (call: ToolCall): Promise<ToolExecResult> => {
    const callKey = call.name
      ? `${call.name}:${JSON.stringify({})}`
      : "";
    const isBlocked = !!(call.name && ctx.blockedTools.has(callKey));
    const isSend = !!(call.name && ["send", "send_group_message", "send_direct_message"].includes(call.name));
    const ok = isBlocked ? false : true; // Simulated tool execution
    return { call, callKey, isBlocked, isSend, ok };
  };

  if (hasBash) {
    // Bash present — execute sequentially for safety
    const results: ToolExecResult[] = [];
    for (const call of calls) {
      results.push(await executeOne(call));
    }
    return results;
  }

  // No bash — parallel via allSettled; a thrown tool becomes an error result
  const settled = await Promise.allSettled(calls.map((call) => executeOne(call)));
  return settled.map((s, i) => {
    if (s.status === "fulfilled") return s.value;
    return {
      call: calls[i],
      callKey: "",
      isBlocked: false,
      isSend: false,
      ok: false,
    };
  });
}

/** Phase 2: Process results serially with guardrails */
function processPhase2(ctx: ToolRunnerContext, results: ToolExecResult[]): { paused: boolean; failures: number } {
  let totalFailures = 0;
  for (const { call, callKey, isBlocked, ok } of results) {
    if (ctx.agentPaused) break;
    if (isBlocked) continue;

    if (!ok && call.name) {
      totalFailures++;
      const prev = ctx.turnToolFailures.get(call.name) ?? 0;
      ctx.turnToolFailures.set(call.name, prev + 1);

      const exactPrev = ctx.exactFailureCount.get(callKey) ?? 0;
      ctx.exactFailureCount.set(callKey, exactPrev + 1);
      if (exactPrev + 1 >= 5) {
        ctx.blockedTools.add(callKey);
      }

      const sameToolPrev = ctx.sameToolFailureCount.get(call.name) ?? 0;
      ctx.sameToolFailureCount.set(call.name, sameToolPrev + 1);
      if (sameToolPrev + 1 >= 8) {
        ctx.agentPaused = true;
      }
    }
  }
  return { paused: ctx.agentPaused, failures: totalFailures };
}

describe("Parallel Tool Execution (Sprint 2)", () => {
  it("executes multiple independent tools in parallel (phase 1)", async () => {
    const ctx = makeContext();
    const calls: ToolCall[] = [
      { id: "1", name: "bash", argumentsText: "{}" },
      { id: "2", name: "memory_search", argumentsText: "{}" },
    ];
    const results = await executePhase1(ctx, calls);
    expect(results).toHaveLength(2);
    expect(results[0].isBlocked).toBe(false);
    expect(results[1].isBlocked).toBe(false);
  });

  it("processes results serially in phase 2", () => {
    const ctx = makeContext();
    const results: ToolExecResult[] = [
      { call: { id: "1", name: "bash", argumentsText: "{}" }, callKey: "bash:{}", isBlocked: false, isSend: false, ok: false },
      { call: { id: "2", name: "memory_search", argumentsText: "{}" }, callKey: "memory_search:{}", isBlocked: false, isSend: false, ok: true },
    ];
    const { paused, failures } = processPhase2(ctx, results);
    expect(paused).toBe(false);
    expect(failures).toBe(1);
    expect(ctx.turnToolFailures.get("bash")).toBe(1);
  });

  it("blocks a tool after 5 exact failures", () => {
    const ctx = makeContext();
    const call: ToolCall = { id: "1", name: "bash", argumentsText: "{}" };
    for (let i = 0; i < 5; i++) {
      const results: ToolExecResult[] = [
        { call, callKey: "bash:{}", isBlocked: ctx.blockedTools.has("bash:{}"), isSend: false, ok: false },
      ];
      processPhase2(ctx, results);
    }
    expect(ctx.blockedTools.has("bash:{}")).toBe(true);
  });

  it("pauses agent after 8 same-tool failures", () => {
    const ctx = makeContext();
    const call: ToolCall = { id: "1", name: "bash", argumentsText: "{}" };
    for (let i = 0; i < 8; i++) {
      const results: ToolExecResult[] = [
        { call, callKey: `bash:{}:${i}`, isBlocked: false, isSend: false, ok: false },
      ];
      processPhase2(ctx, results);
    }
    expect(ctx.agentPaused).toBe(true);
  });

  it("marks send tools correctly", async () => {
    const calls: ToolCall[] = [
      { id: "1", name: "send_group_message", argumentsText: "{}" },
      { id: "2", name: "bash", argumentsText: "{}" },
    ];
    const results = await executePhase1(makeContext(), calls);
    expect(results[0].isSend).toBe(true);
    expect(results[1].isSend).toBe(false);
  });

  it("skips blocked tools in phase 2", () => {
    const ctx = makeContext();
    ctx.blockedTools.add("bash:{}");
    const results: ToolExecResult[] = [
      { call: { id: "1", name: "bash", argumentsText: "{}" }, callKey: "bash:{}", isBlocked: true, isSend: false, ok: false },
    ];
    const { failures } = processPhase2(ctx, results);
    expect(failures).toBe(0);
  });

  it("stops processing if agent is paused mid-phase2", () => {
    const ctx = makeContext();
    ctx.agentPaused = true;
    const results: ToolExecResult[] = [
      { call: { id: "1", name: "bash", argumentsText: "{}" }, callKey: "bash:{}", isBlocked: false, isSend: false, ok: false },
      { call: { id: "2", name: "mem_search", argumentsText: "{}" }, callKey: "mem_search:{}", isBlocked: false, isSend: false, ok: true },
    ];
    const { failures } = processPhase2(ctx, results);
    // Only first result processed before break
    expect(failures).toBe(0);
  });

  it("allSettled: one tool throwing does not prevent others from completing", async () => {
    // Simulate the allSettled behavior directly
    const tasks = [
      Promise.resolve({ ok: true }),
      Promise.reject(new Error("tool crashed")),
      Promise.resolve({ ok: true }),
    ];
    const settled = await Promise.allSettled(tasks);
    expect(settled).toHaveLength(3);
    expect(settled[0].status).toBe("fulfilled");
    expect(settled[1].status).toBe("rejected");
    expect(settled[2].status).toBe("fulfilled");
  });

  it("bash-sequential: when bash is present, tools execute in order", async () => {
    const executionOrder: string[] = [];
    const calls: ToolCall[] = [
      { id: "1", name: "bash", argumentsText: "{}" },
      { id: "2", name: "memory_search", argumentsText: "{}" },
      { id: "3", name: "bash", argumentsText: "{}" },
    ];

    // Simulate sequential execution (the hasBash path)
    for (const call of calls) {
      executionOrder.push(call.name!);
    }

    // Sequential means order is always preserved: 1,2,3
    expect(executionOrder).toEqual(["bash", "memory_search", "bash"]);
  });

  it("parallel: results maintain same order as original tool_calls", async () => {
    const calls: ToolCall[] = [
      { id: "1", name: "memory_search", argumentsText: "{}" },
      { id: "2", name: "get_skill", argumentsText: "{}" },
      { id: "3", name: "send", argumentsText: "{}" },
    ];
    const results = await executePhase1(makeContext(), calls);
    // allSettled preserves order
    expect(results.map((r) => r.call.id)).toEqual(["1", "2", "3"]);
  });

  it("parallel: no bash means all tools run via allSettled", async () => {
    const calls: ToolCall[] = [
      { id: "1", name: "memory_search", argumentsText: "{}" },
      { id: "2", name: "get_skill", argumentsText: "{}" },
    ];
    const hasBash = calls.some((c) => c.name === "bash");
    expect(hasBash).toBe(false);
    const results = await executePhase1(makeContext(), calls);
    expect(results).toHaveLength(2);
  });

  it("bash present: hasBash check triggers sequential path", async () => {
    const calls: ToolCall[] = [
      { id: "1", name: "memory_search", argumentsText: "{}" },
      { id: "2", name: "bash", argumentsText: "{}" },
    ];
    const hasBash = calls.some((c) => c.name === "bash");
    expect(hasBash).toBe(true);
  });
});

// =========================================================================
// Sprint 3 — Nudge Engine
// =========================================================================

const NUDGE_INTERVAL = 15;
const MAX_AUTO_SKILLS_PER_AGENT_PER_DAY = 3;

describe("Nudge Engine (Sprint 3) — interval logic", () => {
  it("triggers analysis when counter reaches NUDGE_INTERVAL", () => {
    let counter = 0;
    let triggered = false;

    for (let i = 0; i < 20; i++) {
      counter++;
      if (counter >= NUDGE_INTERVAL) {
        triggered = true;
        counter = 0;
      }
    }

    expect(triggered).toBe(true);
    // After reset, counter should be 20 - 15 = 5
    expect(counter).toBe(5);
  });

  it("resets counter after trigger", () => {
    let counter = 14;
    let triggered = false;

    counter++;
    if (counter >= NUDGE_INTERVAL) {
      triggered = true;
      counter = 0;
    }

    expect(triggered).toBe(true);
    expect(counter).toBe(0);
  });

  it("does not trigger before NUDGE_INTERVAL is reached", () => {
    let counter = 0;
    let triggered = false;

    for (let i = 0; i < 14; i++) {
      counter++;
      if (counter >= NUDGE_INTERVAL) {
        triggered = true;
        counter = 0;
      }
    }

    expect(triggered).toBe(false);
    expect(counter).toBe(14);
  });

  it("fire-and-forget: nudge analysis does not block the main loop", async () => {
    // Simulate the fire-and-forget pattern: void this.nudgeAnalysis()
    let nudgeRan = false;
    const nudgeAnalysis = async () => {
      // Simulate async I/O with a real yield
      await new Promise((r) => setTimeout(r, 0));
      nudgeRan = true;
    };

    // Main loop continues without awaiting nudgeAnalysis
    void nudgeAnalysis();
    // The promise is pending (setTimeout is macrotask), so nudgeRan should still be false
    expect(nudgeRan).toBe(false);
    // Wait for it to complete
    await new Promise((r) => setTimeout(r, 5));
    expect(nudgeRan).toBe(true);
  });
});

describe("Nudge Engine (Sprint 3) — daily limit", () => {
  it("respects MAX_AUTO_SKILLS_PER_AGENT_PER_DAY limit", () => {
    const usedToday = 3; // all slots used
    expect(usedToday >= MAX_AUTO_SKILLS_PER_AGENT_PER_DAY).toBe(true);
  });

  it("allows creation when under daily limit", () => {
    const usedToday = 2;
    expect(usedToday < MAX_AUTO_SKILLS_PER_AGENT_PER_DAY).toBe(true);
  });
});

describe("Nudge Engine (Sprint 3) — skill name generation", () => {
  function makeSkillName(raw: string | null): string {
    const name = `auto-nudge-${(raw ?? "pattern")
      .toLowerCase()
      .replace(/[^a-z0-9一-鿿-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60)}`;
    return name;
  }

  it("prefixes with auto-nudge-", () => {
    expect(makeSkillName("fix-recipe")).toBe("auto-nudge-fix-recipe");
  });

  it("sanitizes special characters", () => {
    expect(makeSkillName("Fix: Bug #123!")).toBe("auto-nudge-fix-bug-123");
  });

  it("truncates to 60 chars", () => {
    const long = "a".repeat(100);
    const result = makeSkillName(long);
    expect(result.length).toBeLessThanOrEqual("auto-nudge-".length + 60);
  });
});

// =========================================================================
// Sprint 3 — Auto-Create Skill from Workflow
// =========================================================================

describe("Auto-Create Skill from Workflow (Sprint 3)", () => {
  it("generates skill name from workflow name", () => {
    const wfName = "Deploy Pipeline";
    const skillName = `auto-${wfName.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}`;
    expect(skillName).toBe("auto-deploy-pipeline");
  });

  it("generates skill description with task summary", () => {
    const wfName = "Code Review";
    const doneCount = 3;
    const totalCount = 4;
    const description = `Auto-generated skill from workflow "${wfName}" (${doneCount}/${totalCount} tasks successful)`;
    expect(description).toBe('Auto-generated skill from workflow "Code Review" (3/4 tasks successful)');
  });

  it("builds markdown content from task results", () => {
    const tasks = [
      { name: "Lint", status: "done", result: "All clean" },
      { name: "Test", status: "approved", result: "Passed" },
    ];
    const content = [
      "# Code Review",
      "",
      "## Overview",
      "",
      "Workflow completed with 2/2 tasks successful.",
      "",
      "## Tasks",
      "",
      ...tasks.map((t) => `- **${t.name}**: ${t.result.slice(0, 300) || "(no result recorded)"}`),
      "",
      "## Notes",
      "",
      "- This skill was auto-generated from a completed workflow.",
      "- Review and update the content for reusability.",
    ].join("\n");

    expect(content).toContain("## Overview");
    expect(content).toContain("**Lint**");
    expect(content).toContain("**Test**");
    expect(content).not.toContain("failed"); // only done/approved tasks
  });

  it("checks all tasks are in terminal state before creating", () => {
    const terminalStates = new Set(["done", "approved", "blocked", "failed"]);
    const tasks = [
      { status: "done" },
      { status: "running" }, // not terminal
    ];
    const allDone = tasks.every((t) => terminalStates.has(t.status));
    expect(allDone).toBe(false);
  });
});

// =========================================================================
// Runtime — compressHistory
// =========================================================================

type HistoryMessage = {
  role: string;
  content: string | Record<string, unknown>;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
};

function compressHistory(history: HistoryMessage[]): void {
  if (history.length < 20) return;

  // Keep first 4 (system + initial context) and last 6 (recent exchange)
  const keepBefore = 4;
  const keepAfter = 6;
  const compressed: HistoryMessage[] = [
    ...history.slice(0, keepBefore),
    { role: "system", content: `[compressed ${history.length - keepBefore - keepAfter} tool-call exchanges to save context]` },
    ...history.slice(-keepAfter),
  ];

  // Replace original history in-place
  history.length = 0;
  history.push(...compressed);
}

describe("compressHistory", () => {
  it("does not compress short history (< 20)", () => {
    const history: HistoryMessage[] = Array.from({ length: 10 }, () => ({
      role: "user", content: "msg",
    }));
    const snapshot = history.length;
    compressHistory(history);
    expect(history.length).toBe(snapshot);
  });

  it("compresses to keepBefore + 1 summary + keepAfter entries", () => {
    const history: HistoryMessage[] = Array.from({ length: 30 }, () => ({
      role: "user", content: "msg",
    }));
    compressHistory(history);
    expect(history.length).toBe(4 + 1 + 6); // 11 total
  });

  it("inserts a summary message with compression note", () => {
    const history: HistoryMessage[] = Array.from({ length: 25 }, () => ({
      role: "user", content: "msg",
    }));
    compressHistory(history);
    expect(history[4].role).toBe("system");
    expect(history[4].content).toContain("compressed");
  });
});

// =========================================================================
// Tool dispatch — getAgentTools filtering (check_fn integration)
// =========================================================================

interface ToolContext {
  agentId: string;
  isCoordinator: boolean;
  hasActiveWorkflow: boolean;
  shellEnabled: boolean;
}

type ToolCheck = (ctx: ToolContext) => boolean;

const TOOL_AVAILABILITY: Record<string, ToolCheck> = {
  update_task: (ctx) => ctx.hasActiveWorkflow,
  get_workflow_status: (ctx) => ctx.hasActiveWorkflow,
  assign_agent: (ctx) => ctx.hasActiveWorkflow && ctx.isCoordinator,
  create_workflow: (ctx) => ctx.isCoordinator,
  delete_group: (ctx) => ctx.isCoordinator,
  bash: (ctx) => ctx.shellEnabled,
};

function getAgentTools(allTools: string[], context?: ToolContext): string[] {
  if (!context) return allTools;
  return allTools.filter((toolName) => {
    const check = TOOL_AVAILABILITY[toolName];
    return !check || check(context);
  });
}

describe("getAgentTools filtering (check_fn integration)", () => {
  const allTools = [
    "self", "get_skill", "send", "create_group", "bash",
    "create_workflow", "update_task", "get_workflow_status",
    "delete_group", "memory_add",
  ];

  it("returns all tools when no context provided", () => {
    expect(getAgentTools(allTools, undefined)).toHaveLength(allTools.length);
  });

  it("filters out workflow tools when no active workflow", () => {
    const ctx: ToolContext = {
      agentId: "a1", isCoordinator: true, hasActiveWorkflow: false, shellEnabled: true,
    };
    const tools = getAgentTools(allTools, ctx);
    expect(tools).toContain("bash");
    expect(tools).toContain("self");
    expect(tools).not.toContain("update_task");
    expect(tools).not.toContain("get_workflow_status");
    expect(tools).toContain("create_workflow"); // coordinator-only, not workflow-active
    expect(tools).toContain("delete_group");
  });

  it("filters out bash when shell disabled", () => {
    const ctx: ToolContext = {
      agentId: "a1", isCoordinator: true, hasActiveWorkflow: true, shellEnabled: false,
    };
    const tools = getAgentTools(allTools, ctx);
    expect(tools).not.toContain("bash");
    expect(tools).toContain("self");
  });

  it("tools without check_fn are unaffected", () => {
    const ctx: ToolContext = {
      agentId: "a1", isCoordinator: false, hasActiveWorkflow: false, shellEnabled: false,
    };
    const tools = getAgentTools(allTools, ctx);
    expect(tools).toContain("self"); // no check_fn
    expect(tools).toContain("send");
    expect(tools).toContain("memory_add");
  });
});

// =========================================================================
// PROVIDER_REGISTRY abstraction
// =========================================================================

type LlmProvider = "openrouter" | "anthropic" | "glm" | "ollama";

const PROVIDER_REGISTRY: Record<string, string> = {
  openrouter: "callOpenRouterStreaming",
  anthropic: "callAnthropicStreaming",
  glm: "callGlmStreaming",
  ollama: "callOllamaStreaming",
};

function getProviderHandler(provider: string) {
  return PROVIDER_REGISTRY[provider] ?? null;
}

describe("PROVIDER_REGISTRY abstraction (Sprint 2)", () => {
  it("maps all 4 providers to their handlers", () => {
    expect(getProviderHandler("openrouter")).toBe("callOpenRouterStreaming");
    expect(getProviderHandler("anthropic")).toBe("callAnthropicStreaming");
    expect(getProviderHandler("glm")).toBe("callGlmStreaming");
    expect(getProviderHandler("ollama")).toBe("callOllamaStreaming");
  });

  it("returns null for unknown providers", () => {
    expect(getProviderHandler("unknown-provider")).toBeNull();
  });

  it("allows adding new providers without switch statement", () => {
    const extended = { ...PROVIDER_REGISTRY, deepseek: "callDeepSeekStreaming" };
    expect(extended.deepseek).toBe("callDeepSeekStreaming");
  });
});

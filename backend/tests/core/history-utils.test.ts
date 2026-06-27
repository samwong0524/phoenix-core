import { describe, it, expect } from "vitest";

// Test the history utility functions from agent-runtime.ts

type HistoryMessage = {
  role: string;
  content: string | Record<string, unknown>;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string;
};

// Replicate the history utility functions from agent-runtime.ts
function historyHasTool(history: HistoryMessage[], toolNames: Set<string>): boolean {
  return history.some((m) => {
    if (m.role === "assistant" && m.tool_calls) {
      return m.tool_calls.some((tc) => toolNames.has(tc.function.name));
    }
    return false;
  });
}

function historyHasSuccessfulTool(history: HistoryMessage[], toolNames: Set<string>): boolean {
  return history.some((m) => {
    if (m.role === "tool" && m.name && toolNames.has(m.name)) {
      try {
        const parsed = typeof m.content === "string" ? JSON.parse(m.content) : m.content;
        return parsed?.ok !== false;
      } catch {
        return false;
      }
    }
    return false;
  });
}

function historyHasSoul(history: HistoryMessage[]): boolean {
  return history.some(
    (m) => m.role === "system" && typeof m.content === "string" && m.content.includes("## Soul")
  );
}

function historyHasSkills(history: HistoryMessage[]): boolean {
  return history.some(
    (m) => m.role === "system" && typeof m.content === "string" && m.content.includes("## Skills")
  );
}

function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function shortId(id: unknown): string {
  if (typeof id === "string") return id.length > 8 ? id.slice(0, 8) : id;
  return String(id).slice(0, 8);
}

function summarizeUserMessage(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length <= 100) return trimmed;
  return trimmed.slice(0, 100) + "...";
}

function extractToolFact(msg: Extract<HistoryMessage, { role: "tool" }>): string | null {
  try {
    const parsed = typeof msg.content === "string" ? JSON.parse(msg.content) : msg.content;
    if (parsed && typeof parsed === "object" && "ok" in parsed) {
      if (parsed.ok === false && parsed.error) {
        return `[${msg.name}] Failed: ${parsed.error}`;
      }
      return null; // success, no need to extract
    }
    return null;
  } catch {
    return null;
  }
}

describe("historyHasTool", () => {
  const tools = new Set(["send_group_message"]);

  it("returns true when assistant has matching tool_calls", () => {
    const history: HistoryMessage[] = [
      { role: "assistant", content: "", tool_calls: [{ id: "1", type: "function", function: { name: "send_group_message", arguments: "{}" } }] },
    ];
    expect(historyHasTool(history, tools)).toBe(true);
  });

  it("returns false when no matching tool calls exist", () => {
    const history: HistoryMessage[] = [
      { role: "assistant", content: "Hello", tool_calls: [] },
    ];
    expect(historyHasTool(history, tools)).toBe(false);
  });

  it("returns false for empty history", () => {
    expect(historyHasTool([], tools)).toBe(false);
  });
});

describe("historyHasSuccessfulTool", () => {
  const tools = new Set(["bash"]);

  it("returns true when bash tool succeeded", () => {
    const history: HistoryMessage[] = [
      { role: "tool", content: JSON.stringify({ ok: true, stdout: "done" }), tool_call_id: "1", name: "bash" },
    ];
    expect(historyHasSuccessfulTool(history, tools)).toBe(true);
  });

  it("returns false when bash tool failed", () => {
    const history: HistoryMessage[] = [
      { role: "tool", content: JSON.stringify({ ok: false, error: "failed" }), tool_call_id: "1", name: "bash" },
    ];
    expect(historyHasSuccessfulTool(history, tools)).toBe(false);
  });

  it("returns false when no matching tool", () => {
    const history: HistoryMessage[] = [
      { role: "tool", content: JSON.stringify({ ok: true }), tool_call_id: "1", name: "memory_add" },
    ];
    expect(historyHasSuccessfulTool(history, new Set(["bash"]))).toBe(false);
  });
});

describe("historyHasSoul", () => {
  it("returns true when system message contains ## Soul", () => {
    const history: HistoryMessage[] = [
      { role: "system", content: "## Soul\nYou are an agent." },
    ];
    expect(historyHasSoul(history)).toBe(true);
  });

  it("returns false without ## Soul marker", () => {
    const history: HistoryMessage[] = [
      { role: "system", content: "You are an agent." },
    ];
    expect(historyHasSoul(history)).toBe(false);
  });
});

describe("historyHasSkills", () => {
  it("returns true when system message contains ## Skills", () => {
    const history: HistoryMessage[] = [
      { role: "system", content: "## Skills\nYou have tools." },
    ];
    expect(historyHasSkills(history)).toBe(true);
  });

  it("returns false without ## Skills marker", () => {
    const history: HistoryMessage[] = [
      { role: "system", content: "You have tools." },
    ];
    expect(historyHasSkills(history)).toBe(false);
  });
});

describe("shortId", () => {
  it("truncates UUIDs to 8 chars", () => {
    expect(shortId("12345678-90ab-cdef-1234-567890abcdef")).toBe("12345678");
  });

  it("returns short IDs as-is", () => {
    expect(shortId("abc")).toBe("abc");
  });
});

describe("summarizeUserMessage", () => {
  it("returns short messages as-is", () => {
    expect(summarizeUserMessage("Hello")).toBe("Hello");
  });

  it("truncates long messages", () => {
    const long = "a".repeat(200);
    expect(summarizeUserMessage(long)).toBe("a".repeat(100) + "...");
  });

  it("trims whitespace", () => {
    expect(summarizeUserMessage("  hello  ")).toBe("hello");
  });
});

describe("extractToolFact", () => {
  it("returns error description for failed tool", () => {
    const msg: HistoryMessage & { role: "tool" } = {
      role: "tool",
      content: JSON.stringify({ ok: false, error: "Permission denied" }),
      tool_call_id: "1",
      name: "bash",
    };
    expect(extractToolFact(msg)).toBe("[bash] Failed: Permission denied");
  });

  it("returns null for successful tool", () => {
    const msg: HistoryMessage & { role: "tool" } = {
      role: "tool",
      content: JSON.stringify({ ok: true, stdout: "done" }),
      tool_call_id: "1",
      name: "bash",
    };
    expect(extractToolFact(msg)).toBeNull();
  });
});

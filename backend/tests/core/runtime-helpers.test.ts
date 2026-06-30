import { describe, it, expect, beforeEach } from "vitest";
import {
  historyHasTool,
  historyHasSuccessfulTool,
  setRuntimeSetting,
  getRuntimeSetting,
  shortId,
  summarizeUserMessage,
  buildTextArray,
  runtimeSettings,
} from "../../src/runtime/agent-helpers";
import type { HistoryMessage } from "../../src/runtime/agent-types";

describe("historyHasTool", () => {
  const tools = new Set(["bash", "send"]);

  it("finds matching tool messages", () => {
    const history: HistoryMessage[] = [
      { role: "tool", content: '{"ok":true}', name: "bash" },
    ];
    expect(historyHasTool(history, tools)).toBe(true);
  });

  it("finds matching tool by second name in set", () => {
    const history: HistoryMessage[] = [
      { role: "tool", content: '{"ok":true}', name: "send" },
    ];
    expect(historyHasTool(history, tools)).toBe(true);
  });

  it("returns false when no matching tools", () => {
    const history: HistoryMessage[] = [
      { role: "tool", content: '{"ok":true}', name: "create" },
    ];
    expect(historyHasTool(history, tools)).toBe(false);
  });

  it("returns false for empty history", () => {
    expect(historyHasTool([], tools)).toBe(false);
  });

  it("ignores non-tool messages", () => {
    const history: HistoryMessage[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    expect(historyHasTool(history, tools)).toBe(false);
  });

  it("ignores tool messages without a name", () => {
    const history: HistoryMessage[] = [
      { role: "tool", content: '{"ok":true}' },
    ];
    expect(historyHasTool(history, tools)).toBe(false);
  });
});

describe("historyHasSuccessfulTool", () => {
  const tools = new Set(["bash"]);

  it("checks for ok:true in subsequent tool messages", () => {
    const history: HistoryMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "bash" } }],
      },
      { role: "tool", content: '{"ok":true,"stdout":"done"}', name: "bash" },
    ];
    expect(historyHasSuccessfulTool(history, tools)).toBe(true);
  });

  it("returns false when tool failed (ok:false)", () => {
    const history: HistoryMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "bash" } }],
      },
      { role: "tool", content: '{"ok":false,"error":"fail"}', name: "bash" },
    ];
    expect(historyHasSuccessfulTool(history, tools)).toBe(false);
  });

  it("returns false when no assistant tool_calls match", () => {
    const history: HistoryMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "create" } }],
      },
      { role: "tool", content: '{"ok":true}', name: "create" },
    ];
    expect(historyHasSuccessfulTool(history, tools)).toBe(false);
  });

  it("returns false for empty history", () => {
    expect(historyHasSuccessfulTool([], tools)).toBe(false);
  });

  it("returns false when tool message has non-JSON content", () => {
    const history: HistoryMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "bash" } }],
      },
      { role: "tool", content: "not-json", name: "bash" },
    ];
    expect(historyHasSuccessfulTool(history, tools)).toBe(false);
  });
});

describe("setRuntimeSetting / getRuntimeSetting", () => {
  beforeEach(() => {
    runtimeSettings.clear();
  });

  it("round-trip: set then get returns the value", () => {
    setRuntimeSetting("freellmapi_model", "gpt-4");
    expect(getRuntimeSetting("freellmapi_model")).toBe("gpt-4");
  });

  it("get returns undefined for unset key", () => {
    expect(getRuntimeSetting("freellmapi_model")).toBeUndefined();
  });

  it("set overwrites previous value", () => {
    setRuntimeSetting("freellmapi_model", "model-a");
    setRuntimeSetting("freellmapi_model", "model-b");
    expect(getRuntimeSetting("freellmapi_model")).toBe("model-b");
  });

  it("throws on invalid value for known setting", () => {
    expect(() => setRuntimeSetting("freellmapi_model", "")).toThrow("Invalid value");
  });

  it("accepts 'auto' as valid model value", () => {
    expect(() => setRuntimeSetting("freellmapi_model", "auto")).not.toThrow();
    expect(getRuntimeSetting("freellmapi_model")).toBe("auto");
  });
});

describe("shortId", () => {
  it("truncates long IDs to 8 chars + ...", () => {
    expect(shortId("12345678-90ab-cdef")).toBe("12345678...");
  });

  it("returns short IDs as-is", () => {
    expect(shortId("abc")).toBe("abc");
  });

  it("returns exactly 8 char IDs as-is", () => {
    expect(shortId("12345678")).toBe("12345678");
  });

  it("handles null/undefined", () => {
    expect(shortId(null)).toBe("");
    expect(shortId(undefined)).toBe("");
  });

  it("handles numeric input", () => {
    expect(shortId(12345)).toBe("12345");
  });
});

describe("summarizeUserMessage", () => {
  it("returns short messages as-is", () => {
    expect(summarizeUserMessage("Hello")).toBe("Hello");
  });

  it("truncates at 120 chars with ...", () => {
    const long = "a".repeat(200);
    const result = summarizeUserMessage(long);
    expect(result).toBe("a".repeat(120) + "...");
    expect(result.length).toBe(123);
  });

  it("truncates at first period if content > 120 chars and period is before 120", () => {
    // Content must be > 120 chars for the period logic to trigger
    const msg = "First sentence here. " + "x".repeat(150);
    expect(msg.length).toBeGreaterThan(120);
    expect(summarizeUserMessage(msg)).toBe("First sentence here.");
  });

  it("returns exactly 120 chars as-is", () => {
    const exact = "a".repeat(120);
    expect(summarizeUserMessage(exact)).toBe(exact);
  });

  it("handles empty string", () => {
    expect(summarizeUserMessage("")).toBe("");
  });
});

describe("buildTextArray", () => {
  it("creates SQL array for empty input", () => {
    const result = buildTextArray([]);
    expect(result).toBeTruthy();
    // The result is a drizzle SQL object
    expect(result).toBeDefined();
  });

  it("creates SQL array for non-empty input", () => {
    const result = buildTextArray(["hello", "world"]);
    expect(result).toBeTruthy();
    expect(result).toBeDefined();
  });

  it("returns different SQL objects for different inputs", () => {
    const empty = buildTextArray([]);
    const nonEmpty = buildTextArray(["test"]);
    // They should be different SQL objects
    expect(empty).not.toBe(nonEmpty);
  });
});

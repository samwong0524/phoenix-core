import { describe, it, expect } from "vitest";
import { compressHistory } from "../../src/runtime/agent-helpers";
import { COMPRESS_TRIGGER, COMPRESS_PROTECT_FIRST, COMPRESS_PROTECT_LAST } from "../../src/runtime/agent-constants";
import type { HistoryMessage } from "../../src/runtime/agent-types";

function makeSystemMsg(content: string): HistoryMessage {
  return { role: "system", content };
}

function makeUserMsg(content: string): HistoryMessage {
  return { role: "user", content };
}

function makeAssistantMsg(content: string): HistoryMessage {
  return { role: "assistant", content };
}

function makeToolMsg(content: string, name: string): HistoryMessage {
  return { role: "tool", content, name };
}

describe("compressHistory", () => {
  it("history shorter than COMPRESS_TRIGGER → no compression", () => {
    const history: HistoryMessage[] = [
      makeSystemMsg("system prompt"),
      makeUserMsg("hello"),
      makeAssistantMsg("hi there"),
    ];
    const originalLength = history.length;
    compressHistory(history);
    expect(history.length).toBe(originalLength);
    expect(history[0].content).toBe("system prompt");
  });

  it("history exactly at COMPRESS_TRIGGER → no compression", () => {
    const history: HistoryMessage[] = [
      makeSystemMsg("sys"),
      ...Array.from({ length: COMPRESS_TRIGGER - 1 }, (_, i) =>
        makeUserMsg(`msg-${i}`)
      ),
    ];
    expect(history.length).toBe(COMPRESS_TRIGGER);
    compressHistory(history);
    // No compression: length should remain the same
    expect(history.length).toBe(COMPRESS_TRIGGER);
  });

  it("history longer than trigger → compresses middle messages", () => {
    // 2 system + 15 non-system = 17 messages (> 12)
    const history: HistoryMessage[] = [
      makeSystemMsg("sys1"),
      makeSystemMsg("sys2"),
      makeUserMsg("first-user"),
      ...Array.from({ length: 12 }, (_, i) => makeAssistantMsg(`middle-${i}`)),
      ...Array.from({ length: 2 }, (_, i) => makeUserMsg(`last-${i}`)),
    ];
    // nonSystem = 15 messages: 1 first + 12 middle + 2 last
    // keepStart = [first-user], keepEnd = last 8, compressed = 12 - 6 = 6 middle messages
    // Wait: keepEnd = last 8 of 15 = indices 7..14, compressed = indices 1..6 = 6 messages
    const originalLen = history.length;
    compressHistory(history);
    // After: 2 protected system + 1 summary + 1 keepStart + 8 keepEnd = 12
    expect(history.length).toBeLessThan(originalLen);
    // Should have: 2 protected system msgs + 1 summary + 1 keepStart + 8 keepEnd = 12
    expect(history.length).toBe(2 + 1 + 1 + COMPRESS_PROTECT_LAST);
  });

  it("first N system messages protected", () => {
    const history: HistoryMessage[] = [
      makeSystemMsg("protected-sys-1"),
      makeSystemMsg("protected-sys-2"),
      makeSystemMsg("unprotected-sys-3"),
      ...Array.from({ length: 15 }, (_, i) => makeUserMsg(`msg-${i}`)),
    ];
    compressHistory(history);
    // First COMPRESS_PROTECT_FIRST (2) system messages should be preserved
    const systemMsgs = history.filter(m => m.role === "system");
    expect(systemMsgs[0].content).toBe("protected-sys-1");
    expect(systemMsgs[1].content).toBe("protected-sys-2");
    // The third system message should NOT be in the result (it's not protected)
    const contents = systemMsgs.map(m => m.content);
    expect(contents).not.toContain("unprotected-sys-3");
  });

  it("last N messages kept intact", () => {
    const lastMessages = Array.from({ length: COMPRESS_PROTECT_LAST }, (_, i) =>
      makeUserMsg(`keep-intact-${i}`)
    );
    const history: HistoryMessage[] = [
      makeSystemMsg("sys"),
      makeUserMsg("first"),
      ...Array.from({ length: 12 }, (_, i) => makeAssistantMsg(`middle-${i}`)),
      ...lastMessages,
    ];
    compressHistory(history);
    // The last COMPRESS_PROTECT_LAST messages should be preserved verbatim
    const tail = history.slice(-COMPRESS_PROTECT_LAST);
    for (let i = 0; i < tail.length; i++) {
      expect(tail[i].content).toBe(`keep-intact-${i}`);
    }
  });

  it("tool facts extracted correctly", () => {
    const history: HistoryMessage[] = [
      makeSystemMsg("sys"),
      makeUserMsg("first"),
      // These will be compressed
      makeToolMsg(JSON.stringify({ ok: true, exitCode: 0 }), "bash"),
      makeToolMsg(JSON.stringify({ ok: true, role: "coder", agentId: "abc12345-xxxx" }), "create"),
      ...Array.from({ length: 10 }, (_, i) => makeUserMsg(`filler-${i}`)),
      ...Array.from({ length: COMPRESS_PROTECT_LAST }, (_, i) => makeUserMsg(`last-${i}`)),
    ];
    // nonSystem = 1 + 2 + 10 + 8 = 21. compressed = indices 1..12 = 12 messages
    compressHistory(history);
    // Find the summary message (contains "[compressed]")
    const summaryMsg = history.find(
      m => m.role === "system" && typeof m.content === "string" && m.content.includes("compressed")
    );
    expect(summaryMsg).toBeDefined();
    const summaryContent = summaryMsg!.content as string;
    // Should contain extracted facts about bash and create
    expect(summaryContent).toContain("bash: exit 0");
    expect(summaryContent).toContain("Created agent");
  });

  it("user messages summarized in compressed output", () => {
    const history: HistoryMessage[] = [
      makeSystemMsg("sys"),
      makeUserMsg("first-msg"),
      makeUserMsg("This is a user message that should be summarized"),
      ...Array.from({ length: 12 }, (_, i) => makeAssistantMsg(`filler-${i}`)),
      ...Array.from({ length: COMPRESS_PROTECT_LAST }, (_, i) => makeUserMsg(`last-${i}`)),
    ];
    compressHistory(history);
    const summaryMsg = history.find(
      m => m.role === "system" && typeof m.content === "string" && m.content.includes("compressed")
    );
    expect(summaryMsg).toBeDefined();
    const summaryContent = summaryMsg!.content as string;
    expect(summaryContent).toContain("User:");
  });

  it("compressed summary is inserted as system message", () => {
    const history: HistoryMessage[] = [
      makeSystemMsg("sys1"),
      makeSystemMsg("sys2"),
      makeUserMsg("first"),
      ...Array.from({ length: 14 }, (_, i) => makeAssistantMsg(`mid-${i}`)),
      ...Array.from({ length: COMPRESS_PROTECT_LAST }, (_, i) => makeUserMsg(`last-${i}`)),
    ];
    compressHistory(history);
    // After protected system messages, there should be a summary system message
    expect(history[0].role).toBe("system");
    expect(history[1].role).toBe("system");
    expect(history[2].role).toBe("system");
    expect((history[2].content as string)).toContain("compressed");
  });
});

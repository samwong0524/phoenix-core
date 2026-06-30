import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mapOpenRouterMessages,
  buildSkillsBlock,
  loadSoulMd,
  invalidateSoulCache,
  historyHasSoul,
  historyHasSkills,
  extractToolFact,
  summarizeUserMessage,
} from "../../src/runtime/agent-helpers";
import type { HistoryMessage } from "../../src/runtime/agent-types";

// Mock skill-loader
vi.mock("../../src/runtime/skill-loader", () => ({
  getSkillLoader: vi.fn(),
  getSkillDirectory: vi.fn(() => "/tmp/skills"),
}));

// Mock fs/promises for loadSoulMd
vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
  },
  readFile: vi.fn(),
}));

describe("mapOpenRouterMessages", () => {
  it("moves system messages to the front", () => {
    const history: HistoryMessage[] = [
      { role: "user", content: "hello" },
      { role: "system", content: "you are helpful" },
      { role: "assistant", content: "hi" },
    ];
    const result = mapOpenRouterMessages(history);
    expect(result[0].role).toBe("system");
    expect(result[1].role).toBe("user");
    expect(result[2].role).toBe("assistant");
  });

  it("maps reasoning_content to reasoning for assistant messages", () => {
    const history: HistoryMessage[] = [
      { role: "assistant", content: "answer", reasoning_content: "thinking..." },
    ];
    const result = mapOpenRouterMessages(history);
    expect(result[0].reasoning).toBe("thinking...");
  });

  it("does not map reasoning_content for user messages", () => {
    const history: HistoryMessage[] = [
      { role: "user", content: "hello", reasoning_content: "should not appear" },
    ];
    const result = mapOpenRouterMessages(history);
    expect(result[0].reasoning).toBeUndefined();
  });

  it("converts null content to empty string", () => {
    const history: HistoryMessage[] = [
      { role: "assistant", content: null as unknown as string },
    ];
    const result = mapOpenRouterMessages(history);
    expect(result[0].content).toBe("");
  });

  it("converts undefined content to empty string", () => {
    const history: HistoryMessage[] = [
      { role: "assistant", content: undefined as unknown as string },
    ];
    const result = mapOpenRouterMessages(history);
    expect(result[0].content).toBe("");
  });

  it("normalizes tool_calls arguments from object to JSON string", () => {
    const history: HistoryMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "tc1",
            type: "function",
            function: {
              name: "bash",
              arguments: { command: "ls" } as unknown as string,
            },
          },
        ],
      },
    ];
    const result = mapOpenRouterMessages(history);
    const tc = (result[0].tool_calls as Array<Record<string, unknown>>)[0];
    const fn = tc.function as Record<string, unknown>;
    expect(fn.arguments).toBe('{"command":"ls"}');
  });

  it("replaces invalid JSON string arguments with '{}'", () => {
    const history: HistoryMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "tc1",
            type: "function",
            function: {
              name: "bash",
              arguments: "not valid json {",
            },
          },
        ],
      },
    ];
    const result = mapOpenRouterMessages(history);
    const tc = (result[0].tool_calls as Array<Record<string, unknown>>)[0];
    const fn = tc.function as Record<string, unknown>;
    expect(fn.arguments).toBe("{}");
  });

  it("keeps valid JSON string arguments as-is", () => {
    const history: HistoryMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "tc1",
            type: "function",
            function: {
              name: "bash",
              arguments: '{"command":"ls"}',
            },
          },
        ],
      },
    ];
    const result = mapOpenRouterMessages(history);
    const tc = (result[0].tool_calls as Array<Record<string, unknown>>)[0];
    const fn = tc.function as Record<string, unknown>;
    expect(fn.arguments).toBe('{"command":"ls"}');
  });

  it("sets arguments to '{}' when arguments is neither string nor object", () => {
    const history: HistoryMessage[] = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "tc1",
            type: "function",
            function: {
              name: "bash",
              arguments: 42 as unknown as string,
            },
          },
        ],
      },
    ];
    const result = mapOpenRouterMessages(history);
    const tc = (result[0].tool_calls as Array<Record<string, unknown>>)[0];
    const fn = tc.function as Record<string, unknown>;
    expect(fn.arguments).toBe("{}");
  });

  it("passes tool role messages through unchanged", () => {
    const history: HistoryMessage[] = [
      { role: "tool", content: '{"ok":true}', name: "bash", tool_call_id: "tc1" },
    ];
    const result = mapOpenRouterMessages(history);
    expect(result[0]).toEqual(history[0]);
  });

  it("handles empty history", () => {
    expect(mapOpenRouterMessages([])).toEqual([]);
  });
});

describe("buildSkillsBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty string when loader throws", async () => {
    const { getSkillLoader } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillLoader).mockRejectedValue(new Error("fail"));
    const result = await buildSkillsBlock();
    expect(result).toBe("");
  });

  it("returns skills block with listed skills", async () => {
    const { getSkillLoader } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillLoader).mockResolvedValue({
      listAutoLoadSkills: vi.fn().mockResolvedValue([
        { name: "skill-a", description: "Does A" },
        { name: "skill-b", description: "Does B" },
      ]),
    } as any);

    const result = await buildSkillsBlock();
    expect(result).toContain("[skills:loaded]");
    expect(result).toContain("skill-a");
    expect(result).toContain("skill-b");
  });

  it("filters out skills with missing dependencies", async () => {
    const { getSkillLoader } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillLoader).mockResolvedValue({
      listAutoLoadSkills: vi.fn().mockResolvedValue([
        { name: "skill-a", description: "Does A", requires: ["skill-missing"] },
        { name: "skill-b", description: "Does B" },
      ]),
    } as any);

    const result = await buildSkillsBlock();
    expect(result).not.toContain("skill-a");
    expect(result).toContain("skill-b");
  });

  it("filters by role when role is provided", async () => {
    const { getSkillLoader } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillLoader).mockResolvedValue({
      listAutoLoadSkills: vi.fn().mockResolvedValue([
        { name: "skill-dev", description: "Dev skill", metadata: { roles: ["developer"] } },
        { name: "skill-pm", description: "PM skill", metadata: { roles: ["pm"] } },
      ]),
    } as any);

    const result = await buildSkillsBlock("developer");
    expect(result).toContain("skill-dev");
    expect(result).not.toContain("skill-pm");
  });

  it("includes skills without roles when role filter is provided", async () => {
    const { getSkillLoader } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillLoader).mockResolvedValue({
      listAutoLoadSkills: vi.fn().mockResolvedValue([
        { name: "skill-general", description: "General skill" },
        { name: "skill-dev", description: "Dev skill", metadata: { roles: ["developer"] } },
      ]),
    } as any);

    const result = await buildSkillsBlock("pm");
    expect(result).toContain("skill-general");
    expect(result).not.toContain("skill-dev");
  });

  it("handles roles as comma-separated string", async () => {
    const { getSkillLoader } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillLoader).mockResolvedValue({
      listAutoLoadSkills: vi.fn().mockResolvedValue([
        { name: "skill-x", description: "X skill", metadata: { roles: "dev, pm" } },
      ]),
    } as any);

    const result = await buildSkillsBlock("pm");
    expect(result).toContain("skill-x");
  });

  it("returns empty string when no skills match", async () => {
    const { getSkillLoader } = await import("../../src/runtime/skill-loader");
    vi.mocked(getSkillLoader).mockResolvedValue({
      listAutoLoadSkills: vi.fn().mockResolvedValue([]),
    } as any);

    const result = await buildSkillsBlock();
    expect(result).toBe("");
  });
});

describe("loadSoulMd / invalidateSoulCache", () => {
  beforeEach(async () => {
    invalidateSoulCache();
    vi.clearAllMocks();
  });

  it("returns soul content prefixed with marker when file exists", async () => {
    const fsPromises = await import("fs/promises");
    vi.mocked(fsPromises.readFile).mockResolvedValue("You are a helpful agent.\n");

    const result = await loadSoulMd();
    expect(result).toContain("[soul:loaded]");
    expect(result).toContain("You are a helpful agent.");
  });

  it("returns empty string when file does not exist", async () => {
    const fsPromises = await import("fs/promises");
    vi.mocked(fsPromises.readFile).mockRejectedValue(new Error("ENOENT"));

    const result = await loadSoulMd();
    expect(result).toBe("");
  });

  it("caches the result on subsequent calls", async () => {
    const fsPromises = await import("fs/promises");
    vi.mocked(fsPromises.readFile).mockResolvedValue("Soul content");

    const result1 = await loadSoulMd();
    const result2 = await loadSoulMd();
    expect(result1).toBe(result2);
    // readFile should only be called once due to caching
    expect(fsPromises.readFile).toHaveBeenCalledTimes(1);
  });

  it("invalidateSoulCache forces reload on next call", async () => {
    const fsPromises = await import("fs/promises");
    vi.mocked(fsPromises.readFile).mockResolvedValue("First content");
    await loadSoulMd();

    invalidateSoulCache();
    vi.mocked(fsPromises.readFile).mockResolvedValue("Second content");
    const result = await loadSoulMd();
    expect(result).toContain("Second content");
    expect(fsPromises.readFile).toHaveBeenCalledTimes(2);
  });
});

describe("historyHasSoul", () => {
  it("returns true when system message contains SOUL_MARKER", () => {
    const history: HistoryMessage[] = [
      { role: "system", content: "[soul:loaded]\nYou are an agent." },
    ];
    expect(historyHasSoul(history)).toBe(true);
  });

  it("returns false when no system message has SOUL_MARKER", () => {
    const history: HistoryMessage[] = [
      { role: "system", content: "You are an agent." },
    ];
    expect(historyHasSoul(history)).toBe(false);
  });

  it("returns false for empty history", () => {
    expect(historyHasSoul([])).toBe(false);
  });

  it("ignores non-system messages with the marker", () => {
    const history: HistoryMessage[] = [
      { role: "user", content: "[soul:loaded]" },
    ];
    expect(historyHasSoul(history)).toBe(false);
  });
});

describe("historyHasSkills", () => {
  it("returns true when system message contains SKILLS_MARKER", () => {
    const history: HistoryMessage[] = [
      { role: "system", content: "[skills:loaded]\nYou have tools." },
    ];
    expect(historyHasSkills(history)).toBe(true);
  });

  it("returns false when no system message has SKILLS_MARKER", () => {
    const history: HistoryMessage[] = [
      { role: "system", content: "You have tools." },
    ];
    expect(historyHasSkills(history)).toBe(false);
  });

  it("returns false for empty history", () => {
    expect(historyHasSkills([])).toBe(false);
  });
});

describe("extractToolFact", () => {
  it("returns null for 'self' tool", () => {
    const msg = { role: "tool" as const, content: '{"ok":true}', name: "self" };
    expect(extractToolFact(msg)).toBeNull();
  });

  it("returns null for 'get_skill' tool", () => {
    const msg = { role: "tool" as const, content: '{"ok":true}', name: "get_skill" };
    expect(extractToolFact(msg)).toBeNull();
  });

  it("handles 'create' success", () => {
    const msg = { role: "tool" as const, content: '{"ok":true,"role":"dev","agentId":"12345678-abcd"}', name: "create" };
    expect(extractToolFact(msg)).toContain('Created agent(role="dev"');
  });

  it("handles 'create' failure", () => {
    const msg = { role: "tool" as const, content: '{"ok":false,"error":"quota exceeded"}', name: "create" };
    expect(extractToolFact(msg)).toContain("Create agent failed");
  });

  it("handles 'create_group' success", () => {
    const msg = { role: "tool" as const, content: '{"ok":true,"name":"team","groupId":"abcdef12-3456"}', name: "create_group" };
    expect(extractToolFact(msg)).toContain('Created group(name="team"');
  });

  it("handles 'create_group' failure", () => {
    const msg = { role: "tool" as const, content: '{"ok":false,"error":"exists"}', name: "create_group" };
    expect(extractToolFact(msg)).toContain("Create group failed");
  });

  it("handles 'add_group_members' success", () => {
    const msg = { role: "tool" as const, content: '{"ok":true,"addedMembersIds":["a","b"],"groupId":"grp1234567"}', name: "add_group_members" };
    expect(extractToolFact(msg)).toContain("Added 2 members");
  });

  it("handles 'delete_agent' success", () => {
    const msg = { role: "tool" as const, content: '{"ok":true,"role":"dev"}', name: "delete_agent" };
    expect(extractToolFact(msg)).toContain('Deleted agent(role="dev")');
  });

  it("handles 'delete_group' success", () => {
    const msg = { role: "tool" as const, content: '{"ok":true,"groupId":"grp1234567"}', name: "delete_group" };
    expect(extractToolFact(msg)).toContain("Deleted group");
  });

  it("handles 'send' success", () => {
    const msg = { role: "tool" as const, content: '{"ok":true,"groupId":"grp1234567"}', name: "send" };
    expect(extractToolFact(msg)).toContain("Sent message to");
  });

  it("handles 'send' failure returns null", () => {
    const msg = { role: "tool" as const, content: '{"ok":false}', name: "send" };
    expect(extractToolFact(msg)).toBeNull();
  });

  it("handles 'bash' with exitCode", () => {
    const msg = { role: "tool" as const, content: '{"exitCode":0}', name: "bash" };
    expect(extractToolFact(msg)).toBe("bash: exit 0");
  });

  it("handles 'bash' with signal", () => {
    const msg = { role: "tool" as const, content: '{"signal":"SIGTERM"}', name: "bash" };
    expect(extractToolFact(msg)).toBe("bash: exit signal SIGTERM");
  });

  it("handles 'bash' with no exit info", () => {
    const msg = { role: "tool" as const, content: '{}', name: "bash" };
    expect(extractToolFact(msg)).toBe("bash: exit ?");
  });

  it("handles 'list_agents' success", () => {
    const msg = { role: "tool" as const, content: '{"ok":true,"agents":[1,2,3]}', name: "list_agents" };
    expect(extractToolFact(msg)).toContain("Listed 3 agents");
  });

  it("handles 'list_groups' success", () => {
    const msg = { role: "tool" as const, content: '{"ok":true,"groups":[1]}', name: "list_groups" };
    expect(extractToolFact(msg)).toContain("Listed 1 groups");
  });

  it("handles 'list_group_members' success", () => {
    const msg = { role: "tool" as const, content: '{"ok":true,"members":["a","b"]}', name: "list_group_members" };
    expect(extractToolFact(msg)).toContain("Listed 2 members");
  });

  it("handles 'get_group_messages' success", () => {
    const msg = { role: "tool" as const, content: '{"ok":true,"messages":[1,2],"groupId":"grp1234567"}', name: "get_group_messages" };
    expect(extractToolFact(msg)).toContain("Read 2 messages");
  });

  it("handles 'get_workflow_status' with workflow", () => {
    const msg = { role: "tool" as const, content: '{"ok":true,"workflow":{"name":"deploy","status":"running"},"tasks":[1]}', name: "get_workflow_status" };
    expect(extractToolFact(msg)).toContain("Workflow: deploy");
    expect(extractToolFact(msg)).toContain("status=running");
  });

  it("handles 'get_workflow_status' without workflow", () => {
    const msg = { role: "tool" as const, content: '{"ok":true,"workflow":null}', name: "get_workflow_status" };
    expect(extractToolFact(msg)).toBe("No workflow found");
  });

  it("handles 'create_skill' success", () => {
    const msg = { role: "tool" as const, content: '{"ok":true,"path":"/skills/test"}', name: "create_skill" };
    expect(extractToolFact(msg)).toContain('Created skill at "/skills/test"');
  });

  it("handles 'create_skill' failure", () => {
    const msg = { role: "tool" as const, content: '{"ok":false,"error":"invalid"}', name: "create_skill" };
    expect(extractToolFact(msg)).toContain("Create skill failed");
  });

  it("handles 'delete_agent' failure", () => {
    const msg = { role: "tool" as const, content: '{"ok":false,"error":"not found"}', name: "delete_agent" };
    expect(extractToolFact(msg)).toContain("Delete agent failed");
  });

  it("handles 'delete_group' failure", () => {
    const msg = { role: "tool" as const, content: '{"ok":false,"error":"not found"}', name: "delete_group" };
    expect(extractToolFact(msg)).toContain("Delete group failed");
  });

  it("handles 'add_group_members' failure", () => {
    const msg = { role: "tool" as const, content: '{"ok":false,"error":"forbidden"}', name: "add_group_members" };
    expect(extractToolFact(msg)).toContain("Add members failed");
  });

  it("handles unknown tool with ok=true", () => {
    const msg = { role: "tool" as const, content: '{"ok":true}', name: "custom_tool" };
    expect(extractToolFact(msg)).toBe("custom_tool: ok");
  });

  it("handles unknown tool with ok=false", () => {
    const msg = { role: "tool" as const, content: '{"ok":false}', name: "custom_tool" };
    expect(extractToolFact(msg)).toBe("custom_tool: failed");
  });

  it("handles tool message with non-string content", () => {
    const msg = { role: "tool" as const, content: { ok: true } as unknown as string, name: "custom_tool" };
    expect(extractToolFact(msg)).toBe("custom_tool: ok");
  });

  it("handles tool message with no name", () => {
    const msg = { role: "tool" as const, content: '{"ok":true}', name: undefined };
    expect(extractToolFact(msg)).toBe("unknown: ok");
  });

  it("handles 'send_group_message' success", () => {
    const msg = { role: "tool" as const, content: '{"ok":true,"groupId":"grp1234567"}', name: "send_group_message" };
    expect(extractToolFact(msg)).toContain("Sent message to");
  });

  it("handles 'send_direct_message' success", () => {
    const msg = { role: "tool" as const, content: '{"ok":true,"toId":"usr1234567"}', name: "send_direct_message" };
    expect(extractToolFact(msg)).toContain("Sent message to");
  });

  it("handles 'list_agents' failure returns null", () => {
    const msg = { role: "tool" as const, content: '{"ok":false}', name: "list_agents" };
    expect(extractToolFact(msg)).toBeNull();
  });
});

describe("summarizeUserMessage (additional)", () => {
  it("truncates at period when content > 120 and period < 120", () => {
    const msg = "Short sentence. " + "x".repeat(150);
    expect(msg.length).toBeGreaterThan(120);
    const result = summarizeUserMessage(msg);
    expect(result).toBe("Short sentence.");
  });

  it("does not use period logic when period is after 120 chars", () => {
    const msg = "x".repeat(130) + ". end";
    const result = summarizeUserMessage(msg);
    expect(result).toBe("x".repeat(120) + "...");
  });

  it("does not use period logic when period is at position 0", () => {
    const msg = "." + "x".repeat(150);
    const result = summarizeUserMessage(msg);
    // dot is at position 0, condition `dot > 0` is false, so falls through to truncation
    expect(result).toBe(msg.slice(0, 120) + "...");
    expect(result.length).toBe(123);
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetToolDefinitions = vi.fn(() => []);
const mockGetMcpRegistry = vi.fn(async () => ({
  getToolDefinitions: mockGetToolDefinitions,
}));

vi.mock("@/runtime/mcp", () => ({
  getMcpRegistry: (...args: any[]) => mockGetMcpRegistry(...args),
}));

import {
  TOOL_AVAILABILITY,
  getAgentTools,
  BUILTIN_TOOL_NAMES,
  AGENT_TOOLS,
  AGENT_TOOLS_AGENT,
  AGENT_TOOLS_SKILL,
  AGENT_TOOLS_MESSAGE,
  AGENT_TOOLS_GROUP,
  AGENT_TOOLS_EXECUTION,
  AGENT_TOOLS_WORKFLOW,
  AGENT_TOOLS_MEMORY,
  AGENT_TOOLS_BACKUP,
  AGENT_TOOLS_INTERACTION,
} from "@/runtime/agent-tools";
import type { ToolContext } from "@/runtime/agent-tools";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    agentId: "agent-1",
    isCoordinator: false,
    hasActiveWorkflow: false,
    shellEnabled: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── BUILTIN_TOOL_NAMES ──────────────────────────────────────────────────────

describe("BUILTIN_TOOL_NAMES", () => {
  it("contains all agent tool names", () => {
    const expectedNames = [
      // Agent
      "create", "self", "list_agents", "delete_agent", "reload_soul",
      // Skill
      "get_skill", "create_skill", "search_skill", "install_skill",
      // Message
      "send", "send_group_message", "send_direct_message", "get_group_messages", "get_message_detail",
      // Group
      "list_groups", "list_group_members", "create_group", "add_group_members", "delete_group",
      // Execution
      "bash", "read_file",
      // Workflow
      "create_workflow", "update_task", "get_workflow_status", "assign_agent", "dispatch_pipeline",
      // Memory
      "memory_add", "memory_search", "memory_replace", "memory_remove", "session_search",
      // Backup
      "create_backup", "list_backups", "restore_backup",
      // Interaction
      "ask_user",
    ];
    for (const name of expectedNames) {
      expect(BUILTIN_TOOL_NAMES.has(name)).toBe(true);
    }
  });

  it("has the correct total count", () => {
    expect(BUILTIN_TOOL_NAMES.size).toBe(AGENT_TOOLS.length);
  });

  it("is a Set", () => {
    expect(BUILTIN_TOOL_NAMES).toBeInstanceOf(Set);
  });
});

// ─── AGENT_TOOLS structure ───────────────────────────────────────────────────

describe("AGENT_TOOLS structure", () => {
  it("every tool has type 'function'", () => {
    for (const tool of AGENT_TOOLS) {
      expect(tool.type).toBe("function");
    }
  });

  it("every tool has a non-empty name", () => {
    for (const tool of AGENT_TOOLS) {
      expect(tool.function.name).toBeTruthy();
      expect(typeof tool.function.name).toBe("string");
    }
  });

  it("every tool has a non-empty description", () => {
    for (const tool of AGENT_TOOLS) {
      expect(tool.function.description).toBeTruthy();
      expect(typeof tool.function.description).toBe("string");
    }
  });

  it("every tool has parameters object", () => {
    for (const tool of AGENT_TOOLS) {
      expect(tool.function.parameters).toBeDefined();
      expect(typeof tool.function.parameters).toBe("object");
    }
  });

  it("tool names are unique", () => {
    const names = AGENT_TOOLS.map(t => t.function.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it("AGENT_TOOLS equals the concatenation of all group arrays", () => {
    const totalGrouped =
      AGENT_TOOLS_AGENT.length +
      AGENT_TOOLS_SKILL.length +
      AGENT_TOOLS_MESSAGE.length +
      AGENT_TOOLS_GROUP.length +
      AGENT_TOOLS_EXECUTION.length +
      AGENT_TOOLS_WORKFLOW.length +
      AGENT_TOOLS_MEMORY.length +
      AGENT_TOOLS_BACKUP.length +
      AGENT_TOOLS_INTERACTION.length;
    expect(AGENT_TOOLS.length).toBe(totalGrouped);
  });
});

// ─── TOOL_AVAILABILITY ───────────────────────────────────────────────────────

describe("TOOL_AVAILABILITY", () => {
  describe("update_task", () => {
    it("available when workflow is active", () => {
      expect(TOOL_AVAILABILITY.update_task(makeContext({ hasActiveWorkflow: true }))).toBe(true);
    });

    it("unavailable when no active workflow", () => {
      expect(TOOL_AVAILABILITY.update_task(makeContext({ hasActiveWorkflow: false }))).toBe(false);
    });
  });

  describe("get_workflow_status", () => {
    it("available when workflow is active", () => {
      expect(TOOL_AVAILABILITY.get_workflow_status(makeContext({ hasActiveWorkflow: true }))).toBe(true);
    });

    it("unavailable when no active workflow", () => {
      expect(TOOL_AVAILABILITY.get_workflow_status(makeContext({ hasActiveWorkflow: false }))).toBe(false);
    });
  });

  describe("assign_agent", () => {
    it("available when workflow active AND is coordinator", () => {
      expect(TOOL_AVAILABILITY.assign_agent(makeContext({ hasActiveWorkflow: true, isCoordinator: true }))).toBe(true);
    });

    it("unavailable when workflow active but not coordinator", () => {
      expect(TOOL_AVAILABILITY.assign_agent(makeContext({ hasActiveWorkflow: true, isCoordinator: false }))).toBe(false);
    });

    it("unavailable when no active workflow even if coordinator", () => {
      expect(TOOL_AVAILABILITY.assign_agent(makeContext({ hasActiveWorkflow: false, isCoordinator: true }))).toBe(false);
    });
  });

  describe("create_workflow", () => {
    it("available for coordinator", () => {
      expect(TOOL_AVAILABILITY.create_workflow(makeContext({ isCoordinator: true }))).toBe(true);
    });

    it("unavailable for non-coordinator", () => {
      expect(TOOL_AVAILABILITY.create_workflow(makeContext({ isCoordinator: false }))).toBe(false);
    });
  });

  describe("delete_group", () => {
    it("available for coordinator", () => {
      expect(TOOL_AVAILABILITY.delete_group(makeContext({ isCoordinator: true }))).toBe(true);
    });

    it("unavailable for non-coordinator", () => {
      expect(TOOL_AVAILABILITY.delete_group(makeContext({ isCoordinator: false }))).toBe(false);
    });
  });

  describe("bash", () => {
    it("available when shell is enabled", () => {
      expect(TOOL_AVAILABILITY.bash(makeContext({ shellEnabled: true }))).toBe(true);
    });

    it("unavailable when shell is disabled", () => {
      expect(TOOL_AVAILABILITY.bash(makeContext({ shellEnabled: false }))).toBe(false);
    });
  });

  describe("read_file", () => {
    it("always available regardless of context", () => {
      expect(TOOL_AVAILABILITY.read_file(makeContext())).toBe(true);
      expect(TOOL_AVAILABILITY.read_file(makeContext({ shellEnabled: false, isCoordinator: false }))).toBe(true);
    });
  });

  it("tools not in TOOL_AVAILABILITY are always available (no check function)", () => {
    // 'send', 'create', 'self', etc. have no entry in TOOL_AVAILABILITY
    expect(TOOL_AVAILABILITY["send"]).toBeUndefined();
    expect(TOOL_AVAILABILITY["create"]).toBeUndefined();
    expect(TOOL_AVAILABILITY["memory_add"]).toBeUndefined();
  });
});

// ─── getAgentTools ───────────────────────────────────────────────────────────

describe("getAgentTools", () => {
  it("returns all tools when no context is provided", async () => {
    const tools = await getAgentTools();
    // Should include all builtin tools + any MCP tools (mocked as empty)
    expect(tools.length).toBe(AGENT_TOOLS.length);
  });

  it("filters out workflow tools when no active workflow", async () => {
    const ctx = makeContext({ hasActiveWorkflow: false, isCoordinator: true, shellEnabled: true });
    const tools = await getAgentTools(ctx);
    const toolNames = tools.map(t => t.function.name);
    expect(toolNames).not.toContain("update_task");
    expect(toolNames).not.toContain("get_workflow_status");
    expect(toolNames).not.toContain("assign_agent");
  });

  it("includes workflow tools when workflow is active", async () => {
    const ctx = makeContext({ hasActiveWorkflow: true, isCoordinator: true, shellEnabled: true });
    const tools = await getAgentTools(ctx);
    const toolNames = tools.map(t => t.function.name);
    expect(toolNames).toContain("update_task");
    expect(toolNames).toContain("get_workflow_status");
    expect(toolNames).toContain("assign_agent");
  });

  it("filters out bash when shell is disabled", async () => {
    const ctx = makeContext({ shellEnabled: false });
    const tools = await getAgentTools(ctx);
    const toolNames = tools.map(t => t.function.name);
    expect(toolNames).not.toContain("bash");
  });

  it("includes bash when shell is enabled", async () => {
    const ctx = makeContext({ shellEnabled: true });
    const tools = await getAgentTools(ctx);
    const toolNames = tools.map(t => t.function.name);
    expect(toolNames).toContain("bash");
  });

  it("filters out coordinator-only tools for non-coordinator", async () => {
    const ctx = makeContext({ isCoordinator: false, hasActiveWorkflow: true });
    const tools = await getAgentTools(ctx);
    const toolNames = tools.map(t => t.function.name);
    expect(toolNames).not.toContain("create_workflow");
    expect(toolNames).not.toContain("delete_group");
  });

  it("includes coordinator tools for coordinator", async () => {
    const ctx = makeContext({ isCoordinator: true, hasActiveWorkflow: true });
    const tools = await getAgentTools(ctx);
    const toolNames = tools.map(t => t.function.name);
    expect(toolNames).toContain("create_workflow");
    expect(toolNames).toContain("delete_group");
  });

  it("always includes read_file regardless of context", async () => {
    const ctx = makeContext({ shellEnabled: false, isCoordinator: false, hasActiveWorkflow: false });
    const tools = await getAgentTools(ctx);
    const toolNames = tools.map(t => t.function.name);
    expect(toolNames).toContain("read_file");
  });

  it("appends MCP tools to the result", async () => {
    const mcpTool = {
      type: "function" as const,
      function: { name: "mcp_custom_tool", description: "MCP tool", parameters: {} },
    };
    mockGetToolDefinitions.mockReturnValue([mcpTool]);

    const tools = await getAgentTools();
    const toolNames = tools.map(t => t.function.name);
    expect(toolNames).toContain("mcp_custom_tool");
  });
});

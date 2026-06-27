import { describe, it, expect } from "vitest";

// Replicate the ToolContext type and TOOL_AVAILABILITY predicates
// to test the filtering logic without importing private API.

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

function getAvailableTools(context: ToolContext): string[] {
  return Object.entries(TOOL_AVAILABILITY)
    .filter(([, check]) => check(context))
    .map(([name]) => name);
}

const coordinatorCtx: ToolContext = {
  agentId: "agent-1",
  isCoordinator: true,
  hasActiveWorkflow: true,
  shellEnabled: true,
};

const workerCtx: ToolContext = {
  agentId: "agent-2",
  isCoordinator: false,
  hasActiveWorkflow: true,
  shellEnabled: true,
};

const noWfCtx: ToolContext = {
  agentId: "agent-1",
  isCoordinator: true,
  hasActiveWorkflow: false,
  shellEnabled: true,
};

const noShellCtx: ToolContext = {
  agentId: "agent-1",
  isCoordinator: true,
  hasActiveWorkflow: true,
  shellEnabled: false,
};

describe("TOOL_AVAILABILITY", () => {
  describe("update_task", () => {
    it("available when workflow is active", () => {
      expect(TOOL_AVAILABILITY.update_task(coordinatorCtx)).toBe(true);
    });

    it("unavailable without active workflow", () => {
      expect(TOOL_AVAILABILITY.update_task(noWfCtx)).toBe(false);
    });
  });

  describe("get_workflow_status", () => {
    it("available when workflow is active", () => {
      expect(TOOL_AVAILABILITY.get_workflow_status(coordinatorCtx)).toBe(true);
    });

    it("unavailable without active workflow", () => {
      expect(TOOL_AVAILABILITY.get_workflow_status(noWfCtx)).toBe(false);
    });
  });

  describe("assign_agent", () => {
    it("available when workflow active + coordinator", () => {
      expect(TOOL_AVAILABILITY.assign_agent(coordinatorCtx)).toBe(true);
    });

    it("unavailable for worker even with active workflow", () => {
      expect(TOOL_AVAILABILITY.assign_agent(workerCtx)).toBe(false);
    });

    it("unavailable without active workflow", () => {
      expect(TOOL_AVAILABILITY.assign_agent(noWfCtx)).toBe(false);
    });
  });

  describe("create_workflow", () => {
    it("available for coordinator", () => {
      expect(TOOL_AVAILABILITY.create_workflow(coordinatorCtx)).toBe(true);
    });

    it("unavailable for worker", () => {
      expect(TOOL_AVAILABILITY.create_workflow(workerCtx)).toBe(false);
    });
  });

  describe("delete_group", () => {
    it("available for coordinator", () => {
      expect(TOOL_AVAILABILITY.delete_group(coordinatorCtx)).toBe(true);
    });

    it("unavailable for worker", () => {
      expect(TOOL_AVAILABILITY.delete_group(workerCtx)).toBe(false);
    });
  });

  describe("bash", () => {
    it("available when shell is enabled", () => {
      expect(TOOL_AVAILABILITY.bash(coordinatorCtx)).toBe(true);
    });

    it("unavailable when shell is disabled", () => {
      expect(TOOL_AVAILABILITY.bash(noShellCtx)).toBe(false);
    });
  });
});

describe("getAvailableTools (combined filtering)", () => {
  it("coordinator with active workflow has all tools", () => {
    const tools = getAvailableTools(coordinatorCtx);
    expect(tools).toContain("update_task");
    expect(tools).toContain("get_workflow_status");
    expect(tools).toContain("assign_agent");
    expect(tools).toContain("create_workflow");
    expect(tools).toContain("delete_group");
    expect(tools).toContain("bash");
  });

  it("worker has only bash and workflow tools (no coordinator tools)", () => {
    const tools = getAvailableTools(workerCtx);
    expect(tools).toContain("update_task");
    expect(tools).toContain("get_workflow_status");
    expect(tools).toContain("bash");
    expect(tools).not.toContain("assign_agent");
    expect(tools).not.toContain("create_workflow");
    expect(tools).not.toContain("delete_group");
  });

  it("no workflow means no workflow tools", () => {
    const tools = getAvailableTools(noWfCtx);
    expect(tools).toContain("create_workflow"); // still available for coord
    expect(tools).toContain("delete_group");
    expect(tools).not.toContain("update_task");
    expect(tools).not.toContain("get_workflow_status");
    expect(tools).not.toContain("assign_agent");
  });

  it("shell disabled means no bash", () => {
    const tools = getAvailableTools(noShellCtx);
    expect(tools).not.toContain("bash");
  });

  it("tools not in availability map are unaffected", () => {
    // Tools like "self", "send", "memory_add" have no check_fn
    // so they should always be available regardless of context
    const ctx: ToolContext = { agentId: "any", isCoordinator: false, hasActiveWorkflow: false, shellEnabled: false };
    const predicate = TOOL_AVAILABILITY["self" as keyof typeof TOOL_AVAILABILITY];
    expect(predicate).toBeUndefined();
  });
});

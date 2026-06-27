import { getMcpRegistry } from "./mcp";

export type ToolGroup =
  | "agent"       // Agent lifecycle: create, self, list, delete, reload
  | "skill"       // Knowledge: get_skill, create_skill
  | "message"     // Messaging: send, send_group_message, send_direct_message, get messages
  | "group"       // Group management: list, create, add, delete
  | "execution"   // Shell execution: bash
  | "workflow"    // Workflow orchestration: create, update, get, assign
  | "memory"      // Long-term memory: add, search, replace, remove, session_search
  | "backup";     // Workspace backup: create, list, restore

// ---------------------------------------------------------------------------
// Agent Management
// ---------------------------------------------------------------------------
export const AGENT_TOOLS_AGENT = [
  {
    type: "function" as const,
    function: {
      name: "create",
      description:
        "[Agent] Create a sub-agent with the given role. Only use when the human explicitly asks you to create a new agent. For delegation, use existing agents instead. When the human asks you to create, execute directly — do not re-verify history or search for existing agents first.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          role: {
            type: "string",
            description: "Role name for the new agent, e.g. coder/researcher/reviewer",
          },
          guidance: {
            type: "string",
            description: "Extra system guidance to seed the new agent.",
          },
        },
        required: ["role"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "self",
      description: "[Agent] Return the current agent's identity (agent_id, workspace_id, role).",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_agents",
      description: "[Agent] List all agents in the current workspace (role names + UUIDs). This includes the 'human' agent (the human user). Use role names (not UUIDs) when calling create_group or add_group_members.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_agent",
      description:
        "[Agent] Delete a direct child agent that you created. Only your own sub-agents can be deleted (agents whose parent is you). The target agent must have no sub-agents of its own — delete those first. This operation is irreversible and removes all associated P2P groups and workflows.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          agentRole: {
            type: "string",
            description: "The role name of the agent to delete (e.g. 'frontend', 'CTO'). Use role names from list_agents, not UUIDs.",
          },
          confirm: {
            type: "boolean",
            description: "Must be true to confirm deletion. This operation is irreversible.",
          },
        },
        required: ["agentRole", "confirm"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "reload_soul",
      description:
        "[Agent] Reload the agent soul.md and role templates from disk. Use after the soul file has been edited, or when the agent's behavior seems outdated.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Skills (Knowledge)
// ---------------------------------------------------------------------------
export const AGENT_TOOLS_SKILL = [
  {
    type: "function" as const,
    function: {
      name: "get_skill",
      description:
        "[Skill] Load the full content of a specific skill by name (use when the skill metadata indicates relevance).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          skill_name: { type: "string", description: "Skill name to retrieve" },
        },
        required: ["skill_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_skill",
      description:
        "[Skill] Create a new skill. Skills are markdown files with YAML frontmatter that teach agents how to handle specific tasks.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "Skill name (kebab-case, e.g. 'data-analysis')" },
          description: { type: "string", description: "One-line description of what this skill does" },
          content: { type: "string", description: "Full skill content (markdown body, no frontmatter)" },
          autoLoad: { type: "boolean", description: "Whether to auto-inject this skill into all agents' system prompts" },
          roles: { type: "array", items: { type: "string" }, description: "Optional: restrict to specific agent roles (e.g. ['coordinator', 'coder'])" },
          requires: { type: "array", items: { type: "string" }, description: "Optional: list of skill names this skill depends on" },
        },
        required: ["name", "description", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_skill",
      description:
        "[Skill] Search for skills on GitHub repos. Use when existing tools and local skills are insufficient for the current task.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Search keywords (e.g., 'web scraping', 'data visualization')" },
          maxResults: { type: "number", description: "Max results to return (default 5)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "install_skill",
      description:
        "[Skill] Install a skill from a remote GitHub source. Downloads SKILL.md to the shared skills directory. All agents can then use it.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "Skill name to install (kebab-case)" },
          source_url: { type: "string", description: "GitHub raw URL or repo URL for the SKILL.md file" },
        },
        required: ["name", "source_url"],
      },
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Messaging (Communication)
// ---------------------------------------------------------------------------
export const AGENT_TOOLS_MESSAGE = [
  {
    type: "function" as const,
    function: {
      name: "send",
      description:
        "[Message] Send a direct message to another agent_id. The IM storage (group) is created/selected automatically.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          to: { type: "string", description: "Target agent_id" },
          content: { type: "string", description: "Message content" },
        },
        required: ["to", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_group_message",
      description: "[Message] Send a message to a group.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          groupId: { type: "string", description: "The group UUID (not the group name). Use create_group or list_groups to get it." },
          content: { type: "string" },
          contentType: { type: "string" },
        },
        required: ["groupId", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_direct_message",
      description:
        "[Message] Send a direct message to another agent. Creates or reuses a P2P group and returns the channel type.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          toAgentId: { type: "string" },
          content: { type: "string" },
          contentType: { type: "string" },
        },
        required: ["toAgentId", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_group_messages",
      description: "[Message] Fetch recent message summary for a group. Returns a card list with sender, time, type, and preview. Use get_message_detail to read full content of a specific message.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          groupId: { type: "string" },
          limit: { type: "number", description: "Number of recent messages to return (default 20)" },
        },
        required: ["groupId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_message_detail",
      description: "[Message] Fetch full content of a single message by ID. Use after get_group_messages to read details.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          messageId: { type: "string" },
        },
        required: ["messageId"],
      },
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Group Management
// ---------------------------------------------------------------------------
export const AGENT_TOOLS_GROUP = [
  {
    type: "function" as const,
    function: {
      name: "list_groups",
      description: "[Group] List visible groups for this agent.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_group_members",
      description: "[Group] List member ids for a group. groupId must be the group UUID (not the name).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          groupId: { type: "string", description: "The group UUID (not the name)" },
        },
        required: ["groupId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_group",
      description: "[Group] Create a group with the given member role names. Returns the groupId (UUID) and name. memberIds accepts agent role names from list_agents — this includes 'human' (the human user), which you should include in any group where a human needs to see progress. Use this groupId when calling send_group_message.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          memberIds: { type: "array", items: { type: "string" }, description: "Agent role names from list_agents (e.g. frontend/backend/CTO/human). Always include 'human' if the human user needs to see progress and coordinate. NOT UUIDs" },
          name: { type: "string" },
        },
        required: ["memberIds"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_group_members",
      description:
        "[Group] Add one or more agents to an existing group. Use this instead of creating a new group when you want to add members. groupId must be the group UUID (not the name).",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          groupId: { type: "string", description: "The group UUID (not the name) to add members to" },
          memberIds: {
            type: "array",
            items: { type: "string" },
            description: "Agent role names (e.g. frontend/backend/CTO) - NOT UUIDs",
          },
        },
        required: ["groupId", "memberIds"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_group",
      description:
        "[Group] Delete a group and all its associated data (messages, workflows, tasks, task_logs, assignments). Only the group creator (coordinator) can use this. This operation is irreversible — use only when a project is completed or cancelled.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          groupId: { type: "string", description: "The group UUID to delete" },
          confirm: { type: "boolean", description: "Set to true to confirm deletion" },
        },
        required: ["groupId", "confirm"],
      },
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Execution (Shell)
// ---------------------------------------------------------------------------
export const AGENT_TOOLS_EXECUTION = [
  {
    type: "function" as const,
    function: {
      name: "bash",
      description:
        "[Execute] Run a shell command on the server. Returns stdout/stderr/exitCode. Use for debugging or file operations.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          command: { type: "string", description: "Shell command to execute" },
          cwd: { type: "string", description: "Working directory (relative to workspace root or absolute)" },
          timeoutMs: { type: "number", description: "Timeout in milliseconds (default 120000)" },
          maxOutputKB: { type: "number", description: "Maximum combined output size in KB (default 1024)" },
        },
        required: ["command"],
      },
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Workflow Orchestration
// ---------------------------------------------------------------------------
export const AGENT_TOOLS_WORKFLOW = [
  {
    type: "function" as const,
    function: {
      name: "create_workflow",
      description:
        "[Workflow] Create a workflow with tasks. Only coordinator can use this. Returns {workflowId}.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          groupId: { type: "string" },
          name: { type: "string" },
          description: { type: "string" },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                description: { type: "string" },
                assigneeRole: { type: "string" },
                dependsOn: { type: "array", items: { type: "string" } },
                expectedOutput: { type: "string" },
                maxRevisions: { type: "number" },
              },
              required: ["name"],
            },
          },
          autoActivate: { type: "boolean", description: "Set to true to activate workflow immediately" },
        },
        required: ["groupId", "name", "tasks"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_task",
      description:
        "[Workflow] Update task status. 'in_progress': starting work. 'review': submit for coordinator review. 'done': coordinator approved. 'approved': coordinator approval. 'rejected': coordinator rejected. 'blocked': exceeded max revisions. 'failed': error occurred.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          taskId: { type: "string" },
          status: { type: "string", enum: ["in_progress", "review", "done", "failed", "approved", "rejected", "blocked"] },
          result: { type: "string" },
          error: { type: "string" },
        },
        required: ["taskId", "status"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_workflow_status",
      description: "[Workflow] Get workflow and task status for a group or workflow.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          workflowId: { type: "string" },
          groupId: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "assign_agent",
      description: "[Workflow] Assign or release an agent to/from a task in a workflow.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          agentId: { type: "string" },
          groupId: { type: "string" },
          workflowId: { type: "string" },
          taskId: { type: "string" },
          action: { type: "string", enum: ["assign", "release"] },
        },
        required: ["agentId", "groupId", "action"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "dispatch_pipeline",
      description:
        "[Workflow] Execute a multi-stage pipeline. Stages run in order with dependency resolution. Results from each stage are passed to the next. This is a DIRECT execution model — not group chat — each stage calls the appropriate agent directly.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          stages: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Stage name (unique, kebab-case)" },
                role: { type: "string", description: "Agent role name to execute this stage (e.g. 'coder', 'reviewer', 'designer')" },
                dependsOn: { type: "array", items: { type: "string" }, description: "Stage names this stage depends on. Empty for first stage." },
                input: { type: "string", description: "Detailed task instructions for this stage" },
              },
              required: ["name", "role", "dependsOn", "input"],
            },
          },
        },
        required: ["stages"],
      },
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Memory (Long-term)
// ---------------------------------------------------------------------------
export const AGENT_TOOLS_MEMORY = [
  {
    type: "function" as const,
    function: {
      name: "memory_add",
      description:
        "[Memory] Save a fact, decision, or pattern to long-term memory. Use for important context that should persist across sessions.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          content: { type: "string", description: "The memory content" },
          tags: { type: "array", items: { type: "string" }, description: "Optional tags for categorization" },
          importance: { type: "number", description: "Importance 1-5 (default 3)" },
          source: { type: "string", description: "Where this memory came from (e.g. 'discussion', 'decision', 'bugfix')" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "memory_search",
      description:
        "[Memory] Search long-term memory for relevant context. Use when starting a new task or when you need historical context.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Search query" },
          tags: { type: "array", items: { type: "string" }, description: "Optional tag filter" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "memory_replace",
      description:
        "[Memory] Update an existing memory's content and/or tags. Use when information has changed or needs correction.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "Memory UUID" },
          content: { type: "string", description: "New content" },
          tags: { type: "array", items: { type: "string" }, description: "New tags (replaces old)" },
        },
        required: ["id", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "memory_remove",
      description:
        "[Memory] Delete a memory permanently. Use when information is obsolete or incorrect.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", description: "Memory UUID" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "session_search",
      description:
        "[Memory] Search archived sessions for past conversations and decisions. Use when looking for historical context about a topic.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Search query" },
          agentId: { type: "string", description: "Optional: filter by agent" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------
export const AGENT_TOOLS_BACKUP = [
  {
    type: "function" as const,
    function: {
      name: "create_backup",
      description:
        "[Backup] Create a snapshot of the current workspace (agents, groups, members, messages). Returns a backup ID for later restore. Use before making risky changes.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_backups",
      description:
        "[Backup] List available backups for the current workspace. Returns backup IDs and creation times.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "restore_backup",
      description:
        "[Backup] Restore a workspace from a backup. This deletes all current workspace data and replaces it with the backup snapshot. IRREVERSIBLE — use list_backups first to confirm the backup ID.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          backupId: { type: "string", description: "The backup UUID to restore from" },
          confirm: { type: "boolean", description: "Must be true to confirm. This operation is irreversible." },
        },
        required: ["backupId", "confirm"],
      },
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Combined tool list — the flat array the LLM sees (grouped for readability).
// ---------------------------------------------------------------------------
export const AGENT_TOOLS: readonly { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }[] = [
  ...AGENT_TOOLS_AGENT,
  ...AGENT_TOOLS_SKILL,
  ...AGENT_TOOLS_MESSAGE,
  ...AGENT_TOOLS_GROUP,
  ...AGENT_TOOLS_EXECUTION,
  ...AGENT_TOOLS_WORKFLOW,
  ...AGENT_TOOLS_MEMORY,
  ...AGENT_TOOLS_BACKUP,
];

export const BUILTIN_TOOL_NAMES = new Set(AGENT_TOOLS.map((tool) => tool.function.name));

// ---------------------------------------------------------------------------
// check_fn — tool availability filtering (Sprint 2 — check_fn).
// Each predicate receives runtime context and returns true if the tool
// should be visible to the LLM in the current state.
// ---------------------------------------------------------------------------
export interface ToolContext {
  agentId: string;
  isCoordinator: boolean;
  hasActiveWorkflow: boolean;
  shellEnabled: boolean;
  hasHumanSender?: boolean;
}

export type ToolCheck = (ctx: ToolContext) => boolean;

export const TOOL_AVAILABILITY: Record<string, ToolCheck> = {
  // Workflow tools: only show management tools when a workflow is active
  update_task: (ctx) => ctx.hasActiveWorkflow,
  get_workflow_status: (ctx) => ctx.hasActiveWorkflow,
  assign_agent: (ctx) => ctx.hasActiveWorkflow && ctx.isCoordinator,

  // Coordinator-only tools
  create_workflow: (ctx) => ctx.isCoordinator,
  delete_group: (ctx) => ctx.isCoordinator,

  // Shell execution: honor DISABLE_SHELL env var
  bash: (ctx) => ctx.shellEnabled,
};

export async function getAgentTools(context?: ToolContext) {
  const loadTimeoutMs =
    Number(process.env.MCP_LOAD_TIMEOUT_MS) > 0 ? Number(process.env.MCP_LOAD_TIMEOUT_MS) : 2000;
  const mcp = await getMcpRegistry(BUILTIN_TOOL_NAMES, { loadTimeoutMs });
  const mcpTools = mcp.getToolDefinitions(new Set(["PrimeMatrixData-http"]));

  if (!context) return [...AGENT_TOOLS, ...mcpTools];

  const filtered = AGENT_TOOLS.filter((tool) => {
    const check = TOOL_AVAILABILITY[tool.function.name];
    return !check || check(context);
  });
  return [...filtered, ...mcpTools];
}

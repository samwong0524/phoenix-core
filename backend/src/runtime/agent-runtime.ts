import { store } from "@/lib/storage";
import { GLMStreamAssembler, parseSSEJsonLines } from "@/lib/glm-stream";
import { OpenAIStreamAssembler } from "@/lib/openai-stream";

import { AgentEventBus } from "./event-bus";
import { createDeferred, safeJsonParse } from "./utils";
import { getWorkspaceUIBus } from "./ui-bus";
import { getMcpRegistry } from "./mcp";
import { appendAgentHistorySnapshot, appendAgentLlmRequestRaw, appendAgentStreamEvent } from "./agent-logger";
import { formatSkillPrompt, getSkillLoader, getSkillDirectory, invalidateSkillCache } from "./skill-loader";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";

const MAX_LLM_RETRIES = 3;
const LLM_RETRY_BASE_MS = 2000;

async function fetchWithRetry(url: string, init: RequestInit, label: string = "LLM"): Promise<Response> {
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    const resp = await fetch(url, init);
    if (resp.status !== 429) return resp;

    lastResponse = resp;
    const retryAfter = resp.headers.get("retry-after");
    const baseDelay = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : LLM_RETRY_BASE_MS * Math.pow(2, attempt);
    // Add 0-500ms random jitter to avoid all agents retrying simultaneously
    const jitter = Math.floor(Math.random() * 500);
    const delayMs = baseDelay + jitter;

    console.warn(`[fetchWithRetry] ${label} got 429, attempt ${attempt + 1}/${MAX_LLM_RETRIES}, retrying in ${delayMs}ms`);
    await new Promise(r => setTimeout(r, delayMs));
  }

  // Return the last 429 response to let the caller handle the error
  return lastResponse!;
}

type UUID = string;

function uuid(): UUID {
  return crypto.randomUUID();
}

type HistoryMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string;
      tool_calls?: unknown;
      reasoning_content?: string;
    }
  | { role: "tool"; content: string; tool_call_id?: string; name?: string };

type ToolCall = {
  index: number;
  id?: string;
  name?: string;
  argumentsText: string;
};

const SKILLS_MARKER = "[skills:loaded]";
const SOUL_MARKER = "[soul:loaded]";
const SEND_TOOL_NAMES = new Set(["send", "send_group_message", "send_direct_message"]);
const CREATE_TOOL_NAMES = new Set(["create"]);
const REPLY_TOOL_NAMES = new Set(["send_group_message"]);

/**
 * Per-group agent turn counter for cascade prevention.
 * Incremented each time an agent sends a message to the group.
 * Reset to 0 when a human sends a message.
 * When >= MAX_AGENT_TURNS, non-human-triggered processing is skipped.
 */
const MAX_AGENT_TURNS = 10;
const groupAgentTurnCount = new Map<string, number>();

function historyHasTool(history: HistoryMessage[], toolNames: Set<string>): boolean {
  return history.some((msg) => {
    if (msg.role !== "assistant" || !msg.tool_calls) return false;
    const calls = msg.tool_calls as Array<{ function?: { name?: string } }>;
    return calls.some((tc) => toolNames.has(tc.function?.name ?? ""));
  });
}

function historyHasSuccessfulTool(history: HistoryMessage[], toolNames: Set<string>): boolean {
  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    if (msg.role !== "assistant" || !msg.tool_calls) continue;
    const calls = msg.tool_calls as Array<{ function?: { name?: string } }>;
    const hasMatching = calls.some((tc) => toolNames.has(tc.function?.name ?? ""));
    if (!hasMatching) continue;
    // Check the following tool result(s) for ok:true
    for (let j = i + 1; j < history.length; j++) {
      if (history[j].role !== "tool") break;
      try {
        const parsed = JSON.parse(history[j].content);
        if (parsed.ok === true) return true;
      } catch {
        // skip parse errors
      }
    }
  }
  return false;
}

async function buildSkillsBlock(role?: string): Promise<string> {
  try {
    const loader = await getSkillLoader();
    const allSkills = await loader.listAutoLoadSkills();
    const allNames = new Set(allSkills.map((s) => s.name));

    const withDepsOk = allSkills.filter((skill) => {
      if (!skill.requires || skill.requires.length === 0) return true;
      const missing = skill.requires.filter((dep) => !allNames.has(dep));
      if (missing.length > 0) {
        console.warn(`[buildSkillsBlock] skill "${skill.name}" missing dependencies: ${missing.join(", ")}`);
        return false;
      }
      return true;
    });

    const roleFiltered = withDepsOk.filter((skill) => {
      const skillRolesRaw = (skill.metadata as Record<string, unknown> | undefined)?.roles;
      const skillRoles: string[] | undefined =
        Array.isArray(skillRolesRaw)
          ? skillRolesRaw as string[]
          : typeof skillRolesRaw === "string"
            ? skillRolesRaw.split(",").map((s) => s.trim())
            : undefined;
      if (!skillRoles || skillRoles.length === 0) return true;
      if (!role) return true;
      return skillRoles.some((r: string) => r.toLowerCase() === role.toLowerCase());
    });
    const skillsMeta = roleFiltered.length > 0
      ? `## Available Skills\nYou have access to specialized skills. Load a skill using the get_skill tool when needed.\n\n${roleFiltered.map((s) => `- \`${s.name}\`: ${s.description}`).join("\n")}`
      : "";
    const autoBlocks = roleFiltered.map((skill) => formatSkillPrompt(skill)).join("\n\n");
    const skillsParts = [skillsMeta, autoBlocks].filter((part) => part && part.trim());
    if (skillsParts.length === 0) return "";
    return `${SKILLS_MARKER}\n\n${skillsParts.join("\n\n")}`;
  } catch {
    return "";
  }
}

let cachedSoul: string | null = null;
let soulLoadAttempted = false;

/**
 * Invalidate the soul cache so the next loadSoulMd() reads from disk.
 */
function invalidateSoulCache() {
  cachedSoul = null;
  soulLoadAttempted = false;
}

async function loadSoulMd(): Promise<string> {
  if (soulLoadAttempted) return cachedSoul ?? "";
  soulLoadAttempted = true;
  try {
    const soulPath = path.resolve(process.cwd(), "src/prompts/soul.md");
    const content = await fs.readFile(soulPath, "utf-8");
    cachedSoul = `${SOUL_MARKER}\n\n${content.trim()}`;
    return cachedSoul;
  } catch {
    cachedSoul = "";
    return "";
  }
}

function historyHasSoul(history: HistoryMessage[]) {
  return history.some(
    (msg) =>
      msg.role === "system" && typeof msg.content === "string" && msg.content.includes(SOUL_MARKER)
  );
}

function historyHasSkills(history: HistoryMessage[]) {
  return history.some(
    (msg) =>
      msg.role === "system" && typeof msg.content === "string" && msg.content.includes(SKILLS_MARKER)
  );
}

/**
 * Compress old tool-call exchanges when history grows too large.
 * Trigger at >8 messages (was >10) to prevent context bloat.
 * Keep: first 2 system messages (soul + skills), last 6 messages, and the first user message.
 * Replace middle tool/user/assistant blocks with a compact structured summary.
 */
function compressHistory(history: HistoryMessage[]) {
  if (history.length <= 8) return; // trigger earlier

  // Protect the first 2 system messages (soul constitution, skills block)
  const systemMsgs = history.filter((m) => m.role === "system");
  const protectedSystems = systemMsgs.slice(0, 2);

  // Build non-system view
  const nonSystem = history.filter((m) => m.role !== "system");
  if (nonSystem.length <= 6) return; // keep fewer recent messages

  const keepStart = nonSystem.slice(0, 1);
  const keepEnd = nonSystem.slice(-6); // was -8
  const compressed = nonSystem.slice(1, nonSystem.length - 6);

  // Build compact summary
  const toolCalls = compressed.filter((m) => m.role === "tool" || (m as Record<string, unknown>).tool_calls);
  const userMsgs = compressed.filter((m) => m.role === "user");
  const assistantMsgs = compressed.filter((m) => m.role === "assistant");

  // Extract just tool names (not full args/results) for compactness
  const toolNames = toolCalls
    .map((m) => {
      const tc = (m as Record<string, unknown>).tool_calls;
      if (Array.isArray(tc)) return tc.map((t: Record<string, unknown>) => (t.function as Record<string, unknown>)?.name ?? "?");
      return [(m as Record<string, unknown>).name ?? "?"];
    })
    .flat();

  // Count unique tool names, not every invocation
  const uniqueTools = [...new Set(toolNames)];

  // Truncate long content from kept messages to prevent bloat
  const MAX_CONTENT_LEN = 2000; // cap individual message length
  const trimmed = [...keepStart, ...keepEnd].map((m) => {
    if (typeof m.content === "string" && m.content.length > MAX_CONTENT_LEN) {
      return { ...m, content: m.content.slice(0, MAX_CONTENT_LEN) + "\n...[truncated]" };
    }
    return m;
  });
  const trimmedStart = trimmed.slice(0, keepStart.length);
  const trimmedEnd = trimmed.slice(keepStart.length);

  const summary: HistoryMessage = {
    role: "system",
    content:
      `[${compressed.length}msgs compressed: ${assistantMsgs.length} replies, ` +
      `${uniqueTools.length} tools(${uniqueTools.slice(0, 6).join(",")}), ` +
      `${userMsgs.length} user msgs]`,
  };

  history.length = 0;
  history.push(...protectedSystems, summary, ...trimmedStart, ...trimmedEnd);
}

function mapOpenRouterMessages(history: HistoryMessage[]): Array<Record<string, unknown>> {
  return history.map((msg) => {
    if (msg.role === "tool") return msg;

    const { reasoning_content, ...rest } = msg as Exclude<HistoryMessage, { role: "tool" }>;
    const mapped: Record<string, unknown> = { ...rest };

    if (msg.role === "assistant" && reasoning_content) {
      mapped.reasoning = reasoning_content;
    }

    // Sanitize tool_calls: ensure all function.arguments are valid JSON strings
    if (msg.role === "assistant" && msg.tool_calls && Array.isArray(msg.tool_calls)) {
      mapped.tool_calls = (msg.tool_calls as Array<Record<string, unknown>>).map((tc) => {
        if (tc.function && typeof tc.function === "object") {
          const fn = tc.function as Record<string, unknown>;
          const args = fn.arguments;
          if (typeof args === "string") {
            // Already a string — try to parse and re-stringify to ensure valid JSON
            try {
              JSON.parse(args);
            } catch {
              // Not valid JSON — replace with empty object
              fn.arguments = "{}";
            }
          } else if (typeof args === "object" && args !== null) {
            // Already an object — stringify it
            fn.arguments = JSON.stringify(args);
          } else {
            // Missing or invalid — default to empty object
            fn.arguments = "{}";
          }
        }
        return tc;
      });
    }

    return mapped;
  });
}

const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "create",
      description:
        "Create a sub-agent with the given role. Only use when the human explicitly asks you to create a new agent. For delegation, use existing agents instead.",
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
    type: "function",
    function: {
      name: "self",
      description: "Return the current agent's identity (agent_id, workspace_id, role).",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_skill",
      description:
        "Load the full content of a specific skill by name (use when the skill metadata indicates relevance).",
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
    type: "function",
    function: {
      name: "create_skill",
      description:
        "Create a new skill. Skills are markdown files with YAML frontmatter that teach agents how to handle specific tasks.",
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
    type: "function",
    function: {
      name: "list_agents",
      description: "List all agents in the current workspace (role names + UUIDs). This includes the 'human' agent (the human user). Use role names (not UUIDs) when calling create_group or add_group_members.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "send",
      description:
        "Send a direct message to another agent_id. The IM storage (group) is created/selected automatically.",
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
    type: "function",
    function: {
      name: "list_groups",
      description: "List visible groups for this agent.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_group_members",
      description: "List member ids for a group. groupId must be the group UUID (not the name).",
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
    type: "function",
    function: {
      name: "create_group",
      description: "Create a group with the given member role names. Returns the groupId (UUID) and name. memberIds accepts agent role names from list_agents — this includes 'human' (the human user), which you should include in any group where a human needs to see progress. Use this groupId when calling send_group_message.",
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
    type: "function",
    function: {
      name: "add_group_members",
      description:
        "Add one or more agents to an existing group. Use this instead of creating a new group when you want to add members. groupId must be the group UUID (not the name).",
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
    type: "function",
    function: {
      name: "delete_agent",
      description:
        "Delete a direct child agent that you created. Only your own sub-agents can be deleted (agents whose parent is you). The target agent must have no sub-agents of its own — delete those first. This operation is irreversible and removes all associated P2P groups and workflows.",
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
    type: "function",
    function: {
      name: "send_group_message",
      description: "Send a message to a group.",
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
    type: "function",
    function: {
      name: "send_direct_message",
      description:
        "Send a direct message to another agent. Creates or reuses a P2P group and returns the channel type.",
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
    type: "function",
    function: {
      name: "get_group_messages",
      description: "Fetch full message history for a group.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          groupId: { type: "string" },
        },
        required: ["groupId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bash",
      description:
        "Run a shell command on the server. Returns stdout/stderr/exitCode. Use for debugging or file operations.",
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
  {
    type: "function",
    function: {
      name: "create_workflow",
      description:
        "Create a workflow with tasks. Only coordinator can use this. Returns {workflowId}.",
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
    type: "function",
    function: {
      name: "update_task",
      description:
        "Update task status. Use 'in_progress' when starting, 'review' when done, 'done' when approved, 'failed' on error.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          taskId: { type: "string" },
          status: { type: "string", enum: ["in_progress", "review", "done", "failed"] },
          result: { type: "string" },
          error: { type: "string" },
        },
        required: ["taskId", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_workflow_status",
      description: "Get workflow and task status for a group or workflow.",
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
    type: "function",
    function: {
      name: "assign_agent",
      description: "Assign or release an agent to/from a task in a workflow.",
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
    type: "function",
    function: {
      name: "delete_group",
      description:
        "Delete a group and all its associated data (messages, workflows, tasks, task_logs, assignments). Only the group creator (coordinator) can use this. This operation is irreversible — use only when a project is completed or cancelled.",
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
  {
    type: "function",
    function: {
      name: "reload_soul",
      description:
        "Reload the agent soul.md and role templates from disk. Use after the soul file has been edited, or when the agent's behavior seems outdated.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "memory_add",
      description:
        "Save a fact, decision, or pattern to long-term memory. Use for important context that should persist across sessions.",
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
    type: "function",
    function: {
      name: "memory_search",
      description:
        "Search long-term memory for relevant context. Use when starting a new task or when you need historical context.",
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
    type: "function",
    function: {
      name: "memory_replace",
      description:
        "Update an existing memory's content and/or tags. Use when information has changed or needs correction.",
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
    type: "function",
    function: {
      name: "memory_remove",
      description:
        "Delete a memory permanently. Use when information is obsolete or incorrect.",
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
    type: "function",
    function: {
      name: "session_search",
      description:
        "Search archived sessions for past conversations and decisions. Use when looking for historical context about a topic.",
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
  {
    type: "function",
    function: {
      name: "create_backup",
      description:
        "Create a snapshot of the current workspace (agents, groups, members, messages). Returns a backup ID for later restore. Use before making risky changes.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_backups",
      description:
        "List available backups for the current workspace. Returns backup IDs and creation times.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "restore_backup",
      description:
        "Restore a workspace from a backup. This deletes all current workspace data and replaces it with the backup snapshot. IRREVERSIBLE — use list_backups first to confirm the backup ID.",
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

const BUILTIN_TOOL_NAMES = new Set(AGENT_TOOLS.map((tool) => tool.function.name));

async function getAgentTools() {
  const loadTimeoutMs =
    Number(process.env.MCP_LOAD_TIMEOUT_MS) > 0 ? Number(process.env.MCP_LOAD_TIMEOUT_MS) : 2000;
  const mcp = await getMcpRegistry(BUILTIN_TOOL_NAMES, { loadTimeoutMs });
  const mcpTools = mcp.getToolDefinitions();
  return [...AGENT_TOOLS, ...mcpTools];
}

function getGlmConfig() {
  const apiKey = process.env.GLM_API_KEY ?? process.env.ZHIPUAI_API_KEY ?? "";
  const baseUrl =
    process.env.GLM_BASE_URL ??
    "https://open.bigmodel.cn/api/paas/v4/chat/completions";
  const model = process.env.GLM_MODEL ?? "glm-4.7";

  if (!apiKey) {
    throw new Error("Missing GLM API key (set GLM_API_KEY or ZHIPUAI_API_KEY)");
  }

  return { apiKey, baseUrl, model };
}

type LlmProvider = "glm" | "openrouter" | "ollama" | "anthropic";

function getLlmProvider(): LlmProvider {
  const raw = (process.env.LLM_PROVIDER ?? "glm").toLowerCase();
  if (raw === "openrouter" || raw === "open-router" || raw === "or") return "openrouter";
  if (raw === "anthropic" || raw === "anthropic-compatible") return "anthropic";
  if (raw === "ollama" || raw === "o" || raw === "local") return "ollama";
  return "glm";
}

function normalizeOpenRouterUrl(value: string) {
  if (!value) return "https://openrouter.ai/api/v1/chat/completions";
  if (value.endsWith("/chat/completions")) return value;
  if (value.endsWith("/api/v1")) return `${value}/chat/completions`;
  if (value.endsWith("/v1")) return `${value}/chat/completions`;
  return value;
}

function getOpenRouterConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY ?? "";
  const baseUrl = normalizeOpenRouterUrl(
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions"
  );
  const model = process.env.OPENROUTER_MODEL ?? "";
  const httpReferer = process.env.OPENROUTER_HTTP_REFERER ?? "";
  const appTitle = process.env.OPENROUTER_APP_TITLE ?? "";

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }

  return { apiKey, baseUrl, model, httpReferer, appTitle };
}

function getAnthropicConfig() {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? "";
  const model = process.env.ANTHROPIC_MODEL ?? "qwen3.6-plus";

  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY");
  }

  return { apiKey, baseUrl, model };
}

function getOllamaConfig() {
  const baseUrl = normalizeOpenRouterUrl(
    process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1/chat/completions"
  );
  const model = process.env.OLLAMA_MODEL ?? "qwen3:8b";
  return { baseUrl, model };
}

class AgentRunner {
  private wake = createDeferred<void>();
  private started = false;
  private running = false;
  private interruptRequested = false;
  private static readonly MAX_PROCESS_ITERATIONS = 3;
  private turnToolFailures = new Map<string, number>();
  // Guardrail: same tool + same params连续失败计数
  private exactFailureCount = new Map<string, number>();
  // Guardrail: same tool总失败计数
  private sameToolFailureCount = new Map<string, number>();
  // Tools blocked due to exact failures >= 5
  private blockedTools = new Set<string>();
  // Agent paused due to total failures >= 8
  private agentPaused = false;
  // Free mode memory search cache: query -> results (design doc §6.5)
  private memoryCache = new Map<string, Array<Record<string, unknown>>>();

  constructor(
    private readonly agentId: UUID,
    private readonly bus: AgentEventBus,
    private readonly ensureRunner: (agentId: UUID) => void,
    private readonly wakeAgent: (agentId: UUID) => void,
    private readonly stopRunner: (agentId: UUID) => void
  ) {}

  start() {
    if (this.started) return;
    this.started = true;
    void this.ensureSkillsLoaded();
    void this.loop();
  }

  private async ensureSkillsLoaded() {
    try {
      const agent = await store.getAgent({ agentId: this.agentId });
      const parsed = safeJsonParse<unknown>(agent.llmHistory, {});
      const history = Array.isArray(parsed) ? (parsed as HistoryMessage[]) : [];
      if (historyHasSkills(history)) return;
      const skillsBlock = await buildSkillsBlock(agent.role);
      if (!skillsBlock) return;
      history.push({ role: "system", content: skillsBlock });
      await store.setAgentHistory({
        agentId: this.agentId,
        llmHistory: JSON.stringify(history),
      });
    } catch {
      // best-effort only
    }
  }

  wakeup(reason: "manual" | "group_message" | "direct_message" | "context_stream" = "manual") {
    console.info(`[AgentRunner:wakeup] agent=${this.agentId} reason=${reason}`);
    // Run skill evaluation on wakeup — async, non-blocking (design doc §11.4)
    void this.evaluateSkills();
    this.wake.resolve();
    this.wake = createDeferred<void>();
    this.bus.emit(this.agentId, {
      event: "agent.wakeup",
      data: { agentId: this.agentId, reason },
    });
  }

  requestInterrupt() {
    this.interruptRequested = true;
    this.wake.resolve();
    this.wake = createDeferred<void>();
  }

  private consumeInterruptRequest() {
    if (!this.interruptRequested) return false;
    this.interruptRequested = false;
    return true;
  }

  private async loop() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await this.wake.promise;
      if (this.running) continue;
      this.running = true;
      const iterationStart = Date.now();
      let hadWork = false;
      try {
        hadWork = await this.processUntilIdle();
      } catch (err) {
        this.bus.emit(this.agentId, {
          event: "agent.error",
          data: { message: err instanceof Error ? err.message : String(err) },
        });
        const message = err instanceof Error ? err.message : String(err);
        void appendAgentStreamEvent({
          agentId: this.agentId,
          kind: "error",
          error: message,
        });
      } finally {
        this.running = false;
      }
      // Hermes idle timeout: 450s idle (no messages) / 1200s active (processing).
      // If processUntilIdle did no work and total elapsed exceeds idle budget, stop.
      const elapsed = Date.now() - iterationStart;
      if (!hadWork && elapsed >= 450_000) {
        console.info(`[AgentRunner:loop] idle timeout after ${elapsed}ms, stopping runner`);
        this.stopRunner(this.agentId);
      } else if (hadWork && elapsed >= 1_200_000) {
        console.info(`[AgentRunner:loop] active timeout after ${elapsed}ms, stopping runner`);
        this.stopRunner(this.agentId);
      }
    }
  }

  private async processUntilIdle(): Promise<boolean> {
    const role = await store.getAgentRole({ agentId: this.agentId }).catch(() => null);
    if (role === "human" || role === null) return false;
    if (this.consumeInterruptRequest()) return false;
    let iterations = 0;
    let hadWork = false;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (iterations >= AgentRunner.MAX_PROCESS_ITERATIONS) return hadWork;
      iterations++;
      if (this.consumeInterruptRequest()) return hadWork;
      const batches = await store.listUnreadByGroup({ agentId: this.agentId });
      console.info(`[processUntilIdle] agent=${this.agentId} iterations=${iterations} batches=${batches.length}`);
      if (batches.length === 0) return hadWork;

      this.bus.emit(this.agentId, {
        event: "agent.unread",
        data: {
          agentId: this.agentId,
          batches: batches.map((batch) => ({
            groupId: batch.groupId,
            messageIds: batch.messages.map((m) => m.id),
          })),
        },
      });

      for (const batch of batches) {
        console.info(`[processUntilIdle] Processing batch group=${batch.groupId} messages=${batch.messages.length}`);
        if (this.consumeInterruptRequest()) return hadWork;
        try {
          await this.processGroupUnread(batch.groupId, batch.messages);
          hadWork = true;
        } catch (err) {
          console.error(`[processUntilIdle] Error processing group=${batch.groupId}:`, err);
        }
        console.info(`[processUntilIdle] Done processing batch group=${batch.groupId}`);
        if (this.consumeInterruptRequest()) return hadWork;
      }
    }
  }

  private async processGroupUnread(
    groupId: UUID,
    unreadMessages: Array<{
      id: UUID;
      senderId: UUID;
      content: string;
      contentType: string;
      sendTime: string;
    }>
  ) {
    console.info(`[processGroupUnread] group=${groupId} msgs=${unreadMessages.length}`);
    const workspaceId = await store.getGroupWorkspaceId({ groupId });
    console.info(`[processGroupUnread] workspaceId=${workspaceId}`);
    const agent = await store.getAgent({ agentId: this.agentId });
    console.info(`[processGroupUnread] agent role=${agent.role}`);

    // Check for active workflow in this group (includes draft for free-mode detection)
    let wfRow: { id: string; status: string; name: string; creator_id: string } | null = null;
    try {
      const db = getDb();
      console.info(`[processGroupUnread] db connected, checking workflow`);
      const wfRows = await db.execute(
        sql`SELECT id, status, name, creator_id FROM workflows WHERE group_id = ${groupId} ORDER BY updated_at DESC LIMIT 1`
      );
      const rows = wfRows as unknown as Array<{ id: string; status: string; name: string; creator_id: string }>;
      wfRow = rows[0] ?? null;
    } catch (err) {
      console.error(`[processGroupUnread] workflow check error:`, err);
    }

    // 群主 = coordinator（铁律 #6）。谁创建的群/工作流，谁就是 coordinator
    const isCoordinator = wfRow ? wfRow.creator_id === this.agentId : false;
    // Free mode: no workflow or only draft → all agents respond freely
    const isFreeMode = wfRow === null || wfRow.status === "draft";

    // activeWf: only non-draft workflows count as "active workflow mode"
    const activeWf = (wfRow && wfRow.status !== "draft")
      ? { id: wfRow.id, status: wfRow.status, name: wfRow.name }
      : null;
    console.info(`[processGroupUnread] activeWf=${activeWf ? `${activeWf.id}(${activeWf.status})` : "none"}, isCoordinator=${isCoordinator}, freeMode=${isFreeMode}`);

    // If workflow is paused and this agent is not coordinator, skip
    if (activeWf && activeWf.status === "paused" && !isCoordinator) { console.info('[processGroupUnread] SKIP: workflow paused, not coordinator'); return; }

    // If workflow active and this is the coordinator: check if human just spoke → auto-pause
    if (activeWf && activeWf.status === "active" && isCoordinator) {
      const senderIds = [...new Set(unreadMessages.map((m) => m.senderId))];
      let humanSpoke = false;
      for (const sid of senderIds) {
        const rows = await getDb().execute(
          sql`SELECT role FROM agents WHERE id = ${sid}`
        );
        const role = (rows as unknown as Array<{ role: string } | null>)[0]?.role;
        if (role === "human") {
          humanSpoke = true;
          break;
        }
      }
      if (humanSpoke) {
        console.info('[processGroupUnread] SKIP: human spoke during active workflow, auto-pause');
        await getDb().execute(
          sql`UPDATE workflows SET status = 'paused', updated_at = ${new Date().toISOString()} WHERE id = ${activeWf.id}`
        );
        return;
      }
    }

    // If workflow is active and agent is not the assigned task owner, skip
    if (activeWf && activeWf.status === "active" && !isCoordinator) {
      const assignRows = await getDb().execute(
        sql`SELECT id FROM agent_assignments WHERE agent_id = ${this.agentId} AND group_id = ${groupId} AND status = 'active' AND task_id IS NOT NULL LIMIT 1`
      );
      if ((assignRows as unknown as Array<{ id: string }>)[0] === undefined) { console.info('[processGroupUnread] SKIP: workflow active, not assigned'); return; }
    }

    const parsed = safeJsonParse<unknown>(agent.llmHistory, {});
    const history = Array.isArray(parsed) ? (parsed as HistoryMessage[]) : [];

    // Proactive compression: trim bloated history before LLM call to reduce token usage
    if (history.length > 8) {
      compressHistory(history);
      console.info(`[processGroupUnread] compressed history: ${history.length} messages`);
    }

    const skillsBlock = await buildSkillsBlock();
    const soulBlock = await loadSoulMd();
    const hasSkills = historyHasSkills(history);
    const hasSoul = historyHasSoul(history);

    if (history.length === 0) {
      const role = agent.role;
      const members = await store.listGroupMemberIds({ groupId });
      const memberRoles: Array<{ id: string; role: string | null }> = await Promise.all(
        members.map(async (mid) => ({
          id: mid,
          role: mid === this.agentId ? "YOU" : await store.getAgentRole({ agentId: mid }).catch(() => null),
        }))
      );
      const membersList = memberRoles
        .filter((m) => m.role !== "human")
        .map((m) => `${m.id.substring(0, 8)}(${m.role})`)
        .join(", ");

      const workflowContext = activeWf
        ? `\n\nThere is an active workflow: "${activeWf.name}" (status: ${activeWf.status}). ` +
          (isCoordinator
            ? "You are the coordinator. Monitor workflow progress, review task results, and assign next tasks."
            : "You are a worker. Only execute when assigned a task by the coordinator. Check get_workflow_status before acting.")
        : "";

      history.push({
        role: "system",
        content:
          `You are an agent in an IM system.\n` +
          `Your agent_id is: ${this.agentId}.\n` +
          `Your workspace_id is: ${workspaceId}.\n` +
          `Your role is: ${role}.\n` +
          `This group has ${members.length} members: [${membersList}]. ` +
          `Only reference these agents by their roles — do not invent other roles.\n` +
          `Act strictly as this role when replying. Be concise and helpful.\n` +
          `Your replies are NOT automatically delivered to humans.\n` +
          `To send messages, you MUST call tools like send_group_message or send_direct_message.\n` +
          `CRITICAL: When creating groups with create_group, always include 'human' in memberIds so the human user can see progress. 'human' is a valid agent role from list_agents. Without it, workflow controls and cascade prevention will fail.\n` +
          `If you need to coordinate with other agents, you may use tools like self, list_agents, create, send, list_groups, list_group_members, create_group, add_group_members, send_group_message, send_direct_message, and get_group_messages.\n` +
          `If you need to run shell commands, use the bash tool.` +
          `CRITICAL: When you solve a non-trivial problem (multi-step fix, new pattern, repeated failure), save it as a skill using create_skill. Skills become permanent knowledge for future-you and other agents.` +
          workflowContext +
          (skillsBlock ? `\n\n${skillsBlock}` : ""),
      });
    } else {
      if (soulBlock && !hasSoul) {
        history.push({ role: "system", content: soulBlock });
      }
      if (skillsBlock && !hasSkills) {
        history.push({ role: "system", content: skillsBlock });
      }
    }

    // Build user content with sender roles so agents know who's speaking
    const senderRoleCache = new Map<string, string | null>();
    const uniqueSenders = [...new Set(unreadMessages.map((m) => m.senderId))];
    await Promise.all(
      uniqueSenders.map(async (sid) => {
        const role = await store.getAgentRole({ agentId: sid }).catch(() => null);
        senderRoleCache.set(sid, role);
      })
    );
    const userContent = unreadMessages
      .map((m) => `[group:${groupId}] ${senderRoleCache.get(m.senderId) ?? m.senderId.substring(0, 8)}: ${m.content}`)
      .join("\n");
    history.push({ role: "user", content: userContent });

    const lastId = unreadMessages[unreadMessages.length - 1]?.id;

    // === Cascade prevention: per-group agent turn counter ===
    const senderRoles = await Promise.all(
      unreadMessages.map((m) => store.getAgentRole({ agentId: m.senderId }).catch(() => null))
    );
    const hasHumanSender = senderRoles.some((r) => r === "human");

    if (hasHumanSender) {
      groupAgentTurnCount.set(groupId, 0);
    } else {
      // Skip cascade counter when workflow is active — workflow has its own coordinator review
      if (activeWf && activeWf.status === "active") {
        // Active workflow: managed by coordinator, no cascade limit needed
      } else {
        const currentTurns = groupAgentTurnCount.get(groupId) ?? 0;
        if (currentTurns >= MAX_AGENT_TURNS) {
          return;
        }
      }
      // Free mode: allow agents to respond naturally without requiring direct mentions.
      // The LLM decides based on context. The turn counter (MAX_AGENT_TURNS) is the
      // ultimate safety net against infinite loops.
    }

    let { assistantText, assistantThinking, didSend } = await this.runWithTools({
      groupId,
      workspaceId,
      history,
    });

    if (didSend) {
      const currentTurns = groupAgentTurnCount.get(groupId) ?? 0;
      groupAgentTurnCount.set(groupId, currentTurns + 1);
    }

    history.push({
      role: "assistant",
      content: assistantText,
      reasoning_content: assistantThinking || undefined,
    });

    // If the message was from a human and agent didn't send any reply, auto-send the assistant text
    if (hasHumanSender && !didSend && assistantText.trim() && !this.interruptRequested) {
      const members = await store.listGroupMemberIds({ groupId });
      const result = await store.sendMessage({
        groupId,
        senderId: this.agentId,
        content: assistantText,
        contentType: "text",
      });
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.message.created",
        data: {
          workspaceId,
          groupId,
          memberIds: members,
          message: { id: result.id, senderId: this.agentId, sendTime: result.sendTime },
        },
      });
      for (let i = 0; i < members.length; i++) {
        if (members[i] === this.agentId) continue;
        const role = await store.getAgentRole({ agentId: members[i] }).catch(() => null);
        if (role === "human" || role === null) continue;
        const idx = i;
        const delay = 500 * idx + Math.floor(Math.random() * 500);
        (async () => {
          await new Promise((r) => setTimeout(r, delay));
          this.ensureRunner(members[idx]);
          this.wakeAgent(members[idx]);
        })();
      }
      didSend = true;
      const currentTurns = groupAgentTurnCount.get(groupId) ?? 0;
      groupAgentTurnCount.set(groupId, currentTurns + 1);
    }

    // If agent created agents but never successfully replied to a group, inject a reminder
    // into history WITHOUT calling LLM again (saves an entire LLM call cycle).
    // The next wakeup will see the reminder and act on it.
    const needsHumanReply = historyHasTool(history, CREATE_TOOL_NAMES) &&
      !historyHasSuccessfulTool(history, REPLY_TOOL_NAMES);

    if ((!didSend || needsHumanReply) && !this.interruptRequested) {
      const reminder = needsHumanReply
        ? "Reminder: 你创建了 agent 但未回复人类。请用 send_group_message 向对话群组发送确认消息。"
        : "Reminder: 本轮未调用 send_*。先判断是否需要对外可见；需要时使用 send_group_message 或 send_direct_message，无需时可不发送。";
      history.push({
        role: "user",
        content: reminder,
      });
      console.info(`[processGroupUnread] injected reminder (no LLM call) for agent ${this.agentId}`);
    }
    if (lastId) {
      await store.markGroupReadToMessage({ groupId, readerId: this.agentId, messageId: lastId });
    }
    await store.setAgentHistory({
      agentId: this.agentId,
      llmHistory: JSON.stringify(history),
      workspaceId,
    });

    // Session archive: archive the conversation for cross-session FTS search (design doc §6.3).
    void this.archiveSessionToDb(history, groupId, workspaceId);

    try {
      await appendAgentHistorySnapshot({
        agentId: this.agentId,
        workspaceId,
        groupId,
        history,
      });
    } catch {
      // best-effort logging
    }
    getWorkspaceUIBus().emit(workspaceId, {
      event: "ui.agent.history.persisted",
      data: { workspaceId, agentId: this.agentId, groupId, historyLength: history.length },
    });
  }

  /**
   * Archive the current LLM history to session_archive for cross-session FTS search.
   * Async, best-effort — does not block the main loop.
   */
  private async archiveSessionToDb(
    history: HistoryMessage[],
    groupId: string,
    workspaceId: string,
  ) {
    try {
      const { getDb } = await import("@/db");
      const { sql } = await import("drizzle-orm");
      const db = getDb();
      const content = history.map((m) => `[${m.role}] ${m.content}`).join("\n");
      const summary = history
        .filter((m) => m.role === "assistant")
        .map((m) => m.content.slice(0, 200))
        .join(" ");
      await db.execute(
        sql`INSERT INTO session_archive (id, agent_id, workspace_id, group_id, archived_at, content, summary)
            VALUES (gen_random_uuid(), ${this.agentId}, ${workspaceId}, ${groupId}, ${new Date().toISOString()}, ${content}, ${summary})`
      );
    } catch {
      // best-effort; table may not exist yet
    }
  }

  /**
   * Reset per-turn guardrail state. Called at the start of each runWithTools round.
   */
  private resetForTurn() {
    this.turnToolFailures.clear();
    this.exactFailureCount.clear();
    this.sameToolFailureCount.clear();
    this.memoryCache.clear();
  }

  private async runWithTools(input: {
    groupId: UUID;
    workspaceId: UUID;
    history: HistoryMessage[];
  }) {
    const maxToolRounds = 3;
    let assistantText = "";
    let assistantThinking = "";
    let didSend = false;
    this.resetForTurn();

    for (let round = 0; round < maxToolRounds; round++) {
      // Reinforce critical constraints before each LLM call.
      // LLM attention to early system messages degrades in long conversations;
      // appending to end ensures the rules are actually "seen".
      const lastIdx = input.history.length - 1;
      if (input.history[lastIdx] && input.history[lastIdx].content.startsWith("[Rules]")) {
        input.history.splice(lastIdx, 1);
      }
      const MAX_MSGS = 10;
      const currentTurns = groupAgentTurnCount.get(input.groupId) ?? 0;
      input.history.push({
        role: "system",
        content:
          `[Rules] Never create new agents or new groups without human explicit approval. Use existing agents and groups for delegation. ` +
          `Max ${MAX_MSGS} turns per group (current: ${currentTurns}). ` +
          `Stay silent if no new input. One action, one message.`,
      });

      const res = await this.callLlmStreaming(input.history, {
        workspaceId: input.workspaceId,
        groupId: input.groupId,
        round,
      });
      assistantText = res.assistantText;
      assistantThinking = res.assistantThinking;

      if (res.toolCalls.length === 0) {
        return { assistantText, assistantThinking, didSend };
      }

      input.history.push({
        role: "assistant",
        content: res.assistantText,
        tool_calls: res.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(safeJsonParse(c.argumentsText, {})) },
        })),
        reasoning_content: res.assistantThinking || undefined,
      });

      for (const call of res.toolCalls) {
        if (this.agentPaused) {
          input.history.push({
            role: "system",
            content: `Agent is paused due to repeated tool failures. Do not attempt further tool calls until the issue is resolved.`,
          });
          break;
        }
        // Check if this specific tool+params combo is blocked
        const callKey = `${call.name}:${JSON.stringify(safeJsonParse(call.argumentsText, {}))}`;
        if (call.name && this.blockedTools.has(callKey)) {
          input.history.push({
            role: "system",
            content: `Tool "${call.name}" with these parameters has failed too many times and is blocked. Use different parameters or a different approach.`,
          });
          continue;
        }

        if (call.name && SEND_TOOL_NAMES.has(call.name)) {
          didSend = true;
        }
        const result = await this.executeToolCall({
          groupId: input.groupId,
          call,
        });

        // Record skill usage for self-evolution tracking
        const toolOk = (result as Record<string, unknown> | undefined)?.ok !== false;
        if (!toolOk && call.name) {
          const prev = this.turnToolFailures.get(call.name) ?? 0;
          this.turnToolFailures.set(call.name, prev + 1);

          // Guardrail: exact failure (same tool + same params)
          const callKey = `${call.name}:${JSON.stringify(safeJsonParse(call.argumentsText, {}))}`;
          const exactPrev = this.exactFailureCount.get(callKey) ?? 0;
          this.exactFailureCount.set(callKey, exactPrev + 1);
          if (exactPrev + 1 >= 5) {
            this.blockedTools.add(callKey);
            console.warn(`[AgentRunner] blocked tool ${callKey} after 5 exact failures`);
          }

          // Guardrail: same tool total failures
          const sameToolPrev = this.sameToolFailureCount.get(call.name) ?? 0;
          this.sameToolFailureCount.set(call.name, sameToolPrev + 1);
          if (sameToolPrev + 1 >= 8) {
            this.agentPaused = true;
            console.warn(`[AgentRunner] agent paused after 8 total failures of ${call.name}`);
          }
        }

        // Persist skill usage
        const ok = (result as Record<string, unknown> | undefined)?.ok ?? true;
        if (call.name) {
          void this.recordSkillUsage(call.name, ok === true);
        }

        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: {
            kind: "tool_result",
            delta: JSON.stringify(result),
            tool_call_id: call.id,
            tool_call_name: call.name,
          },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round,
          kind: "tool_result",
          delta: JSON.stringify(result),
          tool_call_id: call.id,
          tool_call_name: call.name,
        });
        input.history.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: call.id,
          name: call.name,
        });
        // Context compression: when a task is done, trim old tool exchanges
        if ((result as Record<string, unknown> | undefined)?.taskDone === true) {
          compressHistory(input.history);
        }
      }

      // Inject failure alert when a tool keeps failing — triggers agent self-learning
      for (const [toolName, count] of this.turnToolFailures) {
        if (count >= 3) {
          input.history.push({
            role: "system",
            content: `Tool "${toolName}" has failed ${count} times in this turn. Consider creating a skill with \`create_skill\` documenting the fix pattern, or try a different approach.`,
          });
          break;
        }
      }

    }

    return { assistantText, assistantThinking, didSend };
  }

  /**
   * Resolve an array of agent identifiers to UUIDs.
   * Values that are already valid UUIDs pass through unchanged.
   * Non-UUID values are looked up by agent role in the given agent list.
   * Unresolvable values are silently dropped.
   */
  private resolveAgentIds(
    ids: string[],
    agents: Array<{ id: UUID; role: string }>
  ): UUID[] {
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const validUuids = new Set<UUID>(agents.map((a) => a.id));
    const roleIndex = new Map<string, UUID>();
    for (const a of agents) {
      if (!roleIndex.has(a.role)) {
        roleIndex.set(a.role, a.id);
      }
    }
    const result: UUID[] = [];
    for (const id of ids) {
      if (uuidRe.test(id) && validUuids.has(id)) {
        result.push(id);
      } else {
        const uuid = roleIndex.get(id);
        if (uuid) result.push(uuid);
      }
    }
    return result;
  }

  /**
   * Record a skill/tool usage for self-evolution tracking.
   * Best-effort — failures are silently ignored.
   */
  private async recordSkillUsage(skillName: string, success: boolean) {
    try {
      const { getDb } = await import("@/db");
      const { sql } = await import("drizzle-orm");
      const db = getDb();
      await db.execute(
        sql`INSERT INTO skill_usage (id, skill_name, agent_id, success, used_at)
            VALUES (gen_random_uuid(), ${skillName}, ${this.agentId}, ${success}, ${new Date()})`
      );
    } catch {
      // best-effort; table may not exist yet in fresh databases
    }
  }

  /**
   * Evaluate all skills based on usage history and classify them into tiers.
   * Bayesian smoothed scoring: score = (success + 1) / (total + 2)
   * Tiers: >90% excellent, 70-90% good, 30-70% needs_improve, <30% deprecated
   * Design doc §11.4 skill evolution loop.
   */
  private async evaluateSkills() {
    try {
      const { getDb } = await import("@/db");
      const { sql } = await import("drizzle-orm");
      const db = getDb();

      // Aggregate success/failure per skill
      const rows = await db.execute(
        sql`SELECT skill_name,
                   COUNT(*) FILTER (WHERE success = true) as success_count,
                   COUNT(*) FILTER (WHERE success = false) as failure_count
            FROM skill_usage
            GROUP BY skill_name`
      );

      const skillStats = rows as Array<Record<string, unknown>>;
      for (const row of skillStats) {
        const skillName = row.skill_name as string;
        const successCount = Number(row.success_count ?? 0);
        const failureCount = Number(row.failure_count ?? 0);
        const total = successCount + failureCount;
        if (total === 0) continue;

        // Bayesian smoothing
        const score = (successCount + 1) / (total + 2);
        const percentage = score * 100;

        let newStatus: string;
        if (percentage > 90) {
          newStatus = "active";
        } else if (percentage >= 70) {
          newStatus = "active";
        } else if (percentage >= 30) {
          newStatus = "improving";
        } else {
          newStatus = "deprecated";
        }

        // Update status for this agent's records
        await db.execute(
          sql`UPDATE skill_usage SET status = ${newStatus}
              WHERE skill_name = ${skillName} AND status = 'active' AND agent_id = ${this.agentId}`
        );
      }
    } catch {
      // best-effort; table may not exist
    }
  }

  private async executeToolCall(input: { groupId: UUID; call: ToolCall }) {
    const name = input.call.name ?? "";
    const workspaceId = await store.getGroupWorkspaceId({ groupId: input.groupId });
    const toolMeta = { toolCallId: input.call.id, toolName: input.call.name };

    getWorkspaceUIBus().emit(workspaceId, {
      event: "ui.agent.tool_call.start",
      data: {
        workspaceId,
        agentId: this.agentId,
        groupId: input.groupId,
        toolCallId: toolMeta.toolCallId,
        toolName: toolMeta.toolName,
      },
    });

    const emitToolDone = (ok: boolean) => {
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.agent.tool_call.done",
        data: {
          workspaceId,
          agentId: this.agentId,
          groupId: input.groupId,
          toolCallId: toolMeta.toolCallId,
          toolName: toolMeta.toolName,
          ok,
        },
      });
    };

    if (name === "self") {
      const role = await store.getAgentRole({ agentId: this.agentId }).catch(() => null);
      emitToolDone(true);
      return { ok: true, agentId: this.agentId, workspaceId, role };
    }

    if (name === "get_skill") {
      const args = safeJsonParse<{ skill_name?: string; name?: string }>(
        input.call.argumentsText,
        {}
      );
      const skillName = (args.skill_name ?? args.name ?? "").trim();
      if (!skillName) {
        emitToolDone(false);
        return { ok: false, error: "Missing skill_name" };
      }

      const loader = await getSkillLoader();
      const skill = await loader.getSkill(skillName);
      if (!skill) {
        emitToolDone(false);
        return { ok: false, error: `Unknown skill: ${skillName}`, available: await loader.listSkills() };
      }

      emitToolDone(true);
      return { ok: true, content: formatSkillPrompt(skill) };
    }

    if (name === "create_skill") {
      const args = safeJsonParse<{
        name?: string;
        description?: string;
        content?: string;
        autoLoad?: boolean;
        roles?: string[];
        requires?: string[];
      }>(input.call.argumentsText, {});
      const skillName = (args.name ?? "").trim();
      const description = (args.description ?? "").trim();
      const content = (args.content ?? "").trim();
      if (!skillName || !description || !content) {
        emitToolDone(false);
        return { ok: false, error: "Missing required fields: name, description, content" };
      }

      // Frequency limit: max 3 skills per day per agent (design doc §11.4)
      try {
        const { getDb } = await import("@/db");
        const { sql } = await import("drizzle-orm");
        const db = getDb();
        const rows = await db.execute(
          sql`SELECT COUNT(*) as cnt FROM skill_usage WHERE agent_id = ${this.agentId} AND used_at >= NOW() - INTERVAL '24 hours'`
        );
        const count = (rows as Array<Record<string, unknown>>)[0]?.cnt as number;
        if (count >= 3) {
          emitToolDone(false);
          return { ok: false, error: "Daily skill creation limit reached (3 per day). Try again tomorrow." };
        }
      } catch {
        // best-effort; table may not exist — proceed without limit
      }

      const skillsDir = getSkillDirectory();
      const skillDir = path.join(skillsDir, skillName);

      try {
        // Conflict detection: check if skill already exists
        const existing = await fs.stat(skillDir).catch(() => null);
        if (existing?.isDirectory()) {
          // Mark conflict in skill_usage table
          try {
            const { getDb } = await import("@/db");
            const { sql } = await import("drizzle-orm");
            const db = getDb();
            await db.execute(
              sql`INSERT INTO skill_usage (id, skill_name, agent_id, success, used_at, status)
                  VALUES (gen_random_uuid(), ${skillName}, ${this.agentId}, false, ${new Date().toISOString()}, 'conflict')`
            );
          } catch {
            // best-effort
          }
          emitToolDone(false);
          return { ok: false, error: `Skill "${skillName}" already exists. Status: conflict. Use a different name or update the existing skill.`, conflict: true };
        }

        await fs.mkdir(skillDir, { recursive: true });
        const frontmatter = [
          "---",
          `name: ${skillName}`,
          `description: ${description}`,
          args.autoLoad ? "auto-load: true" : "",
          args.roles && args.roles.length > 0 ? `metadata:\n  roles: [${args.roles.join(", ")}]` : "",
          args.requires && args.requires.length > 0 ? `requires: [${args.requires.join(", ")}]` : "",
          "---",
          "",
          content,
        ].filter(Boolean).join("\n");

        await fs.writeFile(path.join(skillDir, "SKILL.md"), frontmatter, "utf-8");
        invalidateSkillCache();

        emitToolDone(true);
        return { ok: true, path: path.join(skillDir, "SKILL.md") };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to create skill" };
      }
    }

    if (name === "bash") {
      const args = safeJsonParse<{
        command?: string;
        cwd?: string;
        timeoutMs?: number;
        maxOutputKB?: number;
      }>(input.call.argumentsText, {});
      const command = (args.command ?? "").trim();
      if (!command) {
        emitToolDone(false);
        return { ok: false, error: "Missing command" };
      }

      // Destructive/dangerous command blacklist — code-level guard, cannot be bypassed by prompt
      const DENIED_COMMANDS: RegExp[] = [
        /\brm\s+(-[a-zA-Z]*rf?)/,           // rm -rf
        /\bdel\s+\/[sfa]/i,                  // del /s /q /f
        /\bformat\b/,                        // format disk
        /\bmkfs\b/,                          // format filesystem
        /\bshutdown\b/,                      // shutdown system
        /\breboot\b/,                        // reboot
        /\bpowershell\s+.*-[eE]x/,           // powershell -exec bypass
        /\bcurl\s+.*\|\s*(bash|sh\b|pwsh|powershell)/, // curl | bash (remote code execution)
        /\bchmod\s+777\b/,                   // chmod 777
        /\bsudo\b/,                          // sudo (privilege escalation)
        /\bnet\s+user\b/,                    // create/delete Windows users
        /\bschtasks\b/,                      // scheduled tasks
        /\btaskkill\b/,                      // kill running processes
        /\bStop-Process\b/,                  // PowerShell kill
      ];

      for (const pattern of DENIED_COMMANDS) {
        if (pattern.test(command)) {
          emitToolDone(false);
          return { ok: false, error: `Command blocked: potentially destructive pattern detected. Use safer alternatives.` };
        }
      }

      // Audit log: record every bash attempt before execution
      const auditLogPath = path.join(process.cwd(), ".agent_stream_logs", "bash-audit.log");
      const auditLine = `${new Date().toISOString()} | ${this.agentId.substring(0, 8)} | ${command.slice(0, 200).replace(/\n/g, "\\n")} | PENDING\n`;
      void fs.appendFile(auditLogPath, auditLine);

      const workspaceRoot = process.env.AGENT_WORKDIR ?? process.cwd();
      const requestedCwd = (args.cwd ?? "").trim();
      let finalCwd = workspaceRoot;
      if (requestedCwd) {
        const resolved = path.isAbsolute(requestedCwd)
          ? requestedCwd
          : path.resolve(workspaceRoot, requestedCwd);
        const rootResolved = path.resolve(workspaceRoot);
        if (!resolved.startsWith(rootResolved)) {
          emitToolDone(false);
          return { ok: false, error: "cwd must be within workspace root", workspaceRoot };
        }
        finalCwd = resolved;
      }

      const timeoutMs = Number(args.timeoutMs) > 0 ? Number(args.timeoutMs) : 120000;
      const maxOutputKB = Number(args.maxOutputKB) > 0 ? Number(args.maxOutputKB) : 1024;
      const maxBuffer = Math.max(64 * 1024, Math.floor(maxOutputKB * 1024));
      const execAsync = promisify(exec);

      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: finalCwd,
          timeout: timeoutMs,
          maxBuffer,
          shell: process.platform === "win32" ? "bash" : "/bin/bash",
        });
        const successLine = `${new Date().toISOString()} | ${this.agentId.substring(0, 8)} | ${command.slice(0, 200).replace(/\n/g, "\\n")} | OK | exit:0\n`;
        void fs.appendFile(auditLogPath, successLine);
        emitToolDone(true);
        return { ok: true, stdout, stderr, exitCode: 0, cwd: finalCwd };
      } catch (err: any) {
        const stdout = err?.stdout ?? "";
        const stderr = err?.stderr ?? "";
        const exitCode = typeof err?.code === "number" ? err.code : null;
        const signal = typeof err?.signal === "string" ? err.signal : null;
        const errorLine = `${new Date().toISOString()} | ${this.agentId.substring(0, 8)} | ${command.slice(0, 200).replace(/\n/g, "\\n")} | FAIL | exit:${exitCode ?? "null"}\n`;
        void fs.appendFile(auditLogPath, errorLine);
        emitToolDone(false);
        return {
          ok: false,
          stdout,
          stderr,
          exitCode,
          signal,
          cwd: finalCwd,
          error: String(err?.message ?? err),
        };
      }
    }

    if (name === "create") {
      // CODE-LEVEL GUARD: Only the human user can create new agents.
      // Prompt constraints are lost in long conversations; code cannot be ignored.
      const callerRole = await store.getAgentRole({ agentId: this.agentId }).catch(() => null);
      if (callerRole !== "human") {
        emitToolDone(false);
        return {
          ok: false,
          error: "Permission denied: only the human user can create new agents. Ask the human to create them for you, or delegate to existing agents.",
        };
      }

      const args = safeJsonParse<{ role?: string; guidance?: string }>(input.call.argumentsText, {});
      const role = (args.role ?? "").trim();
      const guidance = (args.guidance ?? "").trim();
      if (!role) {
        emitToolDone(false);
        return { ok: false, error: "Missing role" };
      }

      const created = await store.createSubAgentWithP2P({
        workspaceId,
        creatorId: this.agentId,
        role,
        guidance,
      });
      this.ensureRunner(created.agentId);
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.agent.created",
        data: { workspaceId, agent: { id: created.agentId, role, parentId: this.agentId } },
      });
      emitToolDone(true);
      return { ok: true, agentId: created.agentId, role, groupId: created.groupId };
    }

    if (name === "list_agents") {
      const agents = await store.listAgentsMeta({ workspaceId });
      emitToolDone(true);
      return { ok: true, agents };
    }

    if (name === "send") {
      const args = safeJsonParse<{ to?: string; content?: string }>(input.call.argumentsText, {});
      const to = (args.to ?? "").trim();
      const content = (args.content ?? "").trim();
      if (!to) {
        emitToolDone(false);
        return { ok: false, error: "Missing to" };
      }
      if (!content) {
        emitToolDone(false);
        return { ok: false, error: "Missing content" };
      }

      const delivered = await store.sendDirectMessage({
        workspaceId,
        fromId: this.agentId,
        toId: to,
        // Do not auto-add the human into agent↔agent threads; sidebar only shows human-participant chats.
        content,
        contentType: "text",
        groupName: null,
      });

      const directMembers = await store.listGroupMemberIds({ groupId: delivered.groupId });
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.message.created",
        data: {
          workspaceId,
          groupId: delivered.groupId,
          memberIds: directMembers,
          message: { id: delivered.messageId, senderId: this.agentId, sendTime: delivered.sendTime },
        },
      });

      const toRole = await store.getAgentRole({ agentId: to }).catch(() => null);
      if (toRole && toRole !== "human") {
        this.ensureRunner(to);
        this.wakeAgent(to);
      }

      emitToolDone(true);
      return { ok: true, ...delivered };
    }

    if (name === "list_groups") {
      const groups = await store.listGroups({ workspaceId, agentId: this.agentId });
      emitToolDone(true);
      return { ok: true, groups };
    }

    if (name === "list_group_members") {
      const args = safeJsonParse<{ groupId?: string }>(input.call.argumentsText, {});
      const groupId = (args.groupId ?? "").trim();
      if (!groupId) {
        emitToolDone(false);
        return { ok: false, error: "Missing groupId" };
      }
      const members = await store.listGroupMemberIds({ groupId });
      if (!members.includes(this.agentId)) {
        emitToolDone(false);
        return { ok: false, error: "Access denied" };
      }
      emitToolDone(true);
      return { ok: true, members };
    }

    if (name === "create_group") {
      const callerRole = await store.getAgentRole({ agentId: this.agentId }).catch(() => null);
      if (callerRole !== "human") {
        emitToolDone(false);
        return { ok: false, error: "Permission denied: only the human user can create groups. Ask the human to create a group for you." };
      }

      const args = safeJsonParse<{ memberIds?: string[]; name?: string }>(input.call.argumentsText, {});
      let memberIds = this.resolveAgentIds(
        (args.memberIds ?? []).map((id) => id.trim()).filter(Boolean),
        await store.listAgentsMeta({ workspaceId })
      );
      if (memberIds.length < 2) {
        emitToolDone(false);
        return { ok: false, error: "memberIds must have >= 2 members" };
      }
      if (!memberIds.includes(this.agentId)) {
        memberIds = [...memberIds, this.agentId];
      }
      let groupId = "";
      let groupName: string | null = args.name ?? null;
      const isNewGroup = memberIds.length > 2; // Only create workflow for multi-member groups, not P2P

      if (memberIds.length === 2) {
        const existing = await store.findLatestExactP2PGroupId({
          workspaceId,
          memberA: memberIds[0]!,
          memberB: memberIds[1]!,
          preferredName: args.name ?? null,
        });
        groupId =
          (await store.mergeDuplicateExactP2PGroups({
            workspaceId,
            memberA: memberIds[0]!,
            memberB: memberIds[1]!,
            preferredName: args.name ?? null,
          })) ??
          (
            await store.createGroup({
              workspaceId,
              memberIds,
              name: args.name ?? undefined,
            })
          ).id;
        if (!existing) {
          getWorkspaceUIBus().emit(workspaceId, {
            event: "ui.group.created",
            data: { workspaceId, group: { id: groupId, name: groupName, memberIds } },
          });
        }
      } else {
        const created = await store.createGroup({ workspaceId, memberIds, name: args.name ?? undefined });
        groupId = created.id;
        groupName = created.name;
        getWorkspaceUIBus().emit(workspaceId, {
          event: "ui.group.created",
          data: { workspaceId, group: { id: groupId, name: groupName, memberIds } },
        });

        // 铁律 #6: 群主 = coordinator
        // Auto-create a draft workflow with the group creator as coordinator
        const now = new Date().toISOString();
        const workflowId = crypto.randomUUID();
        await getDb().execute(
          sql`INSERT INTO workflows (id, group_id, name, creator_id, status, created_at, updated_at)
              VALUES (${workflowId}, ${groupId}, ${groupName ?? 'Group Workflow'}, ${this.agentId}, 'draft', ${now}, ${now})`
        );
      }
      emitToolDone(true);
      return { ok: true, groupId, name: groupName };
    }

    if (name === "add_group_members") {
      const args = safeJsonParse<{ groupId?: string; memberIds?: string[] }>(input.call.argumentsText, {});
      const groupId = (args.groupId ?? "").trim();
      const rawIds = (args.memberIds ?? []).map((id) => id.trim()).filter(Boolean);
      if (!groupId) {
        emitToolDone(false);
        return { ok: false, error: "Missing groupId" };
      }
      const memberIds = this.resolveAgentIds(rawIds, await store.listAgentsMeta({ workspaceId }));
      if (memberIds.length === 0) {
        emitToolDone(false);
        return { ok: false, error: "memberIds must have >= 1 member" };
      }
      const existingMembers = await store.listGroupMemberIds({ groupId });
      if (!existingMembers.includes(this.agentId)) {
        emitToolDone(false);
        return { ok: false, error: "Access denied" };
      }
      const newMembers = memberIds.filter((id) => !existingMembers.includes(id));
      if (newMembers.length === 0) {
        emitToolDone(false);
        return { ok: false, error: "All specified members are already in the group" };
      }
      await store.addGroupMembers({ groupId, userIds: newMembers });
      const allMembers = await store.listGroupMemberIds({ groupId });
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.group.member_added",
        data: { workspaceId, groupId, addedMemberIds: newMembers, memberIds: allMembers },
      });
      emitToolDone(true);
      return { ok: true, groupId, addedMembers: newMembers };
    }

    if (name === "delete_agent") {
      const args = safeJsonParse<{ agentRole?: string; confirm?: boolean }>(
        input.call.argumentsText,
        {}
      );
      const agentRole = (args.agentRole ?? "").trim();
      if (!agentRole) {
        emitToolDone(false);
        return { ok: false, error: "Missing agentRole" };
      }
      if (!args.confirm) {
        emitToolDone(false);
        return { ok: false, error: "Must set confirm=true to delete. This operation is irreversible." };
      }

      const db = getDb();
      const agents = await store.listAgentsMeta({ workspaceId });

      // Resolve role name to UUID
      const resolved = this.resolveAgentIds([agentRole], agents);
      if (resolved.length === 0) {
        emitToolDone(false);
        return { ok: false, error: `Agent not found: "${agentRole}"` };
      }
      const targetId = resolved[0]!;

      // Cannot delete human
      const targetAgent = agents.find((a) => a.id === targetId);
      if (!targetAgent) {
        emitToolDone(false);
        return { ok: false, error: "Agent not found" };
      }
      if (targetAgent.role === "human") {
        emitToolDone(false);
        return { ok: false, error: "Cannot delete the human agent" };
      }

      // Authorization: target must be a direct child of the calling agent
      const targetParentId = agents.find((a) => a.id === targetId)?.parentId;
      if (targetParentId !== this.agentId) {
        emitToolDone(false);
        return { ok: false, error: "Access denied: you can only delete agents that you created" };
      }

      // Check if target has sub-agents
      const subAgents = agents.filter((a) => a.parentId === targetId);
      if (subAgents.length > 0) {
        emitToolDone(false);
        return { ok: false, error: `Cannot delete: this agent has ${subAgents.length} sub-agent(s). Delete them first.` };
      }

      // Collect all groups this agent is a member of
      const allGroups = await store.listGroups({ workspaceId, agentId: targetId });
      const groupIds = allGroups.map((g) => g.id);

      // For multi-member groups, only remove membership (don't delete the group)
      // For P2P groups where this agent is one of two members, delete the entire group
      const multiMemberGroupIds: string[] = [];
      const p2pGroupIds: string[] = [];
      for (const g of allGroups) {
        if (g.memberIds.length === 2) {
          p2pGroupIds.push(g.id);
        } else {
          multiMemberGroupIds.push(g.id);
        }
      }

      try {
        await db.transaction(async (tx) => {
          // 1. Delete workflows and their tasks/task_logs for P2P groups
          for (const gid of p2pGroupIds) {
            await tx.execute(sql`DELETE FROM task_logs WHERE task_id IN (SELECT id FROM tasks WHERE workflow_id IN (SELECT id FROM workflows WHERE group_id = ${gid}))`);
            await tx.execute(sql`DELETE FROM tasks WHERE workflow_id IN (SELECT id FROM workflows WHERE group_id = ${gid})`);
            await tx.execute(sql`DELETE FROM agent_assignments WHERE group_id = ${gid}`);
            await tx.execute(sql`DELETE FROM workflows WHERE group_id = ${gid}`);
            await tx.execute(sql`DELETE FROM messages WHERE group_id = ${gid}`);
            await tx.execute(sql`DELETE FROM group_members WHERE group_id = ${gid}`);
            await tx.execute(sql`DELETE FROM groups WHERE id = ${gid}`);
          }

          // 2. For multi-member groups: remove membership only
          for (const gid of multiMemberGroupIds) {
            await tx.execute(sql`DELETE FROM group_members WHERE group_id = ${gid} AND user_id = ${targetId}`);
          }

          // 3. Delete workflows where this agent is the creator (in any remaining group)
          await tx.execute(sql`DELETE FROM task_logs WHERE task_id IN (SELECT id FROM tasks WHERE workflow_id IN (SELECT id FROM workflows WHERE creator_id = ${targetId}))`);
          await tx.execute(sql`DELETE FROM tasks WHERE workflow_id IN (SELECT id FROM workflows WHERE creator_id = ${targetId})`);
          await tx.execute(sql`DELETE FROM agent_assignments WHERE workflow_id IN (SELECT id FROM workflows WHERE creator_id = ${targetId})`);
          await tx.execute(sql`DELETE FROM workflows WHERE creator_id = ${targetId}`);

          // 4. Delete the agent
          await tx.execute(sql`DELETE FROM agents WHERE id = ${targetId}`);
        });

        // Stop the agent's runner if it's running
        this.stopRunner(targetId);

        getWorkspaceUIBus().emit(workspaceId, {
          event: "ui.agent.deleted",
          data: { workspaceId, agentId: targetId, role: targetAgent.role },
        });

        emitToolDone(true);
        return { ok: true, agentId: targetId, role: targetAgent.role, message: "Agent deleted" };
      } catch (err) {
        console.error(`[delete_agent] Transaction failed for agent=${targetId}:`, err);
        emitToolDone(false);
        return { ok: false, error: "Failed to delete agent" };
      }
    }

    if (name === "delete_group") {
      const args = safeJsonParse<{ groupId?: string; confirm?: boolean }>(
        input.call.argumentsText,
        {}
      );
      const groupId = (args.groupId ?? "").trim();
      if (!groupId) {
        emitToolDone(false);
        return { ok: false, error: "Missing groupId" };
      }
      if (!args.confirm) {
        emitToolDone(false);
        return { ok: false, error: "Must set confirm=true to delete. This operation is irreversible." };
      }

      const db = getDb();

      // Authorization: groups table has no creator_id column.
      // Multi-member groups have a workflow → only the workflow creator (coordinator) can delete.
      // P2P groups have no workflow → any member can delete.
      const wfRows = await db.execute(
        sql`SELECT creator_id FROM workflows WHERE group_id = ${groupId} ORDER BY created_at DESC LIMIT 1`
      );
      const wfRowsArr = wfRows as unknown as Array<{ creator_id: string }>;
      const wfRow = wfRowsArr[0] ?? null;
      if (wfRow && wfRow.creator_id !== this.agentId) {
        emitToolDone(false);
        return { ok: false, error: "Only the group creator (coordinator) can delete a group" };
      }

      // Verify membership (required for P2P groups without workflows)
      const members = await store.listGroupMemberIds({ groupId });
      if (!members.includes(this.agentId)) {
        emitToolDone(false);
        return { ok: false, error: "Access denied" };
      }

      // Collect workflow IDs for cascade delete
      const workflowIds = await db.execute(
        sql`SELECT id FROM workflows WHERE group_id = ${groupId}`
      );
      const wfIds = (workflowIds as unknown as Array<{ id: string }>).map((r) => r.id);

      // Cascade delete: task_logs → tasks → agent_assignments → workflows → messages → group_members → groups
      try {
        await db.transaction(async (tx) => {
          if (wfIds.length > 0) {
            // 1. task_logs
            await tx.execute(
              sql`DELETE FROM task_logs WHERE task_id IN (SELECT id FROM tasks WHERE workflow_id IN (${sql.join(wfIds, sql`, `)}))`
            );
            // 2. tasks
            await tx.execute(
              sql`DELETE FROM tasks WHERE workflow_id IN (${sql.join(wfIds, sql`, `)})`
            );
          }
          // 3. agent_assignments
          await tx.execute(sql`DELETE FROM agent_assignments WHERE group_id = ${groupId}`);
          // 4. workflows
          await tx.execute(sql`DELETE FROM workflows WHERE group_id = ${groupId}`);
          // 5. messages
          await tx.execute(sql`DELETE FROM messages WHERE group_id = ${groupId}`);
          // 6. group_members
          await tx.execute(sql`DELETE FROM group_members WHERE group_id = ${groupId}`);
          // 7. group
          await tx.execute(sql`DELETE FROM groups WHERE id = ${groupId}`);
        });
      } catch (err) {
        console.error(`[delete_group] Transaction failed for group=${groupId}:`, err);
        emitToolDone(false);
        return { ok: false, error: "Failed to delete group" };
      }

      emitToolDone(true);
      return { ok: true, groupId, message: "Group and all associated data deleted" };
    }

    if (name === "send_group_message") {
      const args = safeJsonParse<{ groupId?: string; content?: string; contentType?: string }>(
        input.call.argumentsText,
        {}
      );
      const groupId = (args.groupId ?? "").trim();
      const content = (args.content ?? "").trim();
      if (!groupId) {
        emitToolDone(false);
        return { ok: false, error: "Missing groupId" };
      }
      if (!content) {
        emitToolDone(false);
        return { ok: false, error: "Missing content" };
      }

      // Resolve groupId: if not a valid UUID, try to find by name
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let resolvedGroupId = groupId;
      if (!uuidRegex.test(groupId)) {
        const groups = await store.listGroups({ workspaceId, agentId: this.agentId });
        const found = groups.find((g) => g.name === groupId);
        if (!found) {
          emitToolDone(false);
          return { ok: false, error: `Group not found: "${groupId}". Use the group UUID, not the name.` };
        }
        resolvedGroupId = found.id;
      }

      const members = await store.listGroupMemberIds({ groupId: resolvedGroupId });
      if (!members.includes(this.agentId)) {
        emitToolDone(false);
        return { ok: false, error: "Access denied" };
      }

      const result = await store.sendMessage({
        groupId: resolvedGroupId,
        senderId: this.agentId,
        content,
        contentType: args.contentType ?? "text",
      });

      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.message.created",
        data: {
          workspaceId,
          groupId: resolvedGroupId,
          memberIds: members,
          message: { id: result.id, senderId: this.agentId, sendTime: result.sendTime },
        },
      });

      for (const memberId of members) {
        if (memberId === this.agentId) continue;
        const role = await store.getAgentRole({ agentId: memberId }).catch(() => null);
        if (role === "human" || role === null) continue;
        this.ensureRunner(memberId);
        this.wakeAgent(memberId);
      }

      emitToolDone(true);
      return { ok: true, ...result };
    }

    if (name === "send_direct_message") {
      const args = safeJsonParse<{ toAgentId?: string; content?: string; contentType?: string }>(
        input.call.argumentsText,
        {}
      );
      const toAgentId = (args.toAgentId ?? "").trim();
      const content = (args.content ?? "").trim();
      if (!toAgentId) {
        emitToolDone(false);
        return { ok: false, error: "Missing toAgentId" };
      }
      if (!content) {
        emitToolDone(false);
        return { ok: false, error: "Missing content" };
      }

      const delivered = await store.sendDirectMessage({
        workspaceId,
        fromId: this.agentId,
        toId: toAgentId,
        content,
        contentType: args.contentType ?? "text",
        groupName: null,
      });
      const groupId = delivered.groupId;
      const channel = delivered.channel;
      const directMembers = await store.listGroupMemberIds({ groupId });
      getWorkspaceUIBus().emit(workspaceId, {
        event: "ui.message.created",
        data: {
          workspaceId,
          groupId,
          memberIds: directMembers,
          message: { id: delivered.messageId, senderId: this.agentId, sendTime: delivered.sendTime },
        },
      });

      this.ensureRunner(toAgentId);
      this.wakeAgent(toAgentId);

      emitToolDone(true);
      return {
        ok: true,
        channel,
        groupId,
        messageId: delivered.messageId,
        sendTime: delivered.sendTime,
      };
    }

    if (name === "get_group_messages") {
      const args = safeJsonParse<{ groupId?: string }>(input.call.argumentsText, {});
      const groupId = (args.groupId ?? "").trim();
      if (!groupId) {
        emitToolDone(false);
        return { ok: false, error: "Missing groupId" };
      }
      const members = await store.listGroupMemberIds({ groupId });
      if (!members.includes(this.agentId)) {
        emitToolDone(false);
        return { ok: false, error: "Access denied" };
      }
      const messages = await store.listMessages({ groupId });
      emitToolDone(true);
      return { ok: true, messages };
    }

    if (name === "create_workflow") {
      const args = safeJsonParse<{
        groupId?: string;
        name?: string;
        description?: string;
        tasks?: Array<{
          name?: string;
          description?: string;
          assigneeRole?: string;
          dependsOn?: string[];
          expectedOutput?: string;
          maxRevisions?: number;
        }>;
        autoActivate?: boolean;
      }>(input.call.argumentsText, {});
      const groupId = (args.groupId ?? "").trim();
      const wfName = (args.name ?? "").trim();
      if (!groupId || !wfName) {
        emitToolDone(false);
        return { ok: false, error: "Missing groupId or name" };
      }
      const tasks = args.tasks ?? [];
      if (tasks.length === 0) {
        emitToolDone(false);
        return { ok: false, error: "tasks must have at least 1 item" };
      }

      const wfId = uuid();
      const now = new Date();
      const initialStatus = args.autoActivate ? "active" : "draft";
      const { getDb } = await import("@/db");
      const { sql } = await import("drizzle-orm");
      const db = getDb();

      try {
        await db.execute(
          sql`INSERT INTO workflows (id, group_id, name, description, creator_id, status, created_at, updated_at) VALUES (${wfId}, ${groupId}, ${wfName}, ${args.description ?? null}, ${this.agentId}, ${initialStatus}, ${now}, ${now})`
        );

        for (const t of tasks) {
          const tId = uuid();
          const dependsOn = (t.dependsOn ?? []).map((d) => d.trim()).filter(Boolean);
          await db.execute(
            sql`INSERT INTO tasks (id, workflow_id, name, description, assignee_role, expected_output, status, depends_on, max_revisions, created_at) VALUES (${tId}, ${wfId}, ${t.name ?? "unnamed"}, ${t.description ?? null}, ${t.assigneeRole ?? null}, ${t.expectedOutput ?? null}, 'pending', ${JSON.stringify(dependsOn)}, ${t.maxRevisions ?? 3}, ${now})`
          );
        }
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to create workflow" };
      }

      emitToolDone(true);
      const result: Record<string, unknown> = { ok: true, workflowId: wfId, taskCount: tasks.length };

      // Auto-retrieve relevant memories for this workflow (design doc §6.5)
      try {
        const searchQuery = [wfName, args.description ?? ""].filter(Boolean).join(" ");
        const memRows = await db.execute(
          sql`SELECT id, content, tags, importance, source FROM memories
              WHERE agent_id = ${this.agentId}
              AND content ILIKE ${`%${searchQuery}%`}
              ORDER BY importance DESC, created_at DESC
              LIMIT 5`
        );
        const relatedMemories = (memRows as Array<Record<string, unknown>>).map((r) => ({
          id: r.id,
          content: r.content,
          tags: r.tags,
          importance: r.importance,
        }));
        if (relatedMemories.length > 0) {
          result.relatedMemories = relatedMemories;
        }
      } catch {
        // best-effort; table may not exist
      }

      return result;
    }

    if (name === "update_task") {
      const args = safeJsonParse<{
        taskId?: string;
        status?: string;
        result?: string;
        error?: string;
      }>(input.call.argumentsText, {});
      const taskId = (args.taskId ?? "").trim();
      const status = (args.status ?? "").trim();
      if (!taskId || !status) {
        emitToolDone(false);
        return { ok: false, error: "Missing taskId or status" };
      }
      const validStatuses = new Set(["in_progress", "review", "done", "failed", "approved", "rejected", "blocked"]);
      if (!validStatuses.has(status)) {
        emitToolDone(false);
        return { ok: false, error: `Invalid status: ${status}` };
      }

      const { getDb } = await import("@/db");
      const { sql } = await import("drizzle-orm");
      const db = getDb();
      const now = new Date();

      const updates: string[] = [`status = ${status}`];
      if (status === "in_progress") updates.push(`started_at = ${now}`);
      if (status === "review") updates.push(`reviewed_at = ${now}`);
      if (status === "done") updates.push(`completed_at = ${now}`);
      if (status === "approved") updates.push(`completed_at = ${now}`);
      if (args.result) updates.push(`result = ${args.result}`);
      if (args.error) updates.push(`error = ${args.error}`);
      if (status === "review") updates.push(`review_count = review_count + 1`);

      try {
        await db.execute(
          sql`UPDATE tasks SET ${sql.raw(updates.join(", "))} WHERE id = ${taskId}`
        );

        // Log task status change
        await db.execute(
          sql`INSERT INTO task_logs (id, task_id, event_type, event_data, actor_id, created_at)
              VALUES (gen_random_uuid(), ${taskId}, ${`task_${status}`},
                      jsonb_build_object('status', ${status}, 'result', ${args.result ?? null}),
                      ${this.agentId}, ${now})`
        );
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to update task" };
      }

      emitToolDone(true);
      return { ok: true, taskId, status, taskDone: status === "done" || status === "approved" };
    }

    if (name === "get_workflow_status") {
      const args = safeJsonParse<{ workflowId?: string; groupId?: string }>(
        input.call.argumentsText,
        {}
      );
      let workflowId = (args.workflowId ?? "").trim();

      const { getDb } = await import("@/db");
      const { sql } = await import("drizzle-orm");
      const db = getDb();

      if (!workflowId) {
        const groupId = (args.groupId ?? "").trim();
        if (!groupId) {
          emitToolDone(false);
          return { ok: false, error: "Missing workflowId or groupId" };
        }
        const wfRows = await db.execute(
          sql`SELECT id, status FROM workflows WHERE group_id = ${groupId} AND status IN ('draft', 'active', 'paused') ORDER BY created_at DESC LIMIT 1`
        );
        const wfArr = wfRows as unknown as Array<{ id: string; status: string }>;
        if (wfArr.length === 0) {
          emitToolDone(true);
          return { ok: true, workflow: null };
        }
        workflowId = wfArr[0].id;
      }

      const wfRows = await db.execute(
        sql`SELECT id, name, description, status, created_at, updated_at FROM workflows WHERE id = ${workflowId}`
      );
      const wfArr = wfRows as Array<Record<string, unknown>>;
      if (wfArr.length === 0) {
        emitToolDone(false);
        return { ok: false, error: "Workflow not found" };
      }
      const wf = wfArr[0];

      const tRows = await db.execute(
        sql`SELECT id, name, status, assignee_role, assignee_id, review_count, max_revisions, result, error FROM tasks WHERE workflow_id = ${workflowId} ORDER BY created_at`
      );
      const tasks = (tRows as Array<Record<string, unknown>>).map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        assigneeRole: t.assignee_role,
        assigneeId: t.assignee_id,
        reviewCount: t.review_count,
        maxRevisions: t.max_revisions,
        result: t.result,
        error: t.error,
      }));

      emitToolDone(true);
      return { ok: true, workflow: wf, tasks };
    }

    if (name === "assign_agent") {
      const args = safeJsonParse<{
        agentId?: string;
        groupId?: string;
        workflowId?: string;
        taskId?: string;
        action?: string;
      }>(input.call.argumentsText, {});
      const agentId = (args.agentId ?? "").trim();
      const groupId = (args.groupId ?? "").trim();
      const action = (args.action ?? "").trim();
      if (!agentId || !groupId || !action) {
        emitToolDone(false);
        return { ok: false, error: "Missing agentId, groupId, or action" };
      }

      const { getDb } = await import("@/db");
      const { sql } = await import("drizzle-orm");
      const db = getDb();
      const now = new Date();

      if (action === "assign") {
        const wfId = (args.workflowId ?? "").trim() || null;
        const tId = (args.taskId ?? "").trim() || null;
        const assignId = uuid();

        try {
          // Release any existing assignment for this agent
          await db.execute(
            sql`UPDATE agent_assignments SET status = 'released', released_at = ${now} WHERE agent_id = ${agentId} AND status = 'active'`
          );

          await db.execute(
            sql`INSERT INTO agent_assignments (id, agent_id, group_id, workflow_id, task_id, status, assigned_at) VALUES (${assignId}, ${agentId}, ${groupId}, ${wfId}, ${tId}, 'active', ${now})`
          );
        } catch (err: unknown) {
          emitToolDone(false);
          return { ok: false, error: err instanceof Error ? err.message : "Failed to assign agent" };
        }

        emitToolDone(true);
        return { ok: true, assignmentId: assignId };
      }

      if (action === "release") {
        try {
          await db.execute(
            sql`UPDATE agent_assignments SET status = 'released', released_at = ${now} WHERE agent_id = ${agentId} AND group_id = ${groupId} AND status = 'active'`
          );
        } catch (err: unknown) {
          emitToolDone(false);
          return { ok: false, error: err instanceof Error ? err.message : "Failed to release agent" };
        }
        emitToolDone(true);
        return { ok: true };
      }

      emitToolDone(false);
      return { ok: false, error: `Invalid action: ${action}` };
    }

    if (name === "reload_soul") {
      invalidateSoulCache();
      invalidateSkillCache();
      const newSoul = await loadSoulMd();
      const loader = await getSkillLoader();
      invalidateSkillCache();
      await loader.discoverSkills();
      emitToolDone(true);
      return { ok: true, message: "Soul and skills reloaded from disk" };
    }

    // --- Memory tools (C Module) ---

    if (name === "memory_add") {
      const args = safeJsonParse<{
        content?: string;
        tags?: string[];
        importance?: number;
        source?: string;
      }>(input.call.argumentsText, {});
      const content = (args.content ?? "").trim();
      if (!content) {
        emitToolDone(false);
        return { ok: false, error: "Missing content" };
      }

      try {
        const { getDb } = await import("@/db");
        const { sql } = await import("drizzle-orm");
        const db = getDb();
        const memId = uuid();
        const now = new Date();
        const tagsArr = args.tags ?? [];
        const importance = Math.min(5, Math.max(1, args.importance ?? 3));
        const source = (args.source ?? "").trim() || null;

        // First get workspace_id
        const wsRows = await db.execute(
          sql`SELECT workspace_id FROM agents WHERE id = ${this.agentId} LIMIT 1`
        );
        const ws = (wsRows as unknown as Array<{ workspace_id: string }>)[0];
        if (!ws) {
          emitToolDone(false);
          return { ok: false, error: "Agent not found" };
        }

        const nowIso = now.toISOString();

        const tagsArray = tagsArr.length > 0
          ? sql`ARRAY[${sql.join(tagsArr, sql`,`)}]::text[]`
          : sql`ARRAY[]::text[]`;

        await db.execute(
          sql`INSERT INTO memories (id, agent_id, workspace_id, content, tags, created_at, accessed_at, importance, source) VALUES (${memId}, ${this.agentId}, ${ws.workspace_id}, ${content}, ${tagsArray}, ${nowIso}, ${nowIso}, ${importance}, ${source})`
        );

        emitToolDone(true);
        return { ok: true, id: memId };
      } catch (err: unknown) {
        console.error("[memory_add] INSERT failed:", err);
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to add memory" };
      }
    }

    if (name === "memory_search") {
      const args = safeJsonParse<{
        query?: string;
        tags?: string[];
        limit?: number;
      }>(input.call.argumentsText, {});
      const query = (args.query ?? "").trim();
      if (!query) {
        emitToolDone(false);
        return { ok: false, error: "Missing query" };
      }

      // Free mode: check cache to avoid repeated searches in same cycle (design doc §6.5)
      const cacheKey = `${query}:${(args.tags ?? []).sort().join(",")}:${args.limit ?? 10}`;
      const cached = this.memoryCache.get(cacheKey);
      if (cached) {
        emitToolDone(true);
        return { ok: true, memories: cached, count: cached.length, cached: true };
      }

      try {
        const { getDb } = await import("@/db");
        const { sql } = await import("drizzle-orm");
        const db = getDb();
        const limit = Math.min(50, args.limit ?? 10);
        const filterTags = args.tags ?? [];

        // Layer 1: Keyword + tag exact match (design doc §6.1)
        let layer1Rows;
        if (filterTags.length > 0) {
          layer1Rows = await db.execute(
            sql`SELECT id, content, tags, importance, source, created_at
                FROM memories WHERE agent_id = ${this.agentId}
                AND (content ILIKE ${`%${query}%`} OR tags && ${filterTags})
                ORDER BY importance DESC, created_at DESC`
          );
        } else {
          layer1Rows = await db.execute(
            sql`SELECT id, content, tags, importance, source, created_at
                FROM memories WHERE agent_id = ${this.agentId}
                AND content ILIKE ${`%${query}%`}
                ORDER BY importance DESC, created_at DESC`
          );
        }

        const layer1 = (layer1Rows as Array<Record<string, unknown>>).map((r) => ({
          id: String(r.id),
          content: String(r.content),
          tags: r.tags as string[] | null,
          importance: Number(r.importance ?? 1),
          source: r.source as string | null,
        }));

        // Layer 2: TagMemo Spike propagation — tag co-occurrence expansion (design doc §6.2)
        // Extract tags from layer 1 results, find memories with co-occurring tags
        const layer1Tags = new Set<string>();
        for (const mem of layer1) {
          if (Array.isArray(mem.tags)) {
            for (const t of mem.tags) layer1Tags.add(t);
          }
        }

        let layer2: typeof layer1 = [];
        if (layer1Tags.size > 0) {
          const tagArr = Array.from(layer1Tags);
          // Find memories sharing tags with layer 1 results, excluding layer 1 itself
          const layer1Ids = layer1.map((m) => m.id);
          const spikeThreshold = Math.max(2, Math.floor(limit * 0.3)); // up to 30% extra from spike

          if (layer1Ids.length > 0) {
            // Build exclusion list for SQL
            const placeholders = layer1Ids.map(() => sql`${layer1Ids[layer1Ids.indexOf(layer1Ids[0] ?? "")]}`).join(", ");
            // Safer approach: use array containment
            const layer2Rows = await db.execute(
              sql`SELECT id, content, tags, importance, source, created_at
                  FROM memories WHERE agent_id = ${this.agentId}
                  AND id NOT IN (${layer1Ids.slice(0, 50).map((id) => sql`${id}`).join(", ")})
                  AND tags && ${tagArr}
                  ORDER BY importance DESC, created_at DESC
                  LIMIT ${spikeThreshold}`
            );
            layer2 = (layer2Rows as Array<Record<string, unknown>>).map((r) => ({
              id: String(r.id),
              content: String(r.content),
              tags: r.tags as string[] | null,
              importance: Number(r.importance ?? 1),
              source: r.source as string | null,
            }));
          }
        }

        // Merge layer 1 + layer 2, then residual pyramid (dedup by content similarity)
        const merged = [...layer1, ...layer2];
        const seenIds = new Set<string>();
        const deduped: typeof merged = [];
        for (const mem of merged) {
          if (seenIds.has(mem.id)) continue;
          // Simple content dedup: skip if content prefix (first 50 chars) already seen
          const contentKey = mem.content.slice(0, 50).toLowerCase();
          const isDuplicate = deduped.some((d) => d.content.slice(0, 50).toLowerCase() === contentKey);
          if (!isDuplicate) {
            seenIds.add(mem.id);
            deduped.push(mem);
          }
        }

        // Apply limit, sort by importance desc
        const final = deduped
          .sort((a, b) => b.importance - a.importance)
          .slice(0, limit);

        const resultMemories = final.map((m) => ({
          id: m.id,
          content: m.content,
          tags: m.tags,
          importance: m.importance,
          source: m.source,
        }));

        // Cache for free-mode reuse (design doc §6.5)
        this.memoryCache.set(cacheKey, resultMemories);

        emitToolDone(true);
        return {
          ok: true,
          memories: resultMemories,
          count: resultMemories.length,
        };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to search memories", memories: [] };
      }
    }

    if (name === "memory_replace") {
      const args = safeJsonParse<{
        id?: string;
        content?: string;
        tags?: string[];
      }>(input.call.argumentsText, {});
      const id = (args.id ?? "").trim();
      const content = (args.content ?? "").trim();
      if (!id || !content) {
        emitToolDone(false);
        return { ok: false, error: "Missing id or content" };
      }

      try {
        const { getDb } = await import("@/db");
        const { sql } = await import("drizzle-orm");
        const db = getDb();

        if (args.tags) {
          await db.execute(
            sql`UPDATE memories SET content = ${content}, tags = ${args.tags} WHERE id = ${id} AND agent_id = ${this.agentId}`
          );
        } else {
          await db.execute(
            sql`UPDATE memories SET content = ${content} WHERE id = ${id} AND agent_id = ${this.agentId}`
          );
        }

        emitToolDone(true);
        return { ok: true, id };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to update memory" };
      }
    }

    if (name === "memory_remove") {
      const args = safeJsonParse<{ id?: string }>(input.call.argumentsText, {});
      const id = (args.id ?? "").trim();
      if (!id) {
        emitToolDone(false);
        return { ok: false, error: "Missing id" };
      }

      try {
        const { getDb } = await import("@/db");
        const { sql } = await import("drizzle-orm");
        const db = getDb();
        await db.execute(
          sql`DELETE FROM memories WHERE id = ${id} AND agent_id = ${this.agentId}`
        );
        emitToolDone(true);
        return { ok: true, id };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to remove memory" };
      }
    }

    if (name === "session_search") {
      const args = safeJsonParse<{
        query?: string;
        agentId?: string;
        limit?: number;
      }>(input.call.argumentsText, {});
      const query = (args.query ?? "").trim();
      if (!query) {
        emitToolDone(false);
        return { ok: false, error: "Missing query" };
      }

      try {
        const { getDb } = await import("@/db");
        const { sql } = await import("drizzle-orm");
        const db = getDb();
        const limit = Math.min(50, args.limit ?? 10);
        const searchAgentId = (args.agentId ?? "").trim() || null;

        let rows;
        if (searchAgentId) {
          rows = await db.execute(
            sql`SELECT id, content, summary, tags, archived_at
                FROM session_archive WHERE agent_id = ${searchAgentId}
                AND (content ILIKE ${`%${query}%`} OR summary ILIKE ${`%${query}%`})
                ORDER BY archived_at DESC LIMIT ${limit}`
          );
        } else {
          rows = await db.execute(
            sql`SELECT id, content, summary, tags, archived_at
                FROM session_archive
                WHERE content ILIKE ${`%${query}%`} OR summary ILIKE ${`%${query}%`}
                ORDER BY archived_at DESC LIMIT ${limit}`
          );
        }

        const sessions = (rows as Array<Record<string, unknown>>).map((r) => ({
          id: r.id,
          content: r.content,
          summary: r.summary,
          tags: r.tags,
        }));

        emitToolDone(true);
        return { ok: true, sessions, count: sessions.length };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to search sessions", sessions: [] };
      }
    }

    if (name === "create_backup") {
      try {
        const { store } = await import("@/lib/storage");
        const result = await store.backupWorkspace({ workspaceId });
        emitToolDone(true);
        return { ok: true, backupId: result.id, createdAt: result.createdAt };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to create backup" };
      }
    }

    if (name === "list_backups") {
      try {
        const { store } = await import("@/lib/storage");
        const backups = await store.listBackups({ workspaceId });
        emitToolDone(true);
        return { ok: true, backups };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to list backups" };
      }
    }

    if (name === "restore_backup") {
      const args = safeJsonParse<{ backupId?: string; confirm?: boolean }>(input.call.argumentsText, {});
      const backupId = (args.backupId ?? "").trim();
      if (!backupId) {
        emitToolDone(false);
        return { ok: false, error: "Missing backupId" };
      }
      if (!args.confirm) {
        emitToolDone(false);
        return { ok: false, error: "Must set confirm=true to restore. This operation is irreversible." };
      }

      try {
        const { store } = await import("@/lib/storage");
        const result = await store.restoreBackup({ backupId });
        emitToolDone(true);
        return { ok: true, workspaceId: result.workspaceId, restoredAt: result.restoredAt };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to restore backup" };
      }
    }

    const mcp = await getMcpRegistry(BUILTIN_TOOL_NAMES);
    if (mcp.hasTool(name)) {
      const args = safeJsonParse<Record<string, unknown>>(input.call.argumentsText, {});
      const result = await mcp.callTool(name, args);
      emitToolDone(result.ok);
      return result;
    }

    emitToolDone(false);
    return { ok: false, error: `Unknown tool: ${name}` };
  }

  private async callLlmStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const provider = getLlmProvider();
    if (provider === "ollama") {
      return this.callOllamaStreaming(history, ctx);
    }
    if (provider === "openrouter") {
      return this.callOpenRouterStreaming(history, ctx);
    }
    if (provider === "anthropic") {
      return this.callAnthropicStreaming(history, ctx);
    }
    return this.callGlmStreaming(history, ctx);
  }

  private async callOpenRouterStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { apiKey, baseUrl, model, httpReferer, appTitle } = getOpenRouterConfig();

    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.start",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
      },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "start",
    });

    const tools = await getAgentTools();
    const payload: Record<string, unknown> = {
      // Preserve reasoning for OpenRouter using the canonical "reasoning" field.
      messages: mapOpenRouterMessages(history),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (model) payload.model = model;
    if (tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = "auto";
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (httpReferer) headers["HTTP-Referer"] = httpReferer;
    if (appTitle) headers["X-Title"] = appTitle;

    const requestBody = JSON.stringify(payload);
    void appendAgentLlmRequestRaw({ agentId: this.agentId, body: requestBody });

    const upstream = await fetchWithRetry(baseUrl, {
      method: "POST",
      headers,
      body: requestBody,
    }, "OpenRouter");

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      throw new Error(`OpenRouter upstream error: ${upstream.status} ${text}`);
    }

    const assembler = new OpenAIStreamAssembler();
    let prev = assembler.snapshot();
    let assistantText = "";
    let assistantThinking = "";

    for await (const evt of parseSSEJsonLines(upstream.body)) {
      const state = assembler.push(evt as any);

      const reasoningDelta = state.reasoningContent.slice(prev.reasoningContent.length);
      const contentDelta = state.content.slice(prev.content.length);
      const toolCallDeltas = extractToolCallDeltas(evt as any, prev, state);

      if (reasoningDelta) {
        assistantThinking += reasoningDelta;
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: { kind: "reasoning", delta: reasoningDelta },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round: ctx.round,
          kind: "reasoning",
          delta: reasoningDelta,
        });
      }

      if (contentDelta) {
        assistantText += contentDelta;
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: { kind: "content", delta: contentDelta },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round: ctx.round,
          kind: "content",
          delta: contentDelta,
        });
      }

      for (const delta of toolCallDeltas) {
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: {
            kind: "tool_calls",
            delta: delta.delta,
            tool_call_id: delta.tool_call_id,
            tool_call_name: delta.tool_call_name,
          },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round: ctx.round,
          kind: "tool_calls",
          delta: delta.delta,
          tool_call_id: delta.tool_call_id,
          tool_call_name: delta.tool_call_name,
        });
      }

      prev = state;
    }

    this.bus.emit(this.agentId, {
      event: "agent.done",
      data: { finishReason: prev.finishReason ?? undefined },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "done",
      finishReason: prev.finishReason ?? null,
    });
    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.done",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
        finishReason: prev.finishReason ?? undefined,
      },
    });

    const finalState = assembler.snapshot();

    if (finalState.usage && finalState.usage.totalTokens > 0) {
      try {
        await store.setGroupContextTokens({
          groupId: ctx.groupId,
          tokens: finalState.usage.totalTokens,
        });
      } catch {
        // Best effort - don't fail if token tracking fails
      }
    }

    return {
      assistantText,
      assistantThinking,
      toolCalls: (finalState.toolCalls ?? []) as ToolCall[],
      finishReason: finalState.finishReason,
    };
  }

  private async callAnthropicStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { apiKey, baseUrl, model } = getAnthropicConfig();

    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.start",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
      },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "start",
    });

    const tools = await getAgentTools();
    const messages = history.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    const payload: Record<string, unknown> = {
      model,
      messages,
      max_tokens: 8192,
      stream: true,
    };
    if (tools.length > 0) {
      payload.tools = tools.map((t: any) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      }));
    }

    const requestBody = JSON.stringify(payload);
    void appendAgentLlmRequestRaw({ agentId: this.agentId, body: requestBody });

    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };

    const upstream = await fetchWithRetry(baseUrl, {
      method: "POST",
      headers,
      body: requestBody,
    }, "Anthropic");

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      throw new Error(`Anthropic upstream error: ${upstream.status} ${text}`);
    }

    const decoder = new TextDecoder();
    let contentDelta = "";
    const toolCalls: ToolCall[] = [];
    let currentToolId = "";
    let currentToolName = "";
    let currentToolArgs = "";
    let buffer = "";

    const reader = upstream.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const data = JSON.parse(trimmed.slice(6));
          if (data.type === "content_block_delta") {
            if (data.delta?.type === "text_delta") {
              contentDelta += data.delta.text;
              this.bus.emit(this.agentId, {
                event: "agent.stream",
                data: { kind: "content", delta: data.delta.text },
              });
              void appendAgentStreamEvent({
                agentId: this.agentId,
                round: ctx.round,
                kind: "content",
                delta: data.delta.text,
              });
            } else if (data.delta?.type === "input_json_delta") {
              currentToolArgs += data.delta.partial_json;
            }
          } else if (data.type === "content_block_start") {
            if (data.content_block?.type === "tool_use") {
              currentToolId = data.content_block.id;
              currentToolName = data.content_block.name;
              currentToolArgs = "";
              this.bus.emit(this.agentId, {
                event: "agent.stream",
                data: {
                  kind: "tool_calls",
                  delta: JSON.stringify({ name: currentToolName, id: currentToolId }),
                  tool_call_id: currentToolId,
                  tool_call_name: currentToolName,
                },
              });
              void appendAgentStreamEvent({
                agentId: this.agentId,
                round: ctx.round,
                kind: "tool_calls",
                delta: JSON.stringify({ name: currentToolName, id: currentToolId }),
                tool_call_id: currentToolId,
                tool_call_name: currentToolName,
              });
            }
          } else if (data.type === "content_block_stop") {
            if (currentToolId && currentToolName) {
              toolCalls.push({
                index: toolCalls.length,
                id: currentToolId,
                name: currentToolName,
                argumentsText: currentToolArgs,
              });
            }
            currentToolId = "";
            currentToolName = "";
            currentToolArgs = "";
          } else if (data.type === "message_delta") {
            // stop_reason available here
          } else if (data.type === "message_start") {
            // message started
          }
        } catch {
          // skip malformed SSE data
        }
      }
    }
    reader.releaseLock();

    const finishReason = toolCalls.length > 0 ? "tool_calls" : "stop";

    this.bus.emit(this.agentId, {
      event: "agent.done",
      data: { finishReason },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "done",
      finishReason,
    });
    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.done",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
        finishReason,
      },
    });

    return {
      assistantText: contentDelta,
      assistantThinking: "",
      toolCalls,
      finishReason,
    };
  }

  private async callGlmStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { apiKey, baseUrl, model } = getGlmConfig();

    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.start",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
      },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "start",
    });

    const glmPayload: Record<string, unknown> = {
      model,
      messages: history,
      tools: await getAgentTools(),
      tool_choice: "auto",
      stream: true,
      tool_stream: true,
    };
    const requestBody = JSON.stringify(glmPayload);
    void appendAgentLlmRequestRaw({ agentId: this.agentId, body: requestBody });

    const upstream = await fetchWithRetry(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: requestBody,
    }, "GLM");

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      throw new Error(`GLM upstream error: ${upstream.status} ${text}`);
    }

    const assembler = new GLMStreamAssembler();
    let prev = assembler.snapshot();
    let assistantText = "";
    let assistantThinking = "";

    for await (const evt of parseSSEJsonLines(upstream.body)) {
      const state = assembler.push(evt as any);

      const reasoningDelta = state.reasoningContent.slice(prev.reasoningContent.length);
      const contentDelta = state.content.slice(prev.content.length);
      const toolCallDeltas = extractToolCallDeltas(evt as any, prev, state);

      if (reasoningDelta) {
        assistantThinking += reasoningDelta;
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: { kind: "reasoning", delta: reasoningDelta },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round: ctx.round,
          kind: "reasoning",
          delta: reasoningDelta,
        });
      }

      if (contentDelta) {
        assistantText += contentDelta;
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: { kind: "content", delta: contentDelta },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round: ctx.round,
          kind: "content",
          delta: contentDelta,
        });
      }

      for (const delta of toolCallDeltas) {
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: {
            kind: "tool_calls",
            delta: delta.delta,
            tool_call_id: delta.tool_call_id,
            tool_call_name: delta.tool_call_name,
          },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round: ctx.round,
          kind: "tool_calls",
          delta: delta.delta,
          tool_call_id: delta.tool_call_id,
          tool_call_name: delta.tool_call_name,
        });
      }

      prev = state;
    }

    this.bus.emit(this.agentId, {
      event: "agent.done",
      data: { finishReason: prev.finishReason ?? undefined },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "done",
      finishReason: prev.finishReason ?? null,
    });
    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.done",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
        finishReason: prev.finishReason ?? undefined,
      },
    });

    const finalState = assembler.snapshot();

    // Save token usage (current context window size)
    if (finalState.usage && finalState.usage.totalTokens > 0) {
      try {
        await store.setGroupContextTokens({
          groupId: ctx.groupId,
          tokens: finalState.usage.totalTokens,
        });
      } catch {
        // Best effort - don't fail if token tracking fails
      }
    }

    return {
      assistantText,
      assistantThinking,
      toolCalls: (finalState.toolCalls ?? []) as ToolCall[],
      finishReason: finalState.finishReason,
    };
  }

  private async callOllamaStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { baseUrl, model } = getOllamaConfig();

    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.start",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
      },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "start",
    });

    const tools = await getAgentTools();
    const payload: Record<string, unknown> = {
      messages: mapOpenRouterMessages(history),
      model,
      stream: true,
      stream_options: { include_usage: true },
    };
    if (tools.length > 0) {
      payload.tools = tools;
      payload.tool_choice = "auto";
    }

    const requestBody = JSON.stringify(payload);
    void appendAgentLlmRequestRaw({ agentId: this.agentId, body: requestBody });

    const upstream = await fetchWithRetry(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: requestBody,
    }, "Ollama");

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      throw new Error(`Ollama upstream error: ${upstream.status} ${text}`);
    }

    const assembler = new OpenAIStreamAssembler();
    let prev = assembler.snapshot();
    let assistantText = "";
    let assistantThinking = "";

    for await (const evt of parseSSEJsonLines(upstream.body)) {
      const state = assembler.push(evt as any);

      const reasoningDelta = state.reasoningContent.slice(prev.reasoningContent.length);
      const contentDelta = state.content.slice(prev.content.length);
      const toolCallDeltas = extractToolCallDeltas(evt as any, prev, state);

      if (reasoningDelta) {
        assistantThinking += reasoningDelta;
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: { kind: "reasoning", delta: reasoningDelta },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round: ctx.round,
          kind: "reasoning",
          delta: reasoningDelta,
        });
      }

      if (contentDelta) {
        assistantText += contentDelta;
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: { kind: "content", delta: contentDelta },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round: ctx.round,
          kind: "content",
          delta: contentDelta,
        });
      }

      for (const delta of toolCallDeltas) {
        this.bus.emit(this.agentId, {
          event: "agent.stream",
          data: {
            kind: "tool_calls",
            delta: delta.delta,
            tool_call_id: delta.tool_call_id,
            tool_call_name: delta.tool_call_name,
          },
        });
        void appendAgentStreamEvent({
          agentId: this.agentId,
          round: ctx.round,
          kind: "tool_calls",
          delta: delta.delta,
          tool_call_id: delta.tool_call_id,
          tool_call_name: delta.tool_call_name,
        });
      }

      prev = state;
    }

    this.bus.emit(this.agentId, {
      event: "agent.done",
      data: { finishReason: prev.finishReason ?? undefined },
    });
    void appendAgentStreamEvent({
      agentId: this.agentId,
      round: ctx.round,
      kind: "done",
      finishReason: prev.finishReason ?? null,
    });
    getWorkspaceUIBus().emit(ctx.workspaceId, {
      event: "ui.agent.llm.done",
      data: {
        workspaceId: ctx.workspaceId,
        agentId: this.agentId,
        groupId: ctx.groupId,
        round: ctx.round,
        finishReason: prev.finishReason ?? undefined,
      },
    });

    const finalState = assembler.snapshot();

    if (finalState.usage && finalState.usage.totalTokens > 0) {
      try {
        await store.setGroupContextTokens({
          groupId: ctx.groupId,
          tokens: finalState.usage.totalTokens,
        });
      } catch {
        // Best effort
      }
    }

    return {
      assistantText,
      assistantThinking,
      toolCalls: (finalState.toolCalls ?? []) as ToolCall[],
      finishReason: finalState.finishReason,
    };
  }
}

function extractToolCallDeltas(
  chunk: {
    choices?: Array<{
      delta?: {
        tool_calls?: Array<{
          index?: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  },
  prevState: { toolCalls: Array<{ index: number; id?: string; name?: string; argumentsText: string }> },
  nextState: { toolCalls: Array<{ index: number; id?: string; name?: string; argumentsText: string }> }
): Array<{ delta: string; tool_call_id?: string; tool_call_name?: string }> {
  const deltas: Array<{ delta: string; tool_call_id?: string; tool_call_name?: string }> = [];
  const toolCalls = chunk.choices?.[0]?.delta?.tool_calls ?? [];
  if (toolCalls.length === 0) return deltas;

  const prevByIndex = new Map(prevState.toolCalls.map((call) => [call.index, call]));
  const nextByIndex = new Map(nextState.toolCalls.map((call) => [call.index, call]));

  for (const call of toolCalls) {
    const index = call.index ?? 0;
    const prev = prevByIndex.get(index);
    const next = nextByIndex.get(index);
    const name = call.function?.name ?? next?.name;
    const id = call.id ?? next?.id;
    const argsChunk = call.function?.arguments ?? "";

    if (argsChunk) {
      deltas.push({ delta: argsChunk, tool_call_id: id, tool_call_name: name });
      continue;
    }

    if (name && name !== prev?.name) {
      deltas.push({ delta: "", tool_call_id: id, tool_call_name: name });
    }
  }

  return deltas;
}

export class AgentRuntime {
  private readonly runners = new Map<UUID, AgentRunner>();
  public readonly bus = new AgentEventBus();
  private bootstrapped = false;
  static readonly VERSION = 2;

  async bootstrap() {
    if (this.bootstrapped) return;
    this.bootstrapped = true;

    const agents = await store.listAgents();
    for (const a of agents) {
      if (a.role === "human") continue;
      this.ensureRunner(a.id);
    }
  }

  ensureRunner(agentId: UUID) {
    const existing = this.runners.get(agentId);
    if (existing) return existing;
    const runner = new AgentRunner(
      agentId,
      this.bus,
      (id) => {
        this.ensureRunner(id);
      },
      (id) => {
        this.ensureRunner(id).wakeup("manual");
      },
      (id) => {
        this.stopRunner(id);
      }
    );
    this.runners.set(agentId, runner);
    runner.start();
    return runner;
  }

  async wakeAgentsForGroup(groupId: UUID, senderId: UUID) {
    await this.bootstrap();
    const memberIds = await store.listGroupMemberIds({ groupId });
    console.info(`[wakeAgentsForGroup] group=${groupId}, members=${memberIds.join(",")}, sender=${senderId}`);

    // Separate coordinator from workers to wake coordinator first
    const coordinatorId = await this.findCoordinator(groupId);
    const workers = memberIds.filter((m) => m !== senderId && m !== coordinatorId);

    // Wake coordinator immediately
    if (coordinatorId && coordinatorId !== senderId) {
      try {
        const role = await store.getAgentRole({ agentId: coordinatorId });
        if (role !== "human" && role !== null) {
          console.info(`[wakeAgentsForGroup] Waking coordinator ${coordinatorId} (${role}) immediately`);
          this.ensureRunner(coordinatorId).wakeup("group_message");
        }
      } catch (err) {
        console.error(`[wakeAgentsForGroup] Failed to wake coordinator ${coordinatorId}:`, err);
      }
    }

    // Wake workers with staggered delay: base 500-2000ms + random jitter 0-1000ms
    for (let i = 0; i < workers.length; i++) {
      const memberId = workers[i];
      // Each worker waits baseDelay * (i+1) + randomJitter
      const baseDelay = 500 + (i * 500); // 500ms, 1000ms, 1500ms...
      const jitter = Math.floor(Math.random() * 1000); // 0-1000ms random
      const delayMs = Math.min(baseDelay + jitter, 3000); // cap at 3s

      (async () => {
        await new Promise((r) => setTimeout(r, delayMs));
        try {
          const role = await store.getAgentRole({ agentId: memberId });
          if (role === "human" || role === null) return;
          console.info(`[wakeAgentsForGroup] Waking worker ${memberId} (${role}) after ${delayMs}ms`);
          this.ensureRunner(memberId).wakeup("group_message");
        } catch (err) {
          console.error(`[wakeAgentsForGroup] Failed to wake agent ${memberId}:`, err);
        }
      })();
    }
  }

  /**
   * Find the coordinator (group creator) for a given group.
   */
  private async findCoordinator(groupId: UUID): Promise<string | null> {
    try {
      const db = getDb();
      const rows = await db.execute(
        sql`SELECT creator_id FROM groups WHERE id = ${groupId} LIMIT 1`
      );
      const result = (rows as unknown as Array<{ creator_id: string }>)[0];
      return result?.creator_id ?? null;
    } catch {
      return null;
    }
  }

  async wakeAgent(agentId: UUID, reason: "direct_message" | "context_stream" = "direct_message") {
    await this.bootstrap();
    const role = await store.getAgentRole({ agentId }).catch(() => null);
    if (role === "human" || role === null) return;
    this.ensureRunner(agentId).wakeup(reason);
  }

  async interruptAll(input?: { workspaceId?: UUID }) {
    await this.bootstrap();
    const workspaceId = input?.workspaceId?.trim();
    const agents = await store.listAgents(workspaceId ? { workspaceId } : undefined);
    const agentIds = agents.filter((agent) => agent.role !== "human").map((agent) => agent.id);

    for (const agentId of agentIds) {
      this.ensureRunner(agentId).requestInterrupt();
    }

    return { interrupted: agentIds.length, agentIds };
  }

  stopRunner(agentId: UUID) {
    const runner = this.runners.get(agentId);
    if (runner) {
      runner.requestInterrupt();
      this.runners.delete(agentId);
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __agentWechatRuntime: AgentRuntime | undefined;
  // eslint-disable-next-line no-var
  var __agentWechatRuntimeVersion: number | undefined;
}

export function getAgentRuntime() {
  if (
    globalThis.__agentWechatRuntime &&
    globalThis.__agentWechatRuntimeVersion === AgentRuntime.VERSION
  ) {
    return globalThis.__agentWechatRuntime;
  }

  globalThis.__agentWechatRuntime = new AgentRuntime();
  globalThis.__agentWechatRuntimeVersion = AgentRuntime.VERSION;
  return globalThis.__agentWechatRuntime;
}

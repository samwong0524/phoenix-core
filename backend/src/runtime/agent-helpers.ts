import { HistoryMessage, UUID, SKILLS_MARKER, SOUL_MARKER } from "./agent-types";
import { COMPRESS_TRIGGER, COMPRESS_PROTECT_FIRST, COMPRESS_PROTECT_LAST, COMPRESS_MAX_CONTENT } from "./agent-constants";
import { sql } from "drizzle-orm";
import { safeJsonParse } from "./utils";
import { getSkillLoader } from "./skill-loader";
import * as path from "path";
import * as fs from "fs/promises";

export function historyHasTool(history: HistoryMessage[], toolNames: Set<string>): boolean {
  return history.some((msg) =>
    msg.role === "tool" &&
    typeof msg.name === "string" &&
    toolNames.has(msg.name)
  );
}

export function buildTextArray(arr: string[]): ReturnType<typeof sql> {
  if (arr.length === 0) return sql`ARRAY[]::text[]`;
  return sql`ARRAY[${sql.join(arr.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

// Runtime settings — mutable at request time for live model switching without restart.
export const runtimeSettings = new Map<string, string>();
export const RUNTIME_SETTINGS: Record<string, { validate: (v: string) => boolean }> = {
  freellmapi_model: {
    validate: (v: string) => v === "auto" || (/^[a-zA-Z0-9][a-zA-Z0-9./_-]{0,127}$/.test(v)),
  },
};

export function setRuntimeSetting(key: string, value: string) {
  const spec = RUNTIME_SETTINGS[key];
  if (spec && !spec.validate(value)) {
    throw new Error(`Invalid value for ${key}: ${JSON.stringify(value)}`);
  }
  runtimeSettings.set(key, value);
}

export function getRuntimeSetting(key: string): string | undefined {
  return runtimeSettings.get(key);
}

export function uuid(): UUID {
  return crypto.randomUUID();
}

export function historyHasSuccessfulTool(history: HistoryMessage[], toolNames: Set<string>): boolean {
  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    if (msg.role !== "assistant" || !msg.tool_calls) continue;
    const calls = msg.tool_calls as Array<{ function?: { name?: string } }>;
    const hasMatching = calls.some((tc) => toolNames.has(tc.function?.name ?? ""));
    if (!hasMatching) continue;
    for (let j = i + 1; j < history.length; j++) {
      if (history[j].role !== "tool") break;
      const rawContent = history[j].content;
      const contentStr = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
      try {
        const parsed = JSON.parse(contentStr);
        if (parsed.ok === true) return true;
      } catch {
        // skip parse errors
      }
    }
  }
  return false;
}

export async function buildSkillsBlock(role?: string): Promise<string> {
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
    const enabledOnly = withDepsOk.filter((skill) => !skill.disabled);
    const roleFiltered = enabledOnly.filter((skill) => {
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
    const skillsParts = [skillsMeta].filter((part) => part && part.trim());
    if (skillsParts.length === 0) return "";
    return `${SKILLS_MARKER}\n\n${skillsParts.join("\n\n")}`;
  } catch {
    return "";
  }
}

let cachedSoul: string | null = null;
let soulLoadAttempted = false;

export function invalidateSoulCache() {
  cachedSoul = null;
  soulLoadAttempted = false;
}

export async function loadSoulMd(): Promise<string> {
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

export function historyHasSoul(history: HistoryMessage[]) {
  return history.some(
    (msg) =>
      msg.role === "system" && typeof msg.content === "string" && msg.content.includes(SOUL_MARKER)
  );
}

export function historyHasSkills(history: HistoryMessage[]) {
  return history.some(
    (msg) =>
      msg.role === "system" && typeof msg.content === "string" && msg.content.includes(SKILLS_MARKER)
  );
}

export function shortId(id: unknown): string {
  const s = String(id ?? "");
  return s.length > 8 ? s.slice(0, 8) + "..." : s;
}

export function extractToolFact(msg: Extract<HistoryMessage, { role: "tool" }>): string | null {
  const contentStr = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
  const result = safeJsonParse<Record<string, unknown>>(contentStr, {});
  const ok = result?.ok !== false;
  const name = msg.name ?? "unknown";
  if (name === "self" || name === "get_skill") return null;
  switch (name) {
    case "create":
      return ok
        ? `Created agent(role="${result.role}", id="${shortId(result.agentId)}")`
        : `Create agent failed: ${result.error ?? "unknown"}`;
    case "create_skill":
      return ok
        ? `Created skill at "${result.path}"`
        : `Create skill failed: ${result.error ?? "unknown"}`;
    case "create_group":
      return ok
        ? `Created group(name="${result.name}", id="${shortId(result.groupId)}")`
        : `Create group failed: ${result.error ?? "unknown"}`;
    case "add_group_members":
      return ok
        ? `Added ${(result.addedMembersIds as string[] | undefined)?.length ?? "?"} members to group ${shortId(result.groupId)}`
        : `Add members failed: ${result.error ?? "unknown"}`;
    case "delete_agent":
      return ok
        ? `Deleted agent(role="${result.role}")`
        : `Delete agent failed: ${result.error ?? "unknown"}`;
    case "delete_group":
      return ok
        ? `Deleted group(id="${shortId(result.groupId)}")`
        : `Delete group failed: ${result.error ?? "unknown"}`;
    case "send":
    case "send_group_message":
    case "send_direct_message":
      return ok ? `Sent message to ${shortId(String(result.groupId ?? result.toId ?? result.channel ?? "?"))}` : null;
    case "bash": {
      const exit = result.exitCode !== undefined ? result.exitCode : (result.signal ? `signal ${result.signal}` : "?");
      return `bash: exit ${exit}`;
    }
    case "list_agents":
      return ok ? `Listed ${(result.agents as unknown[] | undefined)?.length ?? "?"} agents` : null;
    case "list_groups":
      return ok ? `Listed ${(result.groups as unknown[] | undefined)?.length ?? "?"} groups` : null;
    case "list_group_members":
      return ok ? `Listed ${(result.members as unknown[] | undefined)?.length ?? "?"} members` : null;
    case "get_group_messages":
      return ok ? `Read ${(result.messages as unknown[] | undefined)?.length ?? "?"} messages from group ${shortId(result.groupId)}` : null;
    case "get_workflow_status": {
      const wf = result.workflow as Record<string, unknown> | null | undefined;
      if (wf) {
        return `Workflow: ${wf.name} (status=${wf.status}, tasks=${(result.tasks as unknown[] | undefined)?.length ?? "?"})`;
      }
      return "No workflow found";
    }
    default:
      return ok ? `${name}: ok` : `${name}: failed`;
  }
}

export function summarizeUserMessage(content: string): string {
  const MAX = 120;
  if (content.length <= MAX) return content;
  const dot = content.indexOf(".");
  if (dot > 0 && dot < MAX) return content.slice(0, dot + 1);
  return content.slice(0, MAX) + "...";
}

export function compressHistory(history: HistoryMessage[]) {
  if (history.length <= COMPRESS_TRIGGER) return;
  const systemMsgs = history.filter((m) => m.role === "system");
  const protectedSystems = systemMsgs.slice(0, COMPRESS_PROTECT_FIRST);
  const nonSystem = history.filter((m) => m.role !== "system");
  if (nonSystem.length <= COMPRESS_PROTECT_LAST) return;
  const keepStart = nonSystem.slice(0, 1);
  const keepEnd = nonSystem.slice(-COMPRESS_PROTECT_LAST);
  const compressed = nonSystem.slice(1, nonSystem.length - COMPRESS_PROTECT_LAST);
  const trimmed = [...keepStart, ...keepEnd].map((m) => {
    if (typeof m.content === "string" && m.content.length > COMPRESS_MAX_CONTENT) {
      return { ...m, content: m.content.slice(0, COMPRESS_MAX_CONTENT) + "\n...[truncated]" };
    }
    return m;
  });
  const trimmedStart = trimmed.slice(0, keepStart.length);
  const trimmedEnd = trimmed.slice(keepStart.length);
  const facts: string[] = [];
  for (const msg of compressed) {
    if (msg.role === "tool") {
      const toolMsg = msg as Extract<HistoryMessage, { role: "tool" }>;
      const fact = extractToolFact(toolMsg);
      if (fact) facts.push(`  - ${fact}`);
    } else if (msg.role === "user") {
      const snippet = summarizeUserMessage(typeof msg.content === "string" ? msg.content : "");
      if (snippet) facts.push(`  - User: ${snippet}`);
    } else if (msg.role === "assistant") {
      const text = typeof msg.content === "string" ? msg.content.trim() : "";
      if (text.length > 0 && !text.startsWith("[")) {
        const snippet = text.length > 100 ? text.slice(0, 100) + "..." : text;
        facts.push(`  - Assistant: ${snippet}`);
      }
    }
  }
  const summaryLines = [`[${compressed.length} messages compressed]`];
  if (facts.length > 0) {
    summaryLines.push(...facts);
  } else {
    summaryLines.push("  (no significant outcomes in this region)");
  }
  const summaryText = summaryLines.join("\n").slice(0, COMPRESS_MAX_CONTENT);
  const summary: HistoryMessage = {
    role: "system",
    content: summaryText,
  };
  history.length = 0;
  history.push(...protectedSystems, summary, ...trimmedStart, ...trimmedEnd);
}

export function mapOpenRouterMessages(history: HistoryMessage[]): Array<Record<string, unknown>> {
  const systems: HistoryMessage[] = [];
  const others: HistoryMessage[] = [];
  for (const msg of history) {
    if (msg.role === "system") systems.push(msg);
    else others.push(msg);
  }
  const normalized = [...systems, ...others];

  // First pass: collect all valid tool_call_ids from assistant messages
  const validToolCallIds = new Set<string>();
  for (const msg of normalized) {
    if (msg.role === "assistant" && msg.tool_calls && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        if (tc.id) validToolCallIds.add(tc.id);
      }
    }
  }

  // Second pass: filter out orphaned tool messages (no matching assistant tool_call)
  const filtered = normalized.filter((msg) => {
    if (msg.role === "tool") {
      const toolMsg = msg as HistoryMessage & { role: "tool"; tool_call_id?: string };
      if (!toolMsg.tool_call_id || !validToolCallIds.has(toolMsg.tool_call_id)) {
        return false; // orphaned tool message — strip it
      }
    }
    return true;
  });

  return filtered.map((msg) => {
    if (msg.role === "tool") return msg;

    const { reasoning_content, ...rest } = msg as Exclude<HistoryMessage, { role: 'tool' }>;
    const mapped: Record<string, unknown> = { ...rest };

    if (mapped.content === null || mapped.content === undefined) {
      mapped.content = '';
    }

    if (msg.role === 'assistant' && reasoning_content) {
      mapped.reasoning = reasoning_content;
    }

    if (msg.role === 'assistant' && msg.tool_calls && Array.isArray(msg.tool_calls)) {
      mapped.tool_calls = (msg.tool_calls as Array<Record<string, unknown>>).map((tc) => {
        if (tc.function && typeof tc.function === 'object') {
          const fn = tc.function as Record<string, unknown>;
          const args = fn.arguments;
          if (typeof args === 'string') {
            try { JSON.parse(args); } catch { fn.arguments = '{}'; }
          } else if (typeof args === 'object' && args !== null) {
            fn.arguments = JSON.stringify(args);
          } else {
            fn.arguments = '{}';
          }
        }
        return tc;
      });
    }
    return mapped;
  });
}

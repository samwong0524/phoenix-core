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

// ─── Cognitive Pipeline: pure helper functions ──────────────────────────────
// Extracted from inline agent-runtime.ts logic for testability.

/**
 * Detect whether a bash command is a verification tool (type-check, unit-test,
 * e2e-test, or build). Returns the matched tool name or null.
 */
export function detectVerificationTool(command: string): string | null {
  const re = /\b(npx\s+playwright|playwright\s+test|npx\s+tsc|npx\s+vitest|tsc|vitest|jest|npm\s+test|npm\s+run\s+test|next\s+build|npm\s+run\s+build)\b/;
  const m = command.match(re);
  return m ? m[1] : null;
}

/**
 * Detect whether a bash command modifies code (in-place edits, file creation,
 * directory creation, build output).
 */
export function isCodeModificationBash(command: string): boolean {
  return /\b(sed\s+-i|tee\s|mkdir|npm\s+run\s+build|next\s+build)\b/.test(command) ||
         /\b(echo\s+.*>|cat\s+.*>|printf\s+.*>|>>)/.test(command);
}

/**
 * Detect whether a tool name represents a file-modification tool.
 */
export function isFileModificationTool(toolName: string): boolean {
  return toolName === "write_file" || toolName === "edit_file" ||
         toolName === "patch_file" || toolName === "create_backup";
}

/**
 * Parse a verification tool's result string for errors.
 * Returns a summary string if errors found, null if clean.
 */
export function parseVerificationResult(command: string, resultStr: string): string | null {
  const isTsc = /\btsc\b/.test(command);
  const isVitest = /\bvitest\b|npm\s+(run\s+)?test\b/.test(command);
  const isPlaywright = /\bplaywright\b/.test(command);
  const isBuild = /\bnext\s+build\b|npm\s+run\s+build\b/.test(command);

  if (isTsc) {
    // tsc format: src/file.ts(12,5): error TS2345: message
    const tscErrorRe = /(\S+?\.\w+)\((\d+),(\d+)\):\s*(error TS\d+:\s*[^\n]+)/g;
    const locations: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = tscErrorRe.exec(resultStr)) !== null && locations.length < 5) {
      locations.push(`${m[1]}:${m[2]} — ${m[4]}`);
    }
    if (locations.length > 0) {
      const total = (resultStr.match(/error TS\d+/g) || []).length;
      const suffix = total > 5 ? ` (+${total - 5} more)` : "";
      return `tsc: ${total} type error(s)\n${locations.join("\n")}${suffix}`;
    }
    // Fallback: match error codes without locations
    const tscErrors = resultStr.match(/error TS\d+/g);
    const exitCode = resultStr.match(/exit code[:\s]+(\d+)/i);
    if (tscErrors && tscErrors.length > 0) {
      return `tsc: ${tscErrors.length} type error(s) — ${tscErrors.slice(0, 3).join(", ")}${tscErrors.length > 3 ? "..." : ""}`;
    }
    if (exitCode && parseInt(exitCode[1]) !== 0) {
      return `tsc: exited with code ${exitCode[1]}`;
    }
  }
  if (isVitest) {
    const failedMatch = resultStr.match(/(\d+)\s*failed/);
    if (failedMatch && parseInt(failedMatch[1]) > 0) {
      // Extract failing test file + line: "❯ path/to/test.ts:15:20" or "FAIL tests/file.test.ts"
      const failLocations: string[] = [];
      const failLineRe = /[❯✗×]\s*(\S+?\.(?:test|spec)\.\w+):(\d+)/g;
      let fm: RegExpExecArray | null;
      while ((fm = failLineRe.exec(resultStr)) !== null && failLocations.length < 5) {
        failLocations.push(`${fm[1]}:${fm[2]}`);
      }
      // Also try FAIL lines: "FAIL  tests/core/foo.test.ts > describe > test name"
      const failNameRe = /\bFAIL\s+(\S+?\.(?:test|spec)\.\w+)(?:\s*>\s*([^\n]+))?/g;
      const failNames: string[] = [];
      let fn: RegExpExecArray | null;
      while ((fn = failNameRe.exec(resultStr)) !== null && failNames.length < 5) {
        failNames.push(fn[2] ? `${fn[1]}: ${fn[2].trim()}` : fn[1]);
      }
      const detail = failLocations.length > 0 ? `\n${failLocations.join("\n")}` :
                     failNames.length > 0 ? `\n${failNames.join("\n")}` : "";
      return `vitest: ${failedMatch[1]} test(s) failed${detail}`;
    }
  }
  if (isPlaywright) {
    const failedMatch = resultStr.match(/(\d+)\s*failed/);
    if (failedMatch && parseInt(failedMatch[1]) > 0) {
      // Playwright format: "1) tests/e2e/auth.spec.ts:23:5 › suite › test name"
      const pwLocations: string[] = [];
      const pwRe = /\d+\)\s+(\S+?\.\w+):(\d+):\d+(?:\s*›\s*([^\n]+))?/g;
      let pm: RegExpExecArray | null;
      while ((pm = pwRe.exec(resultStr)) !== null && pwLocations.length < 5) {
        pwLocations.push(pm[3] ? `${pm[1]}:${pm[2]} — ${pm[3].trim()}` : `${pm[1]}:${pm[2]}`);
      }
      const detail = pwLocations.length > 0 ? `\n${pwLocations.join("\n")}` : "";
      return `playwright: ${failedMatch[1]} test(s) failed${detail}`;
    }
  }
  if (isBuild) {
    // Next.js build: "./src/pages/api/users.ts\nType error: ... \n  12 | ..."
    const buildFileRe = /\.\/(\S+?\.\w+)\n.*?(?:Type error|Failed to compile|Build error)[:\s]*([^\n]*)/i;
    const buildMatch = buildFileRe.exec(resultStr);
    if (buildMatch) {
      // Try to extract the line number from the code preview (e.g., "  12 | ...")
      const lineRe = /^\s*(\d+)\s*\|/m;
      const lineMatch = lineRe.exec(resultStr);
      const line = lineMatch ? `:${lineMatch[1]}` : "";
      return `build: ${buildFileRe.exec(resultStr)?.[2]?.trim() || "compilation error"} in ${buildMatch[1]}${line}`;
    }
    if (/Failed to compile|Build error|Type error/i.test(resultStr)) {
      return `build: compilation error detected`;
    }
  }
  return null;
}

/**
 * Detect execution-plan indicators in text (Chinese or English).
 */
export function hasPlanIndicators(text: string): boolean {
  return /执行方案|执行计划|实施计划|implementation plan|execution plan/i.test(text) &&
         text.length > 80;
}

/**
 * Detect high-risk operation indicators in text.
 */
export function hasHighRiskIndicators(text: string): boolean {
  return /high\s*risk|复杂|危险|critical|5\+\s*files|database\s+migrat|db\s+migrat/i.test(text);
}

/**
 * Detect whether tool names include a communication tool.
 */
export function hasCommunicationTool(toolNames: string[]): boolean {
  const commTools = new Set(["ask_user", "send_group_message", "send_direct_message"]);
  return toolNames.some((t) => commTools.has(t));
}

/**
 * Detect whether content is a completion message (English or Chinese).
 * Note: CJK characters don't work with \b word boundary, so no \b used.
 */
export function isCompletionMessage(content: string): boolean {
  return /\b(done|complete|finished|completed)\b/i.test(content) ||
         /(已完成|搞定了|做好了|完毕)/.test(content);
}

/**
 * Decision: should the Verification Gate block a Worker's completion message?
 * Returns true when the Worker modified code but ran no verification tools.
 */
export function shouldBlockCompletion(
  isWorker: boolean,
  hasWorkflow: boolean,
  isCompletion: boolean,
  codeModified: boolean,
  verificationRan: boolean,
): boolean {
  return isWorker && hasWorkflow && isCompletion && codeModified && !verificationRan;
}

/**
 * Decision: should the system nudge the agent to run verification?
 * Returns true when 3+ code modifications have happened without any verification.
 */
export function shouldNudgeVerification(
  codeModificationCount: number,
  verificationToolsCalledSize: number,
): boolean {
  return codeModificationCount >= 3 && verificationToolsCalledSize === 0;
}

// ─── Pre-flight Token Budget ──────────────────────────────────────────────────

/**
 * Estimate the number of tokens in a text string.
 * Uses a heuristic: ~4 chars/token for English, ~2 chars/token for CJK.
 * Good enough for budget gating (not billing-grade).
 */
export function estimatePromptTokens(history: HistoryMessage[]): number {
  let total = 0;
  for (const msg of history) {
    if (typeof msg.content === "string") {
      const cjkChars = (msg.content.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g) || []).length;
      const otherChars = msg.content.length - cjkChars;
      total += Math.ceil(cjkChars / 1.5) + Math.ceil(otherChars / 4);
    }
    // Add ~4 tokens overhead per message for role/delimiters
    total += 4;
  }
  return total;
}

// ─── Tool-level Timeout ───────────────────────────────────────────────────────

/** Default timeouts per tool (ms). Tools not listed use TOOL_DEFAULT_TIMEOUT. */
export const TOOL_TIMEOUTS: Record<string, number> = {
  bash: 120_000,
  read_file: 15_000,
  edit_file: 30_000,
  write_file: 30_000,
  search_files: 15_000,
  search_content: 20_000,
  search_skill: 15_000,
  install_skill: 30_000,
  create_skill: 10_000,
  get_skill: 5_000,
  memory_search: 10_000,
  memory_add: 5_000,
  memory_replace: 5_000,
  memory_remove: 5_000,
  session_search: 15_000,
  create_backup: 30_000,
  list_backups: 5_000,
  restore_backup: 30_000,
  create_workflow: 10_000,
  update_task: 10_000,
  get_workflow_status: 5_000,
  dispatch_pipeline: 15_000,
  list_agents: 5_000,
  list_groups: 5_000,
  list_group_members: 5_000,
};

/** Fallback timeout for tools without explicit config (60s). */
export const TOOL_DEFAULT_TIMEOUT = 60_000;

/** Get the timeout for a given tool, falling back to default. */
export function getToolTimeout(toolName: string): number {
  return TOOL_TIMEOUTS[toolName] ?? TOOL_DEFAULT_TIMEOUT;
}

/**
 * Race a promise against a timeout. Rejects with a descriptive error on timeout.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Tool "${label}" timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ─── Tool Result Cache ────────────────────────────────────────────────────────

/** Tools whose results are safe to cache (idempotent, read-only). */
export const CACHEABLE_TOOLS = new Set([
  "read_file", "search_files", "search_content", "get_skill",
  "search_skill", "list_agents", "list_groups", "list_group_members",
  "get_workflow_status", "list_backups", "memory_search", "session_search",
]);

interface CacheEntry { result: unknown; ts: number; }

const toolCache = new Map<string, CacheEntry>();
const TOOL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const TOOL_CACHE_MAX = 200;

/** Build a cache key from tool name + arguments. */
export function getToolCacheKey(toolName: string, argsJson: string): string | null {
  if (!CACHEABLE_TOOLS.has(toolName)) return null;
  try {
    const parsed = JSON.parse(argsJson || "{}");
    return `${toolName}::${JSON.stringify(parsed)}`;
  } catch {
    return `${toolName}::${argsJson}`;
  }
}

/** Look up a cached tool result. Returns null on miss or expiry. */
export function lookupToolCache(key: string): unknown | null {
  const entry = toolCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TOOL_CACHE_TTL) {
    toolCache.delete(key);
    return null;
  }
  return entry.result;
}

/** Store a tool result in cache with LRU-half eviction on overflow. */
export function setToolCache(key: string, result: unknown): void {
  toolCache.set(key, { result, ts: Date.now() });
  if (toolCache.size > TOOL_CACHE_MAX) {
    const entries = [...toolCache.entries()];
    entries.sort((a, b) => a[1].ts - b[1].ts);
    const toRemove = entries.slice(0, Math.floor(entries.length / 2));
    for (const [k] of toRemove) toolCache.delete(k);
  }
}

/** Clear all cached tool results (for testing or turn reset). */
export function clearToolCache(): void {
  toolCache.clear();
}

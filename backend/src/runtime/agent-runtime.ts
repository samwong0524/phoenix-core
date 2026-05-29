import { store } from "@/lib/storage";
import { GLMStreamAssembler, parseSSEJsonLines, GLMAssembledState } from "@/lib/glm-stream";
import { OpenAIStreamAssembler, OpenAIAssembledState } from "@/lib/openai-stream";

import { AgentEventBus } from "./event-bus";
import { createDeferred, safeJsonParse } from "./utils";
import { getWorkspaceUIBus } from "./ui-bus";
import { getMcpRegistry } from "./mcp";
import { appendAgentHistorySnapshot, appendAgentLlmRequestRaw, appendAgentStreamEvent } from "./agent-logger";
import { formatSkillPrompt, getSkillLoader, getSkillDirectory, invalidateSkillCache, FRONTMATTER_RE, parseFrontmatter } from "./skill-loader";

type StreamAssembledState = OpenAIAssembledState | GLMAssembledState;

/** Build a Postgres text[] array from a JS string array using parameterized SQL. */
function buildTextArray(arr: string[]): ReturnType<typeof sql> {
  if (arr.length === 0) return sql`ARRAY[]::text[]`;
  // Use sql.join for safe parameterization
  return sql`ARRAY[${sql.join(arr.map((v) => sql`${v}`), sql`, `)}]::text[]`;
}

// Runtime settings — mutable at request time for live model switching without restart.
const runtimeSettings = new Map<string, string>();

const RUNTIME_SETTINGS: Record<string, { validate: (v: string) => boolean }> = {
  freellmapi_model: {
    // Must be a valid model identifier: letters, digits, dots, dashes, underscores, slashes
    // "auto" is the special value for router-selected model
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
import { getDb } from "@/db";
import { sql, inArray } from "drizzle-orm";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

const MAX_LLM_RETRIES = 5;
const LLM_RETRY_BASE_MS = 3000;
const LLM_REQUEST_TIMEOUT_MS = 60000; // 60s max per request
const MAX_CONCURRENT_LLM = 1;
const MIN_LLM_INTERVAL_MS = 1200; // minimum gap between LLM calls (~50 QPM ceiling)

// Nudge Engine: lightweight background analysis that runs periodically during a conversation.
// Every NUDGE_INTERVAL rounds, the agent reviews recent history for patterns
// (tool failures that recovered, repeated commands, successful workflows)
// and auto-creates skills from them. Best-effort, non-blocking.
const NUDGE_INTERVAL = 15; // rounds between nudge analyses
const MAX_AUTO_SKILLS_PER_AGENT_PER_DAY = 3; // shared with autoCreateSkillFromWorkflow

// Context compression configuration (design doc §6.3)
const COMPRESS_PROTECT_FIRST = 2; // protect first N system messages
const COMPRESS_PROTECT_LAST = 6;  // keep last N messages intact
const COMPRESS_TRIGGER = 8;       // trigger compression when history > N
const COMPRESS_MAX_CONTENT = 2000; // max chars per individual message before truncation

// Key Pool: per-provider API key rotation with 429 cooldown

// Skill lifecycle constants (design doc §11.4)
const SKILL_STALE_DAYS = 30;       // days without use → stale warning
const SKILL_ARCHIVE_DAYS = 90;     // days without use → archive
const SKILL_MERGE_SIMILARITY = 0.7; // description overlap threshold for dedup
// Keys are parsed from *_API_KEYS env var (comma-separated)
// Falls back to single *_API_KEY if *_API_KEYS is not set

interface KeyEntry {
  key: string;
  cooldownUntil: number; // timestamp (ms) when this key becomes available again
}

class KeyPool {
  private entries: KeyEntry[] = [];
  private index = 0;

  constructor(keys: string[]) {
    this.entries = keys.filter(k => k.length > 0).map(k => ({ key: k, cooldownUntil: 0 }));
  }

  hasKeys(): boolean {
    return this.entries.length > 0;
  }

  hasAvailable(): boolean {
    return this.entries.some(e => e.cooldownUntil < Date.now());
  }

  /** Get next available key (round-robin with cooldown skip). Returns null if all keys are in cooldown. */
  getNext(): string | null {
    const now = Date.now();
    if (this.entries.length === 0) return null;
    if (this.entries.length === 1) {
      const e = this.entries[0];
      if (e.cooldownUntil > now) return null;
      return e.key;
    }
    // Try to find an available key starting from current index (round-robin)
    for (let i = 0; i < this.entries.length; i++) {
      const idx = (this.index + i) % this.entries.length;
      const entry = this.entries[idx];
      if (entry.cooldownUntil <= now) {
        this.index = (idx + 1) % this.entries.length;
        return entry.key;
      }
    }
    return null; // all keys in cooldown
  }

  /** Mark a key as rate-limited. It will be skipped for cooldownMs. */
  mark429(key: string, cooldownMs: number): void {
    const entry = this.entries.find(e => e.key === key);
    if (entry) {
      entry.cooldownUntil = Date.now() + cooldownMs;
      console.warn(`[KeyPool] key ${key.slice(0, 8)}... in cooldown for ${cooldownMs}ms`);
    }
  }

  size(): number {
    return this.entries.length;
  }
}

// Per-provider key pools (lazily initialized)
let _glmKeyPool: KeyPool | null = null;
let _openrouterKeyPool: KeyPool | null = null;
let _anthropicKeyPool: KeyPool | null = null;
let _freellmapiKeyPool: KeyPool | null = null;

function parseKeyPool(envKey: string, fallbackKey: string): KeyPool {
  const keys = process.env[envKey]
    ? process.env[envKey].split(",").map(k => k.trim()).filter(k => k.length > 0)
    : fallbackKey ? [fallbackKey] : [];
  return new KeyPool(keys);
}

function getGlmKeyPool(): KeyPool {
  if (_glmKeyPool) return _glmKeyPool;
  _glmKeyPool = parseKeyPool("GLM_API_KEYS", process.env.GLM_API_KEY ?? process.env.ZHIPUAI_API_KEY ?? "");
  return _glmKeyPool;
}

function getOpenrouterKeyPool(): KeyPool {
  if (_openrouterKeyPool) return _openrouterKeyPool;
  _openrouterKeyPool = parseKeyPool("OPENROUTER_API_KEYS", process.env.OPENROUTER_API_KEY ?? "");
  return _openrouterKeyPool;
}

function getAnthropicKeyPool(): KeyPool {
  if (_anthropicKeyPool) return _anthropicKeyPool;
  _anthropicKeyPool = parseKeyPool("ANTHROPIC_API_KEYS", process.env.ANTHROPIC_API_KEY ?? "");
  return _anthropicKeyPool;
}

function getFreellmapiKeyPool(): KeyPool {
  if (_freellmapiKeyPool) return _freellmapiKeyPool;
  _freellmapiKeyPool = parseKeyPool("FREELLMAPI_API_KEYS", process.env.FREELLMAPI_API_KEY ?? "");
  return _freellmapiKeyPool;
}

// Invalidate all key pools (e.g., after .env change)
export function invalidateKeyPools(): void {
  _glmKeyPool = null;
  _openrouterKeyPool = null;
  _anthropicKeyPool = null;
  _freellmapiKeyPool = null;
}

/**
 * Global LLM request scheduler.
 * Ensures at most 1 concurrent LLM request with a minimum gap between calls,
 * forming a natural rate limiter (~50 requests/minute ceiling).
 * All agents share this single queue — when one agent's LLM call is retrying
 * on 429, others wait their turn instead of compounding the rate-limit.
 */
const llmScheduler = {
  active: 0,
  queue: [] as Array<() => void>,
  lastCallTime: 0,

  async acquire(): Promise<void> {
    // Wait for the concurrency slot (FIFO queue)
    if (this.active >= MAX_CONCURRENT_LLM || this.queue.length > 0) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }
    this.active++;

    // Enforce minimum inter-request delay
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    if (elapsed < MIN_LLM_INTERVAL_MS) {
      const wait = MIN_LLM_INTERVAL_MS - elapsed;
      await new Promise((r) => setTimeout(r, wait));
    }
    this.lastCallTime = Date.now();
  },

  release(): void {
    this.active--;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      // Small delay before waking the next waiter to avoid back-to-back releases
      setImmediate(next);
    }
  },
};

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  label: string = "LLM",
  options?: { backupModel?: string; modelSwapFn?: (body: string, model: string) => string; keyPool?: KeyPool }
): Promise<Response> {
  let lastResponse: Response | null = null;
  let switchedModel = false;

  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    // On 429 retry (not first attempt), try next available key before waiting
    if (attempt > 0 && options?.keyPool) {
      const nextKey = options.keyPool.getNext();
      if (nextKey) {
        // Replace API key in request headers
        if (init.headers && typeof init.headers === "object") {
          const headers = init.headers as Record<string, string>;
          if (headers["Authorization"]) {
            headers["Authorization"] = `Bearer ${nextKey}`;
          }
          if (headers["x-api-key"]) {
            headers["x-api-key"] = nextKey;
          }
        }
        console.warn(`[fetchWithRetry] ${label} rotating to next key in pool (${options.keyPool.size()} keys)`);
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LLM_REQUEST_TIMEOUT_MS);
    const resp = await fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
    if (resp.status !== 429) return resp;

    lastResponse = resp;
    const retryAfter = resp.headers.get("retry-after");
    const baseDelay = retryAfter
      ? parseInt(retryAfter, 10) * 1000
      : LLM_RETRY_BASE_MS * Math.pow(2, attempt);
    // Add 0-1500ms random jitter to avoid all agents retrying simultaneously
    const jitter = Math.floor(Math.random() * 1500);
    const delayMs = baseDelay + jitter;

    // On first 429, switch to backup model if available
    if (!switchedModel && options?.backupModel && options?.modelSwapFn && init.body && typeof init.body === "string") {
      try {
        const body = JSON.parse(init.body);
        if (body.model && body.model !== options.backupModel) {
          const oldModel = body.model;
          body.model = options.backupModel;
          init.body = JSON.stringify(body);
          switchedModel = true;
          console.warn(`[fetchWithRetry] ${label} got 429, switching from ${oldModel} to ${options.backupModel}`);
        }
      } catch {
        // body parse failed, continue with original retry logic
      }
    }

    // Mark current key as rate-limited if we have a key pool
    if (options?.keyPool && init.headers && typeof init.headers === "object") {
      const headers = init.headers as Record<string, string>;
      const currentKey = headers["x-api-key"] ?? headers["Authorization"]?.replace("Bearer ", "") ?? "";
      if (currentKey) {
        options.keyPool.mark429(currentKey, delayMs);
      }
    }

    console.warn(`[fetchWithRetry] ${label} got 429, attempt ${attempt + 1}/${MAX_LLM_RETRIES}, retrying in ${delayMs}ms`);
    await new Promise(r => setTimeout(r, delayMs));
  }

  console.error(`[fetchWithRetry] ${label} exhausted ${MAX_LLM_RETRIES + 1} attempts, all 429`);
  // Return the last 429 response to let the caller handle the error
  return lastResponse!;
}

/** Wrapper: acquires the global rate-limited scheduler slot before calling fetchWithRetry,
 *  then releases. Ensures LLM calls are paced (~50 QPM max) to avoid 429 throttling. */
async function llmFetch(
  url: string,
  init: RequestInit,
  label: string = "LLM",
  options?: { backupModel?: string; modelSwapFn?: (body: string, model: string) => string; keyPool?: KeyPool }
): Promise<Response> {
  await llmScheduler.acquire();
  try {
    return await fetchWithRetry(url, init, label, options);
  } finally {
    llmScheduler.release();
  }
}

type UUID = string;

function uuid(): UUID {
  return crypto.randomUUID();
}

type MultimodalContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

const EXT_TO_MEDIA: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
};

type HistoryMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string | MultimodalContentPart[];
      tool_calls?: unknown;
      reasoning_content?: string;
    }
  | { role: "tool"; content: string | MultimodalContentPart[]; tool_call_id?: string; name?: string };

type ToolCall = {
  index: number;
  id?: string;
  name?: string;
  argumentsText: string;
};

const SKILLS_MARKER = "[skills:loaded]";
const SOUL_MARKER = "[soul:loaded]";
const MAX_TOOL_RESULT_CHARS = 200_000; // guardrail: support large results (screenshot paths + metadata, vision content)
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
    // Design doc §11.5: only inject name+description (~200 chars), not full skill content
    const skillsParts = [skillsMeta].filter((part) => part && part.trim());
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

function shortId(id: unknown): string {
  const s = String(id ?? "");
  return s.length > 8 ? s.slice(0, 8) + "..." : s;
}

function extractToolFact(msg: Extract<HistoryMessage, { role: "tool" }>): string | null {
  const contentStr = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
  const result = safeJsonParse<Record<string, unknown>>(contentStr, {});
  const ok = result?.ok !== false;
  const name = msg.name ?? "unknown";

  // Trivial tools -- skip
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

function summarizeUserMessage(content: string): string {
  const MAX = 120;
  if (content.length <= MAX) return content;
  const dot = content.indexOf(".");
  if (dot > 0 && dot < MAX) return content.slice(0, dot + 1);
  return content.slice(0, MAX) + "...";
}

/**
 * Compress old tool-call exchanges when history grows too large.
 * Trigger at COMPRESS_TRIGGER messages. Configurable via COMPRESS_PROTECT_FIRST/LAST constants.
 * Keep: first N system messages, last M messages, and the first user message.
 * Replace middle tool/user/assistant blocks with a compact structured summary.
 */
function compressHistory(history: HistoryMessage[]) {
  if (history.length <= COMPRESS_TRIGGER) return;

  // Protect the first N system messages (soul constitution, skills block)
  const systemMsgs = history.filter((m) => m.role === "system");
  const protectedSystems = systemMsgs.slice(0, COMPRESS_PROTECT_FIRST);

  // Build non-system view
  const nonSystem = history.filter((m) => m.role !== "system");
  if (nonSystem.length <= COMPRESS_PROTECT_LAST) return;

  const keepStart = nonSystem.slice(0, 1);
  const keepEnd = nonSystem.slice(-COMPRESS_PROTECT_LAST);
  const compressed = nonSystem.slice(1, nonSystem.length - COMPRESS_PROTECT_LAST);

  // Truncate long content from kept messages to prevent bloat
  const trimmed = [...keepStart, ...keepEnd].map((m) => {
    if (typeof m.content === "string" && m.content.length > COMPRESS_MAX_CONTENT) {
      return { ...m, content: m.content.slice(0, COMPRESS_MAX_CONTENT) + "\n...[truncated]" };
    }
    return m;
  });
  const trimmedStart = trimmed.slice(0, keepStart.length);
  const trimmedEnd = trimmed.slice(keepStart.length);

  // Build structured summary with extracted facts
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

// ---------------------------------------------------------------------------
// Tool group categories — ordered by typical usage frequency.
// Each group is a comment marker only; the flat array is what the LLM sees.
// ---------------------------------------------------------------------------
type ToolGroup =
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
const AGENT_TOOLS_AGENT = [
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
const AGENT_TOOLS_SKILL = [
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
const AGENT_TOOLS_MESSAGE = [
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
const AGENT_TOOLS_GROUP = [
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
const AGENT_TOOLS_EXECUTION = [
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
const AGENT_TOOLS_WORKFLOW = [
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
] as const;

// ---------------------------------------------------------------------------
// Memory (Long-term)
// ---------------------------------------------------------------------------
const AGENT_TOOLS_MEMORY = [
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
const AGENT_TOOLS_BACKUP = [
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
const AGENT_TOOLS: readonly { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }[] = [
  ...AGENT_TOOLS_AGENT,
  ...AGENT_TOOLS_SKILL,
  ...AGENT_TOOLS_MESSAGE,
  ...AGENT_TOOLS_GROUP,
  ...AGENT_TOOLS_EXECUTION,
  ...AGENT_TOOLS_WORKFLOW,
  ...AGENT_TOOLS_MEMORY,
  ...AGENT_TOOLS_BACKUP,
];

const BUILTIN_TOOL_NAMES = new Set(AGENT_TOOLS.map((tool) => tool.function.name));

// ---------------------------------------------------------------------------
// check_fn — tool availability filtering (Sprint 2 — check_fn).
// Each predicate receives runtime context and returns true if the tool
// should be visible to the LLM in the current state.
// ---------------------------------------------------------------------------
interface ToolContext {
  agentId: string;
  isCoordinator: boolean;
  hasActiveWorkflow: boolean;
  shellEnabled: boolean;
  hasHumanSender?: boolean;
}

type ToolCheck = (ctx: ToolContext) => boolean;

const TOOL_AVAILABILITY: Record<string, ToolCheck> = {
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

async function getAgentTools(context?: ToolContext) {
  const loadTimeoutMs =
    Number(process.env.MCP_LOAD_TIMEOUT_MS) > 0 ? Number(process.env.MCP_LOAD_TIMEOUT_MS) : 2000;
  const mcp = await getMcpRegistry(BUILTIN_TOOL_NAMES, { loadTimeoutMs });
  const mcpTools = mcp.getToolDefinitions();

  if (!context) return [...AGENT_TOOLS, ...mcpTools];

  const filtered = AGENT_TOOLS.filter((tool) => {
    const check = TOOL_AVAILABILITY[tool.function.name];
    return !check || check(context);
  });
  return [...filtered, ...mcpTools];
}

function getGlmConfig() {
  const pool = getGlmKeyPool();
  const apiKey = pool.getNext() ?? "";
  const baseUrl =
    process.env.GLM_BASE_URL ??
    "https://open.bigmodel.cn/api/paas/v4/chat/completions";
  const model = process.env.GLM_MODEL ?? "glm-4.7";
  const backupModel = process.env.GLM_BACKUP_MODEL ?? "";

  if (!apiKey) {
    throw new Error("Missing GLM API key (set GLM_API_KEY or GLM_API_KEYS)");
  }

  return { apiKey, baseUrl, model, backupModel, keyPool: pool };
}

function getFreellmapiConfig() {
  const pool = getFreellmapiKeyPool();
  const apiKey = pool.getNext() ?? "";
  const baseUrl = (process.env.FREELLMAPI_URL ?? "http://127.0.0.1:3001/v1").replace(/\/+$/, "");
  // Runtime model switching: check runtime setting first, then env var, then "auto".
  const model = getRuntimeSetting("freellmapi_model") ?? process.env.FREELLMAPI_MODEL ?? "auto";

  if (!apiKey) {
    throw new Error("Missing FreeLLMAPI API key (set FREELLMAPI_API_KEY or FREELLMAPI_API_KEYS)");
  }

  return { baseUrl, apiKey, model, keyPool: pool };
}

type LlmProvider = "glm" | "openrouter" | "ollama" | "anthropic" | "freellmapi";

function getLlmProvider(): LlmProvider {
  const raw = (process.env.LLM_PROVIDER ?? "glm").toLowerCase();
  if (raw === "openrouter" || raw === "open-router" || raw === "or") return "openrouter";
  if (raw === "anthropic" || raw === "anthropic-compatible") return "anthropic";
  if (raw === "ollama" || raw === "o" || raw === "local") return "ollama";
  if (raw === "freellmapi" || raw === "free" || raw === "freellm") return "freellmapi";
  return "glm";
}

/** Returns whether each LLM provider has the required env vars configured. */
function isProviderConfigured(provider: LlmProvider): boolean {
  switch (provider) {
    case "openrouter": return !!(process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEYS);
    case "anthropic": return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEYS);
    case "glm": return !!(process.env.GLM_API_KEY || process.env.ZHIPUAI_API_KEY || process.env.GLM_API_KEYS);
    case "ollama": return true; // local, always available
    case "freellmapi": return !!(process.env.FREELLMAPI_API_KEY || process.env.FREELLMAPI_API_KEYS);
  }
}

/**
 * Returns the ordered provider chain for LLM calls.
 * Primary = LLM_PROVIDER env var (or "glm" default).
 * Fallbacks = other providers with configured API keys, tried in order after the primary fails with 429.
 * LLM_FALLBACK_PROVIDERS env var can override the fallback order (comma-separated).
 */
function getProviderChain(): LlmProvider[] {
  const primary = getLlmProvider();
  const chain: LlmProvider[] = [primary];
  const all: LlmProvider[] = ["freellmapi", "openrouter", "glm", "anthropic", "ollama"];

  const overrideRaw = process.env.LLM_FALLBACK_PROVIDERS ?? "";
  if (overrideRaw) {
    // User-specified fallback order
    for (const name of overrideRaw.split(",").map((s) => s.trim().toLowerCase())) {
      if (name === "freellmapi" || name === "free" || name === "freellm") { if (name !== primary && isProviderConfigured("freellmapi")) chain.push("freellmapi"); }
      else if (name === "openrouter" || name === "or") { if (name !== primary && isProviderConfigured("openrouter")) chain.push("openrouter"); }
      else if (name === "glm") { if (name !== primary && isProviderConfigured("glm")) chain.push("glm"); }
      else if (name === "anthropic") { if (name !== primary && isProviderConfigured("anthropic")) chain.push("anthropic"); }
      else if (name === "ollama" || name === "o" || name === "local") { if (name !== primary && isProviderConfigured("ollama")) chain.push("ollama"); }
    }
  } else {
    // Auto-discover fallbacks: try other configured providers in a sensible default order
    const defaults: LlmProvider[] = ["freellmapi", "openrouter", "glm", "anthropic", "ollama"];
    for (const p of defaults) {
      if (p !== primary && isProviderConfigured(p)) {
        chain.push(p);
      }
    }
  }

  return chain;
}

// ---------------------------------------------------------------------------
// RuntimeProvider abstraction — replace switch with registry (Sprint 2).
// Adding a new provider: add config function + method + registry entry.
// ---------------------------------------------------------------------------
type StreamContext = { workspaceId: UUID; groupId: UUID; round: number };

interface LlmStreamResult {
  assistantText: string;
  assistantThinking: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
}

// Keyed by LlmProvider (string) for extensibility — no switch needed.
const PROVIDER_REGISTRY: Record<string, (self: AgentRunner, history: HistoryMessage[], ctx: StreamContext) => Promise<LlmStreamResult>> = {
  openrouter: (self, h, ctx) => self.callOpenRouterStreaming(h, ctx),
  anthropic: (self, h, ctx) => self.callAnthropicStreaming(h, ctx),
  glm: (self, h, ctx) => self.callGlmStreaming(h, ctx),
  ollama: (self, h, ctx) => self.callOllamaStreaming(h, ctx),
  freellmapi: (self, h, ctx) => self.callFreellmapiStreaming(h, ctx),
};

function getProviderHandler(provider: string) {
  return PROVIDER_REGISTRY[provider] ?? null;
}

function normalizeOpenRouterUrl(value: string) {
  if (!value) return "https://openrouter.ai/api/v1/chat/completions";
  if (value.endsWith("/chat/completions")) return value;
  if (value.endsWith("/api/v1")) return `${value}/chat/completions`;
  if (value.endsWith("/v1")) return `${value}/chat/completions`;
  return value;
}

function getOpenRouterConfig() {
  const pool = getOpenrouterKeyPool();
  const apiKey = pool.getNext() ?? "";
  const baseUrl = normalizeOpenRouterUrl(
    process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1/chat/completions"
  );
  const model = process.env.OPENROUTER_MODEL ?? "";
  const backupModel = process.env.OPENROUTER_BACKUP_MODEL ?? "";
  const httpReferer = process.env.OPENROUTER_HTTP_REFERER ?? "";
  const appTitle = process.env.OPENROUTER_APP_TITLE ?? "";

  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY (set OPENROUTER_API_KEY or OPENROUTER_API_KEYS)");
  }

  return { apiKey, baseUrl, model, backupModel, httpReferer, appTitle, keyPool: pool };
}

function getAnthropicConfig() {
  const pool = getAnthropicKeyPool();
  const apiKey = pool.getNext() ?? "";
  const baseUrl = process.env.ANTHROPIC_BASE_URL ?? "";
  const model = process.env.ANTHROPIC_MODEL ?? "qwen3.6-plus";
  const backupModel = process.env.ANTHROPIC_BACKUP_MODEL ?? "";

  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY (set ANTHROPIC_API_KEY or ANTHROPIC_API_KEYS)");
  }

  return { apiKey, baseUrl, model, backupModel, keyPool: pool };
}

function getOllamaConfig() {
  const baseUrl = normalizeOpenRouterUrl(
    process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1/chat/completions"
  );
  const model = process.env.OLLAMA_MODEL ?? "qwen3:8b";
  const backupModel = process.env.OLLAMA_BACKUP_MODEL ?? "";
  return { baseUrl, model, backupModel };
}

// ---------------------------------------------------------------------------
// Skill search & install helpers
// ---------------------------------------------------------------------------

/** Trusted repos to prioritize in GitHub search */
const TRUSTED_SKILL_REPOS = [
  "openai/skills",
  "anthropics/skills",
  "massive/MassiveToolSkills",
];

/** Search GitHub code for SKILL.md files matching the query */
async function searchGitHubSkills(query: string, maxResults: number): Promise<Array<{
  name: string;
  description: string;
  source_url: string;
  trust_level: string;
  repo: string;
}>> {
  const allResults: Array<{ name: string; description: string; source_url: string; trust_level: string; repo: string }> = [];

  // First, search trusted repos
  for (const repo of TRUSTED_SKILL_REPOS) {
    try {
      const url = `https://api.github.com/search/code?q=SKILL.md+${encodeURIComponent(query)}+repo:${repo}&per_page=${maxResults}`;
      const res = await fetch(url, {
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "SWARM-IDE/1.0",
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue; // skip repo if not accessible
      const data = await res.json();
      for (const item of (data.items ?? [])) {
        allResults.push({
          name: item.name || item.path?.split("/").pop() || "unknown",
          description: `Skill from trusted repo ${item.repository?.full_name}`,
          source_url: item.html_url || item.git_url || "",
          trust_level: "trusted",
          repo: item.repository?.full_name || repo,
        });
      }
      if (allResults.length >= maxResults) break;
    } catch {
      // skip unavailable repos
    }
  }

  // Then, search GitHub globally
  if (allResults.length < maxResults) {
    const remaining = maxResults - allResults.length;
    try {
      const url = `https://api.github.com/search/code?q=SKILL.md+${encodeURIComponent(query)}&per_page=${remaining}`;
      const res = await fetch(url, {
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "SWARM-IDE/1.0",
        },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        for (const item of (data.items ?? [])) {
          // Skip already-added from trusted repos
          if (allResults.some(r => r.source_url === item.html_url)) continue;
          allResults.push({
            name: item.name || item.path?.split("/").pop() || "unknown",
            description: `Skill from ${item.repository?.full_name}`,
            source_url: item.html_url || item.git_url || "",
            trust_level: "community",
            repo: item.repository?.full_name || "unknown",
          });
        }
      }
    } catch {
      // GitHub search unavailable
    }
  }

  if (allResults.length === 0) {
    // Fallback: search local skills
    return searchLocalSkills(query);
  }

  return allResults.slice(0, maxResults);
}

/** Search local skills directory */
async function searchLocalSkills(query: string): Promise<Array<{
  name: string;
  description: string;
  source_url: string;
  trust_level: string;
  repo: string;
}>> {
  const loader = await getSkillLoader();
  const allSkills = await loader.listSkills();
  const skillsMeta = await loader.listAutoLoadSkills();
  const queryLower = query.toLowerCase();

  const results: Array<{ name: string; description: string; source_url: string; trust_level: string; repo: string }> = [];
  for (const skill of skillsMeta) {
    if (skill.name.toLowerCase().includes(queryLower) ||
        skill.description.toLowerCase().includes(queryLower)) {
      results.push({
        name: skill.name,
        description: skill.description,
        source_url: `local://${skill.skillDir}`,
        trust_level: "local",
        repo: "local",
      });
    }
  }
  return results;
}

/** Convert a GitHub URL to a raw content URL */
function toRawGitHubUrl(url: string): string {
  // Already a raw URL
  if (url.startsWith("https://raw.githubusercontent.com")) return url;

  // github.com/blob/... → raw.githubusercontent.com
  const blobMatch = url.match(/https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)/);
  if (blobMatch) {
    return `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}`;
  }

  // github.com/.../tree/... → not a file URL, try to append SKILL.md
  const treeMatch = url.match(/https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)(.*)/);
  if (treeMatch) {
    return `https://raw.githubusercontent.com/${treeMatch[1]}/${treeMatch[2]}/${treeMatch[3]}${treeMatch[4]}/SKILL.md`;
  }

  return url;
}

/** Fetch SKILL.md content from a URL */
async function fetchSkillContent(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "Accept": "text/plain",
      "User-Agent": "SWARM-IDE/1.0",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch skill from ${url}: HTTP ${res.status}`);
  }
  return res.text();
}

/** Security scan: reject skill content with dangerous patterns */
function scanSkillContent(content: string): { ok: true } | { ok: false; reason: string } {
  const dangerousPatterns: Array<{ re: RegExp; reason: string }> = [
    { re: /\bexec\s*\(/i, reason: "contains exec() call" },
    { re: /\beval\s*\(/i, reason: "contains eval() call" },
    { re: /\bbash\b.*\|.*\bnode\b/i, reason: "contains bash piping to node" },
    { re: /fetch\s*\(\s*["']https?:\/\/(127\.|localhost|0\.0\.0\.0)/i, reason: "contains fetch to internal IP" },
    { re: /http:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|10\.|192\.168\.)/i, reason: "contains internal network URL" },
    { re: /```bash\n.*?(exec|eval|curl.*\|.*sh)/is, reason: "contains dangerous bash code block" },
    { re: /```python\n.*?(exec|eval|__import__|subprocess)/is, reason: "contains dangerous python code block" },
  ];

  for (const { re, reason } of dangerousPatterns) {
    if (re.test(content)) {
      return { ok: false, reason };
    }
  }
  return { ok: true };
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
  // Track last activity time for cleanup
  private lastActiveTime = Date.now();
  // Memory snapshot flag — injected once per fresh session to stabilize prompt caching
  private memorySnapshotAdded = false;
  // Tool context for check_fn availability filtering (updated each turn)
  private toolContext: ToolContext | null = null;
  // Nudge Engine: round counter for periodic background analysis
  private nudgeCounter = 0;
  // Auto-skill trigger: count of meaningful actions since last skill nudge
  private meaningfulActions = 0;
  private static readonly SKILL_AUTO_TRIGGER_AFTER = 3;
  // search_skill per-turn call counter (reset in resetForTurn)
  private _searchCountThisTurn = 0;
  // search_skill query cache: query -> { results, timestamp }
  private static _searchCache = new Map<string, { results: unknown[]; ts: number }>();

  /**
   * Record a structured decision event for self-learning.
   * Design: extract structured events at decision points, not from raw history.
   * Inspired by human memory: encode at the moment of decision, not replay later.
   */
  async recordDecision(input: {
    groupId?: string;
    decisionType: string;
    targetType?: string;
    targetId?: string;
    inputSummary?: string;
    outputSummary?: string;
    success?: boolean;
  }) {
    try {
      const { v4: uuid } = await import("uuid");
      const db = getDb();
      // Get workspace_id
      const wsRows = await db.execute(
        sql`SELECT workspace_id FROM agents WHERE id = ${this.agentId} LIMIT 1`
      );
      const ws = (wsRows as unknown as Array<{ workspace_id: string }>)[0];
      if (!ws) return;

      const MAX_SUMMARY = 200;
      await db.execute(
        sql`INSERT INTO agent_decisions (id, agent_id, group_id, workspace_id, decision_type, target_type, target_id, input_summary, output_summary, success, created_at)
            VALUES (${uuid()}, ${this.agentId}, ${input.groupId ?? null}, ${ws.workspace_id}, ${input.decisionType}, ${input.targetType ?? null}, ${input.targetId ?? null}, ${(input.inputSummary ?? "").slice(0, MAX_SUMMARY)}, ${(input.outputSummary ?? "").slice(0, MAX_SUMMARY)}, ${input.success ?? null}, ${new Date()})`
      );
    } catch {
      // best-effort — table may not exist or decision extraction is non-critical
    }
  }

  /**
   * Archive a completed session — generate summary and clear llm_history.
   * Inspired by human episodic memory: distill events into a structured summary,
   * don't keep the raw conversation forever.
   */
  async archiveSession(input: {
    groupId: string;
    sessionType: string;
    title: string;
    summary: string;
    keyDecisions?: Record<string, unknown>[];
  }) {
    try {
      const { v4: uuid } = await import("uuid");
      const db = getDb();
      const wsRows = await db.execute(
        sql`SELECT workspace_id FROM agents WHERE id = ${this.agentId} LIMIT 1`
      );
      const ws = (wsRows as unknown as Array<{ workspace_id: string }>)[0];
      if (!ws) return;

      await db.execute(
        sql`INSERT INTO session_archives (id, group_id, workspace_id, session_type, title, summary, key_decisions, archived_at)
            VALUES (${uuid()}, ${input.groupId}, ${ws.workspace_id}, ${input.sessionType}, ${input.title.slice(0,100)}, ${input.summary.slice(0,2000)}, ${JSON.stringify(input.keyDecisions ?? [])}, ${new Date()})`
      );

      // Clear llm_history but keep system messages (soul, skills, rules)
      const agent = await store.getAgent({ agentId: this.agentId });
      const parsed = safeJsonParse<unknown>(agent.llmHistory, {});
      const history = Array.isArray(parsed) ? (parsed as HistoryMessage[]) : [];
      const systemMsgs = history.filter((m) => m.role === "system").slice(-3);
      await store.setAgentHistory({
        agentId: this.agentId,
        llmHistory: JSON.stringify(systemMsgs),
      });
      console.info(`[archiveSession] archived "${input.title}" for group ${input.groupId.slice(0,8)}`);
    } catch (err) {
      console.warn(`[archiveSession] failed: ${err instanceof Error ? err.message : err}`);
    }
  }

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

  /**
   * Check if runner has been idle for longer than timeoutMs
   */
  isIdleTooLong(timeoutMs: number): boolean {
    if (this.running) return false; // Currently processing, not idle
    return Date.now() - this.lastActiveTime > timeoutMs;
  }

  private touchActive() {
    this.lastActiveTime = Date.now();
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
      // Safety timeout: if no wakeup within 600s, agent is orphaned — stop
      const timeoutMs = 600_000;
      let woke = false;
      await Promise.race([
        this.wake.promise.then(() => { woke = true; }),
        new Promise<void>((r) => setTimeout(r, timeoutMs)),
      ]);
      if (!woke) {
        console.info(`[AgentRunner:loop] wakeup timeout ${timeoutMs}ms, stopping runner`);
        this.stopRunner(this.agentId);
      }
      if (!this.started) continue; // stopRunner set started=false
      if (this.running) continue;
      this.running = true;
      this.touchActive();
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

    // Resolve sender roles once (deduplicated), reused for hasHumanSender + coordinator check + user content
    const uniqueSenderIds = [...new Set(unreadMessages.map((m) => m.senderId))];
    const senderRoleCache = new Map<string, string | null>();
    await Promise.all(
      uniqueSenderIds.map(async (sid) => {
        const role = await store.getAgentRole({ agentId: sid }).catch(() => null);
        senderRoleCache.set(sid, role);
      })
    );
    const hasHumanSender = [...senderRoleCache.values()].some((r) => r === "human");

    // Update tool context for check_fn filtering
    this.toolContext = {
      agentId: this.agentId,
      isCoordinator,
      hasActiveWorkflow: activeWf !== null,
      shellEnabled: process.env.DISABLE_SHELL !== "true",
      hasHumanSender,
    };

    // If workflow is paused and this agent is not coordinator, skip
    if (activeWf && activeWf.status === "paused" && !isCoordinator) { console.info('[processGroupUnread] SKIP: workflow paused, not coordinator'); return; }

    // If workflow active and this is the coordinator: check if human just spoke → auto-pause
    if (activeWf && activeWf.status === "active" && isCoordinator) {
      if (hasHumanSender) {
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
    if (history.length > COMPRESS_TRIGGER) {
      try {
        compressHistory(history);
        console.info(`[processGroupUnread] compressed history: ${history.length} messages`);
      } catch (err) {
        console.warn(`[processGroupUnread] compression failed: ${err instanceof Error ? err.message : err}`);
      }
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

      // Load role template from disk (design doc §11.1 D20)
      const roleTemplatePath = path.join(__dirname, "..", "prompts", "roles", `${role}.md`);
      let roleContent = "";
      try {
        roleContent = await fs.readFile(roleTemplatePath, "utf-8");
      } catch {
        // No template for this role — continue with default prompt
      }

      const workflowContext = activeWf
        ? `\n\nThere is an active workflow: "${activeWf.name}" (status: ${activeWf.status}). ` +
          (isCoordinator
            ? "You are the coordinator. Monitor workflow progress, review task results, and assign next tasks."
            : "You are a worker. Only execute when assigned a task by the coordinator. Check get_workflow_status before acting.")
        : "";

      const systemContent =
        `You are an agent in an IM system. Agent ID: ${this.agentId}, workspace: ${workspaceId}, role: ${role}.\n` +
        `Group members: [${membersList}]. Reference agents by role only.\n` +
        `Act as your role. Replies are NOT auto-delivered — use send_group_message or send_direct_message.\n` +
        `When creating groups, always include 'human' in memberIds.\n` +
        `Use bash for shell commands. Save solved patterns as skills with create_skill.` +
        workflowContext +
        (skillsBlock ? `\n\n${skillsBlock}` : "");

      // Inject role template before the system prompt if available
      const finalSystemContent = roleContent
        ? `${roleContent}\n\n---\n\n${systemContent}`
        : systemContent;

      history.push({
        role: "system",
        content: finalSystemContent,
      });

      // Inject memory snapshot for prompt stability (once per fresh session)
      if (!this.memorySnapshotAdded) {
        const memSnapshot = await this.buildMemorySnapshot();
        if (memSnapshot) {
          history.push({ role: "system", content: memSnapshot });
          this.memorySnapshotAdded = true;
        }
      }
    } else {
      if (soulBlock && !hasSoul) {
        history.push({ role: "system", content: soulBlock });
      }
      if (skillsBlock && !hasSkills) {
        history.push({ role: "system", content: skillsBlock });
      }
    }

    // Build user content with sender roles so agents know who's speaking
    // For image messages, use multimodal content so the LLM can see them
    const hasImages = unreadMessages.some((m) => m.contentType === "image");

    if (hasImages) {
      const parts: MultimodalContentPart[] = [];
      for (const m of unreadMessages) {
        const senderLabel = senderRoleCache.get(m.senderId) ?? m.senderId.substring(0, 8);

        if (m.contentType === "image") {
          let parsed: { url?: string } | null = null;
          try { parsed = JSON.parse(m.content); } catch {}

          if (parsed?.url) {
            try {
              const imgData = await this.fetchImageAsBase64(parsed.url);
              parts.push({
                type: "text",
                text: `[group:${groupId}] ${senderLabel} (发送了一张图片):`,
              });
              parts.push({
                type: "image_url",
                image_url: { url: `data:${imgData.mediaType};base64,${imgData.data}` },
              });
              continue;
            } catch (err) {
              console.warn(`[processGroupUnread] image fetch failed: ${parsed.url}`);
            }
          }
          parts.push({ type: "text", text: `[group:${groupId}] ${senderLabel}: [图片] ${m.content}` });
        } else {
          parts.push({ type: "text", text: `[group:${groupId}] ${senderLabel}: ${m.content}` });
        }
      }
      history.push({ role: "user", content: parts });
    } else {
      const userContent = unreadMessages
        .map((m) => `[group:${groupId}] ${senderRoleCache.get(m.senderId) ?? m.senderId.substring(0, 8)}: ${m.content}`)
        .join("\n");
      history.push({ role: "user", content: userContent });
    }

    const lastId = unreadMessages[unreadMessages.length - 1]?.id;

    // === Cascade prevention: per-group agent turn counter ===
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

    let assistantText = "";
    let assistantThinking = "";
    let didSend = false;

    try {
      const result = await this.runWithTools({
        groupId,
        workspaceId,
        history,
        hasHumanSender,
      });
      assistantText = result.assistantText;
      assistantThinking = result.assistantThinking;
      didSend = result.didSend;
    } catch (llmErr) {
      const errMsg = llmErr instanceof Error ? llmErr.message : String(llmErr);
      console.error(`[processGroupUnread] LLM call failed for agent ${this.agentId}: ${errMsg}`);
      // When LLM is unavailable (429 quota, etc.), send a short notice to human so they
      // aren't left wondering why the agent is silently BUSY.
      if (hasHumanSender && !this.interruptRequested) {
        assistantText = `[系统: LLM 服务暂不可用 (${errMsg.slice(0, 80)}), 请稍后再试]`;
        await store.sendMessage({
          groupId,
          senderId: this.agentId,
          content: assistantText,
          contentType: "text",
        });
      }
      // Still save what we have so the agent can retry on next wake
      history.push({
        role: "assistant",
        content: assistantText || "[LLM call failed]",
      });
      await store.setAgentHistory({
        agentId: this.agentId,
        llmHistory: JSON.stringify(history),
        workspaceId,
      });
      return;
    }

    if (didSend) {
      const currentTurns = groupAgentTurnCount.get(groupId) ?? 0;
      groupAgentTurnCount.set(groupId, currentTurns + 1);
    }

    history.push({
      role: "assistant",
      content: assistantText,
      reasoning_content: assistantThinking || undefined,
    });

    // If the message was from a human and agent didn't send any reply, auto-send the assistant text.
    // When assistantText is empty, send a short system notice so the human isn't left waiting.
    if (hasHumanSender && !didSend && !this.interruptRequested) {
      const content = assistantText.trim()
        || `[系统: ${this.agentId.substring(0, 8)} 本轮无法回复，请检查上下文或重试]`;
      const members = await store.listGroupMemberIds({ groupId });
      const result = await store.sendMessage({
        groupId,
        senderId: this.agentId,
        content,
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
        ? "Reminder: created agents but no reply sent. Use send_group_message."
        : "Reminder: no send_* called this turn. Decide if reply is needed.";
      history.push({
        role: "user",
        content: reminder,
      });
      console.info(`[processGroupUnread] injected reminder (no LLM call) for agent ${this.agentId}`);
    }

    // Auto-skill trigger: after N meaningful sends, nudge the LLM to create a skill
    if (didSend) {
      this.meaningfulActions++;
      if (this.meaningfulActions >= AgentRunner.SKILL_AUTO_TRIGGER_AFTER) {
        this.meaningfulActions = 0;
        history.push({
          role: "system",
          content: `[Self-Learning] Patterns discovered — save with create_skill if worth preserving.`,
        });
        console.info(`[processGroupUnread] injected skill auto-trigger nudge for agent ${this.agentId}`);
      }
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

  private async fetchImageAsBase64(url: string): Promise<{ data: string; mediaType: string }> {
    const fullUrl = url.startsWith("http") ? url : `http://127.0.0.1:${process.env.PORT ?? 3017}${url}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(fullUrl, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const ext = url.split(".").pop()?.toLowerCase() ?? "png";
      const mediaType = EXT_TO_MEDIA[ext] ?? "image/png";
      return { data: buffer.toString("base64"), mediaType };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Archive the current LLM history to session_archives for cross-session retrieval.
   * Async, best-effort — does not block the main loop.
   * Called after every LLM turn (design doc §6.3).
   */
  private async archiveSessionToDb(
    history: HistoryMessage[],
    groupId: string,
    workspaceId: string,
  ) {
    try {
      const { v4: uuid } = await import("uuid");
      const db = getDb();

      // Extract key actions from history
      const assistantMsgs = history.filter((m) => m.role === "assistant" && m.content);
      const toolMsgs = history.filter((m) => m.role === "tool");
      const keyActions = toolMsgs
        .filter((m) => m.name && !["list_groups", "list_agents"].includes(m.name as string))
        .slice(-5)
        .map((m) => ({ tool: m.name, result: (m.content as string)?.slice(0, 100) }));

      const summary = assistantMsgs.map((m) => (m.content as string).slice(0, 200)).join(" ");
      const startTime = history[0]?.content ? new Date().toISOString() : null;

      await db.execute(
        sql`INSERT INTO session_archives (id, group_id, workspace_id, session_type, title, summary, key_decisions, start_time, end_time, archived_at)
            VALUES (${uuid()}, ${groupId}, ${workspaceId}, 'llm_turn', 'Auto archive', ${summary.slice(0, 2000)}, ${JSON.stringify(keyActions)}, ${startTime}, ${new Date()}, ${new Date()})`
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
    this._searchCountThisTurn = 0;
  }

  private async runWithTools(input: {
    groupId: UUID;
    workspaceId: UUID;
    history: HistoryMessage[];
    hasHumanSender?: boolean; // when true, agent MUST reply to the human
  }) {
    const maxToolRounds = 10;
    let assistantText = "";
    let assistantThinking = "";
    let didSend = false;
    this.resetForTurn();

    for (let round = 0; round < maxToolRounds; round++) {
      const senderHint = input.hasHumanSender
        ? "Human waiting — fulfill request then confirm with send_group_message."
        : "No human input — stay silent unless meaningful reason to speak.";
      input.history.push({
        role: "system",
        content: `[turn ${round}] ${senderHint}. One action per message.`,
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

      // Phase 1: Execute all tool calls in parallel for I/O concurrency
      const toolExecs = await Promise.all(
        res.toolCalls.map(async (call) => {
          const callKey = call.name
            ? `${call.name}:${JSON.stringify(safeJsonParse(call.argumentsText, {}))}`
            : "";
          // Check if this specific tool+params combo is blocked
          const isBlocked = !!(call.name && this.blockedTools.has(callKey));
          const isSend = !!(call.name && SEND_TOOL_NAMES.has(call.name));
          const result = isBlocked ? null : await this.executeToolCall({ groupId: input.groupId, call });
          return { call, callKey, isBlocked, isSend, result };
        })
      );

      // Phase 2: Process results serially (guardrails, events, history)
      for (const { call, callKey, isBlocked, isSend, result } of toolExecs) {
        if (this.agentPaused) {
          input.history.push({
            role: "system",
            content: `Agent is paused due to repeated tool failures. Do not attempt further tool calls until the issue is resolved.`,
          });
          break;
        }
        if (isBlocked) {
          input.history.push({
            role: "system",
            content: `Tool "${call.name}" with these parameters has failed too many times and is blocked. Use different parameters or a different approach.`,
          });
          continue;
        }

        if (isSend) didSend = true;

        // Guardrails: track failures
        const toolOk = (result as Record<string, unknown> | undefined)?.ok !== false;
        if (!toolOk && call.name) {
          const prev = this.turnToolFailures.get(call.name) ?? 0;
          this.turnToolFailures.set(call.name, prev + 1);

          const exactPrev = this.exactFailureCount.get(callKey) ?? 0;
          this.exactFailureCount.set(callKey, exactPrev + 1);
          if (exactPrev + 1 >= 5) {
            this.blockedTools.add(callKey);
            console.warn(`[AgentRunner] blocked tool ${callKey} after 5 exact failures`);
          }

          const sameToolPrev = this.sameToolFailureCount.get(call.name) ?? 0;
          this.sameToolFailureCount.set(call.name, sameToolPrev + 1);
          if (sameToolPrev + 1 >= 8) {
            this.agentPaused = true;
            console.warn(`[AgentRunner] agent paused after 8 total failures of ${call.name}`);
          }
        }

        // Persist skill usage
        const ok = (result as Record<string, unknown> | undefined)?.ok ?? true;
        if (call.name) void this.recordSkillUsage(call.name, ok === true);

        // Emit tool result event (streaming to UI)
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

        // Push result to history (serialized, in order)
        const resultStr = JSON.stringify(result);
        const truncatedResult = resultStr.length > MAX_TOOL_RESULT_CHARS
          ? resultStr.slice(0, MAX_TOOL_RESULT_CHARS) + `\n...[truncated, ${resultStr.length - MAX_TOOL_RESULT_CHARS} chars omitted. Use more specific tool parameters or get_message_detail for full content.]`
          : resultStr;
        input.history.push({
          role: "tool",
          content: truncatedResult,
          tool_call_id: call.id,
          name: call.name,
        });

        // Context compression: when a task is done, trim old tool exchanges
        if ((result as Record<string, unknown> | undefined)?.taskDone === true) {
          try { compressHistory(input.history); } catch { /* best-effort */ }
          void this.autoCreateSkillFromWorkflow(input.groupId);
        }
      }

      // Inject failure alert when a tool keeps failing — triggers agent self-learning
      for (const [toolName, count] of this.turnToolFailures) {
        if (count >= 3) {
          input.history.push({
            role: "system",
            content: `Tool "${toolName}" has failed ${count} times in this turn. Your current approach is not working. Options:
1. Call \`search_skill("<problem domain>")\` to search GitHub for relevant skills
2. Call \`get_skill("<name>")\` to load an existing local skill
3. Call \`install_skill("<name>", "<source_url>")\` to install a remote skill
4. Call \`create_skill\` to document a new fix pattern
5. Try a completely different approach`,
          });
          break;
        }
      }

    }

    // Nudge Engine: trigger periodic background analysis after tool loop completes
    this.nudgeCounter++;
    if (this.nudgeCounter >= NUDGE_INTERVAL) {
      this.nudgeCounter = 0;
      void this.nudgeAnalysis(input.groupId);
      void this.skillMaintenance();
    }

    return { assistantText, assistantThinking, didSend };
  }

  /**
   * Auto-create a skill when all tasks in a workflow are complete.
   * Best-effort — failures are silently ignored.
   * Triggered after update_task returns taskDone === true.
   */
  private async autoCreateSkillFromWorkflow(groupId: UUID) {
    try {
      const db = getDb();

      // Find active workflow for this group
      const wfRows = await db.execute(
        sql`SELECT id, name, description FROM workflows WHERE group_id = ${groupId} AND status IN ('active', 'paused') ORDER BY updated_at DESC LIMIT 1`
      );
      const wfArr = wfRows as unknown as Array<{ id: string; name: string; description: string | null }>;
      if (wfArr.length === 0) return;
      const wf = wfArr[0];

      // Check if all tasks are in terminal state
      const taskRows = await db.execute(
        sql`SELECT status, result, name FROM tasks WHERE workflow_id = ${wf.id}`
      );
      const tasks = taskRows as unknown as Array<{ status: string; result: string | null; name: string }>;
      if (tasks.length === 0) return;

      const terminalStates = new Set(["done", "approved", "blocked", "failed"]);
      const allDone = tasks.every((t) => terminalStates.has(t.status));
      if (!allDone) return;

      // Daily auto-skill limit: max 3 per agent
      const today = new Date().toISOString().slice(0, 10);
      const usageRows = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM skill_usage WHERE agent_id = ${this.agentId} AND used_at >= ${today} AND skill_name LIKE 'auto-%'`
      );
      const usageArr = usageRows as unknown as Array<{ cnt: number }>;
      if (usageArr.length > 0 && Number(usageArr[0].cnt) >= 3) return;

      // Generate skill name from workflow name
      const wfName = wf.name.trim();
      const skillName = `auto-${wfName.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)}`;

      const doneTasks = tasks.filter((t) => t.status === "done" || t.status === "approved");
      if (doneTasks.length === 0) return;

      const taskSummaries = doneTasks
        .map((t) => {
          const resultPreview = (t.result ?? "").slice(0, 300);
          return `- **${t.name}**: ${resultPreview || "(no result recorded)"}`;
        })
        .join("\n");

      const totalTasks = tasks.length;
      const successCount = doneTasks.length;
      const skillDescription = `Auto-generated skill from workflow "${wfName}" (${successCount}/${totalTasks} tasks successful)`;
      const skillContent = [
        `# ${wfName}`,
        "",
        "## Overview",
        "",
        `Workflow completed with ${successCount}/${totalTasks} tasks successful.`,
        "",
        "## Tasks",
        "",
        taskSummaries,
        "",
        "## Notes",
        "",
        "- This skill was auto-generated from a completed workflow.",
        "- Review and update the content for reusability.",
      ].join("\n");

      // Write skill file
      const { getSkillDirectory, invalidateSkillCache } = await import("./skill-loader");
      const skillsDir = getSkillDirectory();
      const skillDir = path.join(skillsDir, skillName);
      const existing = await fs.stat(skillDir).catch(() => null);
      if (existing?.isDirectory()) return; // skip if skill already exists

      await fs.mkdir(skillDir, { recursive: true });
      const frontmatter = [
        "---",
        `name: ${skillName}`,
        `description: ${skillDescription.slice(0, 200)}`,
        "---",
        "",
        skillContent,
      ].join("\n");
      await fs.writeFile(path.join(skillDir, "SKILL.md"), frontmatter, "utf-8");
      invalidateSkillCache();

      // Record in skill_usage table
      try {
        await db.execute(
          sql`INSERT INTO skill_usage (id, skill_name, agent_id, success, used_at, status)
              VALUES (gen_random_uuid(), ${skillName}, ${this.agentId}, true, ${new Date().toISOString()}, 'active')`
        );
      } catch { /* best-effort */ }

      console.info(`[autoCreateSkill] auto-created skill "${skillName}" from workflow "${wfName}"`);
    } catch {
      // best-effort — skill auto-creation should never block the agent
    }
  }

  /**
   * Nudge Engine: full LLM-based background analysis of recent conversation.
   * Runs every NUDGE_INTERVAL rounds. Fire-and-forget — never blocks the agent.
   *
   * Sends recent history to the primary LLM provider for semantic analysis,
   * asking it to identify reusable patterns, fix recipes, and improvement
   * suggestions. Creates skills from the LLM's recommendations.
   */
  private async nudgeAnalysis(groupId: UUID) {
    try {
      const agent = await store.getAgent({ agentId: this.agentId });
      const parsed = safeJsonParse<unknown>(agent.llmHistory, {});
      const history = Array.isArray(parsed) ? (parsed as HistoryMessage[]) : [];
      if (history.length < 6) return;

      // Check daily limit (shared with autoCreateSkillFromWorkflow)
      const db = getDb();
      const today = new Date().toISOString().slice(0, 10);
      const usageRows = await db.execute(
        sql`SELECT COUNT(*) as cnt FROM skill_usage WHERE agent_id = ${this.agentId} AND used_at >= ${today} AND skill_name LIKE 'auto-%'`
      );
      const usageArr = usageRows as unknown as Array<{ cnt: number }>;
      const usedToday = usageArr.length > 0 ? Number(usageArr[0].cnt) : 0;
      if (usedToday >= MAX_AUTO_SKILLS_PER_AGENT_PER_DAY) {
        // Still try patching: patching reuses existing skill_usage slot
        // Only skip if usedToday >= limit AND there's nothing to patch
      }

      // Discover existing skills for potential patching
      const { getSkillLoader, getSkillDirectory, invalidateSkillCache } = await import("./skill-loader");
      const skillLoader = await getSkillLoader();
      const existingSkills = await skillLoader.listAutoLoadSkills();
      const existingSkillsBlock = existingSkills.length > 0
        ? `\nExisting skills available for patching:\n${existingSkills.map((s) => `  - ${s.name}: ${s.description}`).join("\n")}\n\nIf the detected pattern relates to an existing skill, set action to "patch" and skillName to the existing skill's name. The full content will be replaced with your skillContent.`
        : "";

      // Build a condensed view of recent history for the LLM
      const recentHistory = history.slice(-30);
      const historySummary = recentHistory.map((m) => {
        const role = m.role;
        const name = "name" in m && m.name ? `(${m.name})` : "";
        let content: string;
        if (typeof m.content === "string") {
          content = m.content.slice(0, 300);
        } else if (m.content && typeof m.content === "object") {
          content = JSON.stringify(m.content).slice(0, 300);
        } else {
          content = "";
        }
        const toolCalls = m.role !== "tool" && m.tool_calls
          ? (m.tool_calls as Array<{ function: { name: string } }>).map((tc) => tc.function.name).join(", ")
          : "";
        return `[${role}]${name} ${content}${toolCalls ? ` | calls: ${toolCalls}` : ""}`;
      }).join("\n");

      const systemPrompt = [
        "You are analyzing an AI agent conversation to find reusable patterns. Your task:",
        "",
        "1. Identify tool failures that were later resolved (valuable fix recipes)",
        "2. Identify repeated successful tool usage patterns (potential automation)",
        "3. Identify any other reusable knowledge (workflow steps, debugging tricks)",
        "",
        "Respond with a JSON object only (no markdown, no extra text):",
        JSON.stringify({
          hasPattern: false,
          action: "create", // "create" for new skill, "patch" to update existing, null if no pattern
          skillName: "kebab-case-name-or-null",
          skillDescription: "one-line summary or null",
          skillContent: "full markdown content or null",
          patchSummary: "what changed or null",
        }),
        "",
        "Only set hasPattern=true if you found a genuinely reusable pattern.",
        "skillContent should be concise, actionable markdown (< 1000 chars).",
        'When action is "patch", skillName must match an existing skill name exactly.',
        'When action is "patch", the existing skill\'s SKILL.md will be fully replaced with your skillContent.',
        "Prefer patching an existing skill over creating a new one when the pattern relates to known knowledge.",
        'If no pattern found, respond with {"hasPattern":false}.',
        existingSkillsBlock,
      ].join("\n");

      // Make non-streaming LLM call through the global rate limiter (llmScheduler)
      const provider = getLlmProvider();
      let url: string;
      let apiKey: string;
      let model: string;
      let backupModel: string;
      let keyPool: KeyPool | null = null;

      switch (provider) {
        case "openrouter": {
          const cfg = getOpenRouterConfig();
          url = cfg.baseUrl;
          apiKey = cfg.apiKey;
          model = cfg.model || "google/gemini-2.0-flash-001";
          backupModel = cfg.backupModel;
          keyPool = cfg.keyPool;
          break;
        }
        case "anthropic": {
          const cfg = getAnthropicConfig();
          url = cfg.baseUrl || "https://api.anthropic.com/v1/messages";
          apiKey = cfg.apiKey;
          model = cfg.model;
          backupModel = cfg.backupModel;
          keyPool = cfg.keyPool;
          break;
        }
        case "glm": {
          const cfg = getGlmConfig();
          url = cfg.baseUrl;
          apiKey = cfg.apiKey;
          model = cfg.model;
          backupModel = cfg.backupModel;
          keyPool = cfg.keyPool;
          break;
        }
        case "ollama": {
          const cfg = getOllamaConfig();
          url = cfg.baseUrl;
          apiKey = "";
          model = cfg.model;
          backupModel = cfg.backupModel;
          break;
        }
        default:
          return;
      }

      const nudgeOpts = { backupModel, keyPool: keyPool ?? undefined };

      // Anthropic uses a different non-OpenAI format; use OpenAI-compatible for all others
      let respText: string;
      if (provider === "anthropic") {
        const resp = await llmFetch(url, {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            max_tokens: 2048,
            system: systemPrompt,
            messages: [{ role: "user", content: historySummary }],
          }),
        }, "Nudge-Anthropic", nudgeOpts);
        if (!resp.ok) return;
        const data = await resp.json() as { content?: Array<{ text?: string }> };
        respText = data.content?.[0]?.text ?? "";
      } else {
        // OpenAI-compatible (OpenRouter, GLM, Ollama)
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

        const resp = await llmFetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: historySummary },
            ],
            temperature: 0.1,
            max_tokens: 2048,
            stream: false,
          }),
        }, "Nudge", nudgeOpts);
        if (!resp.ok) return;
        const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
        respText = data.choices?.[0]?.message?.content ?? "";
      }

      if (!respText) return;

      // Parse structured response
      const result = safeJsonParse(respText, null) as {
        hasPattern?: boolean;
        action?: "create" | "patch";
        skillName?: string | null;
        skillDescription?: string | null;
        skillContent?: string | null;
        patchSummary?: string | null;
      } | null;

      if (!result || !result.hasPattern || !result.skillContent) return;

      const action = result.action === "patch" ? "patch" : "create";

      if (action === "patch") {
        // ---- Auto-patching: update existing skill ----
        const existingSkill = existingSkills.find((s) => s.name === result.skillName);
        if (!existingSkill) {
          console.warn(`[nudgeAnalysis] patch requested for "${result.skillName}" but skill not found, falling back to create`);
          // Fall through to create logic below
        } else {
          const skillDescription = (result.skillDescription ?? existingSkill.description).slice(0, 200);
          const skillContent = result.skillContent;

          // Write updated content with patch metadata
          const patchVersion = new Date().toISOString().slice(0, 10);
          const frontmatter = [
            "---",
            `name: ${existingSkill.name}`,
            `description: ${skillDescription}`,
            `patched: ${patchVersion}`,
            "---",
            "",
            skillContent,
          ].join("\n");
          await fs.writeFile(path.join(existingSkill.skillDir, "SKILL.md"), frontmatter, "utf-8");
          invalidateSkillCache();

          await db.execute(
            sql`INSERT INTO skill_usage (id, skill_name, agent_id, success, used_at, status)
                VALUES (gen_random_uuid(), ${existingSkill.name}, ${this.agentId}, true, ${new Date().toISOString()}, 'active')`
          ).catch((err) => console.warn(`[nudgeAnalysis] skill_usage INSERT failed: ${err}`));

          const patchSummary = result.patchSummary ?? "updated via nudge analysis";
          console.info(`[nudgeAnalysis] patched skill "${existingSkill.name}": ${patchSummary}`);
          return;
        }
      }

      // ---- Create new skill (default, or fallback from failed patch) ----
      const skillName = `auto-nudge-${(result.skillName ?? "pattern")
        .toLowerCase()
        .replace(/[^a-z0-9一-鿿-]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60)}`;
      const skillDescription = (result.skillDescription ?? "Auto-generated skill from nudge analysis").slice(0, 200);
      const skillContent = result.skillContent;

      // Respect daily limit for new skill creation
      if (usedToday >= MAX_AUTO_SKILLS_PER_AGENT_PER_DAY) return;

      const skillsDir = getSkillDirectory();
      const skillDirPath = path.join(skillsDir, skillName);
      const existing = await fs.stat(skillDirPath).catch(() => null);
      if (existing?.isDirectory()) return;

      await fs.mkdir(skillDirPath, { recursive: true });
      const frontmatter = [
        "---",
        `name: ${skillName}`,
        `description: ${skillDescription}`,
        "---",
        "",
        skillContent,
      ].join("\n");
      await fs.writeFile(path.join(skillDirPath, "SKILL.md"), frontmatter, "utf-8");
      invalidateSkillCache();

      await db.execute(
        sql`INSERT INTO skill_usage (id, skill_name, agent_id, success, used_at, status)
            VALUES (gen_random_uuid(), ${skillName}, ${this.agentId}, true, ${new Date().toISOString()}, 'active')`
      ).catch((err) => console.warn(`[nudgeAnalysis] skill_usage INSERT failed: ${err}`));

      console.info(`[nudgeAnalysis] LLM created skill "${skillName}" from conversation analysis`);
    } catch {
      // best-effort — nudge analysis should never block the agent
    }
  }

  /**
   * Skill lifecycle maintenance: detect stale skills, archive old ones,
   * and merge duplicates. Runs once per nudge cycle as best-effort.
   * (design doc §11.4 — skill lifecycle)
   */
  private async skillMaintenance() {
    try {
      const { getSkillLoader, getSkillDirectory, invalidateSkillCache } = await import("./skill-loader");
      const db = getDb();
      const loader = await getSkillLoader();
      const allSkills = await loader.listAutoLoadSkills();
      if (allSkills.length === 0) return;

      const now = new Date();
      const staleThreshold = new Date(now.getTime() - SKILL_STALE_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const archiveThreshold = new Date(now.getTime() - SKILL_ARCHIVE_DAYS * 24 * 60 * 60 * 1000).toISOString();

      // Query last usage date for each skill
      const skillNames = allSkills.map(s => s.name);
      const rows = await db.execute(
        sql`SELECT skill_name, MAX(used_at) as last_used FROM skill_usage WHERE skill_name = ANY(${skillNames}) GROUP BY skill_name`
      );
      const lastUsageMap = new Map<string, string>();
      for (const row of rows as Array<Record<string, unknown>>) {
        lastUsageMap.set(row.skill_name as string, row.last_used as string);
      }

      for (const skill of allSkills) {
        // Check for `patched` date in frontmatter as fallback
        const patchedDate = skill.metadata?.patched as string | undefined;
        const lastUsed = lastUsageMap.get(skill.name) ?? patchedDate ?? null;

        if (!lastUsed) continue;

        // Archive: no usage in 90 days
        if (lastUsed < archiveThreshold) {
          const archivedDir = path.join(getSkillDirectory(), `_archived-${skill.name}`);
          try {
            await fs.rename(skill.skillDir, archivedDir);
            await db.execute(
              sql`UPDATE skill_usage SET status = 'archived' WHERE skill_name = ${skill.name} AND status != 'archived'`
            );
            console.info(`[skillMaintenance] archived skill "${skill.name}" (last used ${lastUsed.slice(0, 10)})`);
          } catch {
            // best-effort — skill archiving should not break anything
          }
          invalidateSkillCache();
        }
        // Stale: no usage in 30 days — add usage hint for future nudge analysis
        else if (lastUsed < staleThreshold) {
          console.info(`[skillMaintenance] skill "${skill.name}" is stale (last used ${lastUsed.slice(0, 10)}) — consider merging or removing`);
        }
      }

      // Dedup: find skills with overlapping descriptions
      const descs = allSkills.map(s => ({ name: s.name, desc: (s.description ?? "").toLowerCase() }));
      for (let i = 0; i < descs.length; i++) {
        for (let j = i + 1; j < descs.length; j++) {
          const a = descs[i];
          const b = descs[j];
          if (!a.desc || !b.desc) continue;
          // Simple word overlap check
          const aWords = new Set(a.desc.split(/\s+/));
          const bWords = new Set(b.desc.split(/\s+/));
          const overlap = [...aWords].filter(w => bWords.has(w)).length;
          const union = new Set([...aWords, ...bWords]).size;
          if (union > 3 && overlap / union >= SKILL_MERGE_SIMILARITY) {
            console.info(`[skillMaintenance] potential duplicate skills: "${a.name}" and "${b.name}" — consider merging`);
          }
        }
      }
    } catch {
      // best-effort — skill maintenance should never block the agent
    }
  }

  /**
   * Per-turn file-mutation verifier: after a file-write tool call,
   * read back the target file to confirm it actually exists and has content.
   * Best-effort — failures are logged, not surfaced to the agent.
   * (design doc §11.5)
   */
  private async verifyFileMutation(args: Record<string, unknown>, resultContent: string) {
    try {
      // Extract file path from common argument patterns
      const filePath = (args.file_path ?? args.path ?? args.filename ?? args.filePath ?? "") as string;
      if (!filePath || typeof filePath !== "string") return;

      const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
      const stat = await fs.stat(resolved).catch(() => null);
      if (!stat?.isFile()) {
        console.warn(`[verifyFileMutation] file not found after write: ${filePath}`);
        return;
      }
      // Verify file is not empty
      if (stat.size === 0) {
        console.warn(`[verifyFileMutation] file is empty after write: ${filePath}`);
        return;
      }
      // Log successful verification
      console.info(`[verifyFileMutation] verified: ${filePath} (${stat.size} bytes)`);
    } catch {
      // best-effort
    }
  }

  /**
   * Build a memory snapshot — top N important memories frozen at session start.
   * Injected as a system message to stabilize prompt caching.
   * Best-effort — returns null on failure or if no memories exist.
   */
  private async buildMemorySnapshot(): Promise<string | null> {
    try {
      const db = getDb();

      const rows = await db.execute(
        sql`SELECT content, importance, source FROM memories WHERE agent_id = ${this.agentId} ORDER BY importance DESC, created_at DESC LIMIT 20`
      ) as unknown as Array<{ content: string; importance: number | null; source: string | null }>;

      if (!rows || rows.length === 0) return null;

      const lines = rows.map((r, i) => {
        const imp = r.importance ?? 3;
        const source = r.source ? ` (source: ${r.source})` : "";
        return `${i + 1}. [${"★".repeat(Math.min(5, imp))}${"☆".repeat(5 - Math.min(5, imp))}] ${r.content}${source}`;
      });

      return [
        "## Memory Snapshot (session start)",
        "",
        "Key facts from prior sessions, ordered by importance:",
        "",
        ...lines,
        "",
        "---",
      ].join("\n");
    } catch {
      return null; // best-effort
    }
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

    // check_fn: if tool is filtered by availability, return clear error
    if (this.toolContext) {
      const check = TOOL_AVAILABILITY[name];
      if (check && !check(this.toolContext)) {
        emitToolDone(false);
        return { ok: false, error: `Tool "${name}" is not available in the current context.` };
      }
    }

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

    // -----------------------------------------------------------------------
    // search_skill: GitHub code search for SKILL.md files
    // -----------------------------------------------------------------------
    if (name === "search_skill") {
      const args = safeJsonParse<{ query?: string; maxResults?: number }>(
        input.call.argumentsText, {}
      );
      const query = (args.query ?? "").trim();
      if (!query) {
        emitToolDone(false);
        return { ok: false, error: "Missing query parameter" };
      }

      const maxResults = Math.min(args.maxResults ?? 5, 10);

      // Guard: prevent infinite search loops within a single tool turn
      if (this._searchCountThisTurn >= 2) {
        emitToolDone(false);
        return { ok: false, error: "search_skill has been called too many times this turn. Try a different approach or use install_skill with a known source." };
      }
      this._searchCountThisTurn++;

      // Guard: cache same query within 5 minutes
      const cacheKey = query.toLowerCase();
      const now = Date.now();
      const CACHE_TTL = 5 * 60 * 1000;
      const lastSearch = AgentRunner._searchCache.get(cacheKey);
      if (lastSearch && (now - lastSearch.ts) < CACHE_TTL) {
        emitToolDone(true);
        return { ok: true, results: lastSearch.results, cached: true };
      }

      try {
        const results = await searchGitHubSkills(query, maxResults);
        // Cache the result
        AgentRunner._searchCache.set(cacheKey, { results, ts: now });

        emitToolDone(true);
        return { ok: true, results, count: results.length };
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // GitHub API rate limit or network error → fallback to local skills
        if (errMsg.includes("403") || errMsg.includes("429") || errMsg.includes("rate")) {
          const localResults = await searchLocalSkills(query);
          emitToolDone(true);
          return { ok: true, results: localResults, count: localResults.length, fallback: "GitHub API rate limited, showing local skills" };
        }
        emitToolDone(false);
        return { ok: false, error: `search_skill failed: ${errMsg.slice(0, 200)}` };
      }
    }

    // -----------------------------------------------------------------------
    // install_skill: Download and install a skill from GitHub
    // -----------------------------------------------------------------------
    if (name === "install_skill") {
      const args = safeJsonParse<{ name?: string; source_url?: string }>(
        input.call.argumentsText, {}
      );
      const skillName = (args.name ?? "").trim();
      const sourceUrl = (args.source_url ?? "").trim();
      if (!skillName || !sourceUrl) {
        emitToolDone(false);
        return { ok: false, error: "Missing required fields: name, source_url" };
      }

      // Validate skill name: only alphanumeric, hyphens, underscores
      if (!/^[a-z0-9_-]+$/.test(skillName)) {
        emitToolDone(false);
        return { ok: false, error: "Invalid skill name. Only lowercase letters, numbers, hyphens, and underscores allowed." };
      }

      // Validate URL: must be a GitHub URL
      if (!sourceUrl.startsWith("https://github.com") && !sourceUrl.startsWith("https://raw.githubusercontent.com")) {
        emitToolDone(false);
        return { ok: false, error: "source_url must be a GitHub URL (github.com or raw.githubusercontent.com)" };
      }

      // Check if already installed
      const skillsDir = getSkillDirectory();
      const skillDir = path.join(skillsDir, skillName);
      if (existsSync(skillDir)) {
        emitToolDone(true);
        return { ok: true, message: `Skill "${skillName}" is already installed at ${skillDir}`, skip: true };
      }

      try {
        // Download SKILL.md
        const rawUrl = toRawGitHubUrl(sourceUrl);
        const skillContent = await fetchSkillContent(rawUrl);

        // Validate YAML frontmatter
        const frontmatterMatch = skillContent.match(FRONTMATTER_RE);
        if (!frontmatterMatch) {
          emitToolDone(false);
          return { ok: false, error: "Invalid skill file: missing YAML frontmatter" };
        }
        const frontmatter = parseFrontmatter(frontmatterMatch[1]);
        if (!frontmatter || !frontmatter.name || !frontmatter.description) {
          emitToolDone(false);
          return { ok: false, error: "Invalid skill file: missing name or description in frontmatter" };
        }

        // Security scan: reject dangerous content
        const scanResult = scanSkillContent(skillContent);
        if (!scanResult.ok) {
          emitToolDone(false);
          return { ok: false, error: `Security scan failed: ${scanResult.reason}` };
        }

        // Save skill
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, "SKILL.md"), skillContent, "utf-8");
        invalidateSkillCache();

        emitToolDone(true);
        return { ok: true, skill_name: skillName, path: path.join(skillDir, "SKILL.md") };
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to install skill" };
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
        /\btaskkill\b(?!.*\/IM\s+.*LOStudio)/,   // kill running processes (except LOStudio restart)
        /(?<!LOStudio.*)\bStop-Process\b/,        // PowerShell kill (except LOStudio restart)
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
          shell: process.platform === "win32" ? "cmd.exe" : "/bin/bash",
          windowsHide: true, // Hide CMD/PowerShell window on Windows
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

      // Cascade delete: task_logs → tasks → agent_assignments → workflows → messages → group_members → session_archive → groups
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
          // 7. session_archive
          await tx.execute(sql`DELETE FROM session_archive WHERE group_id = ${groupId}`);
          // 8. group
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
      const args = safeJsonParse<{ groupId?: string; limit?: number }>(input.call.argumentsText, {});
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
      const msgLimit = args.limit && args.limit > 0 && args.limit <= 50 ? args.limit : 20;
      const messages = await store.listMessages({ groupId, limit: msgLimit });

      // Return summary cards (library catalog pattern — metadata only, not full content)
      const cards = messages.map(m => ({
        id: m.id,
        sender: m.senderId,
        time: m.sendTime,
        type: m.contentType,
        preview: m.content.length > 100 ? m.content.slice(0, 100) + "..." : m.content,
      }));
      emitToolDone(true);
      return { ok: true, messages: cards, total: cards.length };
    }

    if (name === "get_message_detail") {
      const args = safeJsonParse<{ messageId?: string }>(input.call.argumentsText, {});
      const messageId = (args.messageId ?? "").trim();
      if (!messageId) {
        emitToolDone(false);
        return { ok: false, error: "Missing messageId" };
      }
      const msg = await store.getMessage({ messageId });
      if (!msg) {
        emitToolDone(false);
        return { ok: false, error: "Message not found" };
      }
      // Verify access: check if agent is in the group this message belongs to
      const groupRows = await getDb().execute(
        sql`SELECT group_id FROM messages WHERE id = ${messageId}`
      );
      const msgGroup = (groupRows as unknown as Array<{ group_id: string }>)[0];
      if (!msgGroup) {
        emitToolDone(false);
        return { ok: false, error: "Message not found" };
      }
      const members = await store.listGroupMemberIds({ groupId: msgGroup.group_id });
      if (!members.includes(this.agentId)) {
        emitToolDone(false);
        return { ok: false, error: "Access denied" };
      }
      emitToolDone(true);
      return { ok: true, message: msg };
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
      const db = getDb();

      try {
        await db.execute(
          sql`INSERT INTO workflows (id, group_id, name, description, creator_id, status, created_at, updated_at) VALUES (${wfId}, ${groupId}, ${wfName}, ${args.description ?? null}, ${this.agentId}, ${initialStatus}, ${now}, ${now})`
        );

        for (const t of tasks) {
          const tId = uuid();
          const dependsOn = (t.dependsOn ?? []).map((d) => d.trim()).filter(Boolean);
          await db.execute(
            sql`INSERT INTO tasks (id, workflow_id, name, description, assignee_role, expected_output, status, depends_on, max_revisions, created_at) VALUES (${tId}, ${wfId}, ${t.name ?? "unnamed"}, ${t.description ?? null}, ${t.assigneeRole ?? null}, ${t.expectedOutput ?? null}, 'pending', ${dependsOn}, ${t.maxRevisions ?? 3}, ${now})`
          );
        }
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to create workflow" };
      }

      emitToolDone(true);
      const result: Record<string, unknown> = { ok: true, workflowId: wfId, taskCount: tasks.length };

      // Record decision: workflow creation
      void this.recordDecision({
        groupId: input.groupId,
        decisionType: "create",
        targetType: "workflow",
        targetId: wfId,
        inputSummary: `Created workflow "${wfName}" with ${tasks.length} tasks`,
        outputSummary: `Workflow ${wfId} created, status: ${initialStatus}`,
        success: true,
      });

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

      const db = getDb();
      const now = new Date();

      // When submitting for review, check max_revisions before allowing
      let finalStatus = status;
      if (status === "review") {
        const taskRows = await db.execute(
          sql`SELECT review_count, max_revisions FROM tasks WHERE id = ${taskId}`
        );
        const taskArr = taskRows as Array<Record<string, unknown>>;
        if (taskArr.length > 0) {
          const currentReviewCount = (taskArr[0].review_count as number) ?? 0;
          const maxRevisions = (taskArr[0].max_revisions as number) ?? 3;
          if (currentReviewCount + 1 >= maxRevisions) {
            finalStatus = "blocked";
          }
        }
      }

      const updateParts: ReturnType<typeof sql>[] = [];
      updateParts.push(sql`status = ${finalStatus}`);
      if (finalStatus === "in_progress") updateParts.push(sql`started_at = ${now}`);
      if (finalStatus === "review") updateParts.push(sql`reviewed_at = ${now}`);
      if (finalStatus === "done") updateParts.push(sql`completed_at = ${now}`);
      if (finalStatus === "approved") updateParts.push(sql`completed_at = ${now}`);
      if (args.result) updateParts.push(sql`result = ${args.result}`);
      if (args.error) updateParts.push(sql`error = ${args.error}`);
      if (finalStatus === "review") updateParts.push(sql`review_count = review_count + 1`);
      if (finalStatus === "blocked") updateParts.push(sql`review_count = review_count + 1`);

      try {
        await db.execute(
          sql`UPDATE tasks SET ${sql.join(updateParts, sql`, `)} WHERE id = ${taskId}`
        );

        // Log task status change
        await db.execute(
          sql`INSERT INTO task_logs (id, task_id, event_type, event_data, actor_id, created_at)
              VALUES (gen_random_uuid(), ${taskId}, ${`task_${finalStatus}`},
                      jsonb_build_object('status', ${finalStatus}, 'result', ${args.result ?? null}),
                      ${this.agentId}, ${now})`
        );
      } catch (err: unknown) {
        emitToolDone(false);
        return { ok: false, error: err instanceof Error ? err.message : "Failed to update task" };
      }

      emitToolDone(true);
      // Record decision: task status change (approve/reject/fix)
      const decisionMap: Record<string, string> = {
        done: "approve", approved: "approve", rejected: "reject",
        failed: "fix", blocked: "escalate", review: "approve",
      };
      const decisionType = decisionMap[finalStatus] ?? "fix";
      void this.recordDecision({
        groupId: input.groupId,
        decisionType,
        targetType: "task",
        targetId: taskId,
        inputSummary: `Task ${taskId} → ${finalStatus}`,
        outputSummary: args.result?.slice(0, 200) ?? finalStatus,
        success: finalStatus === "done" || finalStatus === "approved",
      });
      return { ok: true, taskId, status: finalStatus, taskDone: finalStatus === "done" || finalStatus === "approved" };
    }

    if (name === "get_workflow_status") {
      const args = safeJsonParse<{ workflowId?: string; groupId?: string }>(
        input.call.argumentsText,
        {}
      );
      let workflowId = (args.workflowId ?? "").trim();

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
        // Record decision: agent delegation
        void this.recordDecision({
          groupId,
          decisionType: "delegate",
          targetType: "agent",
          targetId: agentId,
          inputSummary: `Assign ${agentId} to group ${groupId.slice(0,8)} task ${(args.taskId ?? "").slice(0,8) || "(none)"}`,
          outputSummary: `Assigned, assignmentId: ${assignId.slice(0,8)}`,
          success: true,
        });
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
        const tagsSql = tagsArr.length > 0
          ? buildTextArray(tagsArr)
          : sql`ARRAY[]::text[]`;

        await db.execute(
          sql`INSERT INTO memories (id, agent_id, workspace_id, content, tags, created_at, accessed_at, importance, source) VALUES (${memId}, ${this.agentId}, ${ws.workspace_id}, ${content}, ${tagsSql}, ${nowIso}, ${nowIso}, ${importance}, ${source})`
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
        const db = getDb();
        const limit = Math.min(50, args.limit ?? 10);
        const filterTags = args.tags ?? [];

        // Layer 1: Keyword + tag exact match (design doc §6.1)
        let layer1Rows;
        if (filterTags.length > 0) {
          const filterTagsSql = buildTextArray(filterTags);
          layer1Rows = await db.execute(
            sql`SELECT id, content, tags, importance, source, created_at
                FROM memories WHERE agent_id = ${this.agentId}
                AND (content ILIKE ${`%${query}%`} OR tags && ${filterTagsSql})
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
            // Exclude layer1 IDs using parameterized IN clause
            const excludedIds = layer1Ids.slice(0, 50);
            const tagArrSql = tagArr.length > 0
              ? buildTextArray(tagArr)
              : sql`ARRAY[]::text[]`;
            const layer2Rows = await db.execute(
              sql`SELECT id, content, tags, importance, source, created_at
                  FROM memories WHERE agent_id = ${this.agentId}
                  AND id NOT IN (${sql.join(excludedIds.map((id) => sql`${id}`), sql`, `)})
                  AND tags && ${tagArrSql}
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
        const db = getDb();
        const wsRows = await db.execute(
          sql`SELECT workspace_id FROM agents WHERE id = ${this.agentId} LIMIT 1`
        );
        const ws = (wsRows as unknown as Array<{ workspace_id: string }>)[0];
        if (!ws) {
          emitToolDone(false);
          return { ok: false, error: "Agent not found" };
        }
        const limit = Math.min(50, args.limit ?? 10);

        let rows;
        rows = await db.execute(
          sql`SELECT id, group_id, summary, key_decisions, archived_at
              FROM session_archives
              WHERE workspace_id = ${ws.workspace_id}
              AND (summary ILIKE ${`%${query}%`} OR session_type ILIKE ${`%${query}%`})
              ORDER BY archived_at DESC LIMIT ${limit}`
        );

        const sessions = (rows as Array<Record<string, unknown>>).map((r) => ({
          id: r.id,
          groupId: r.group_id,
          summary: r.summary,
          keyDecisions: r.key_decisions,
          archivedAt: r.archived_at,
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

      // Per-turn file-mutation verifier: after file-write operations,
      // read back the file to confirm content was actually persisted.
      // (design doc §11.5 — file-mutation verifier)
      const fileWriteTools = new Set(["write_file", "edit_file", "write", "str_replace_editor", "write_to_file", "create_file"]);
      if (fileWriteTools.has(name) && result.ok && result.content) {
        void this.verifyFileMutation(args, result.content);
      }

      return result;
    }

    emitToolDone(false);
    return { ok: false, error: `Unknown tool: ${name}` };
  }

  /**
   * Extract deltas from assembler state changes (reasoning, content, tool calls)
   * and emit bus + stream events for each.
   */
  private processSseDeltas(
    prevState: StreamAssembledState,
    nextState: StreamAssembledState,
    ctx: { workspaceId: UUID; groupId: UUID; round: number },
    rawEvt: unknown
  ): StreamAssembledState {
    const reasoningDelta = nextState.reasoningContent.slice(prevState.reasoningContent.length);
    const contentDelta = nextState.content.slice(prevState.content.length);
    const toolCallDeltas = extractToolCallDeltas(rawEvt as any, prevState, nextState);

    if (reasoningDelta) {
      this.bus.emit(this.agentId, { event: "agent.stream", data: { kind: "reasoning", delta: reasoningDelta } });
      void appendAgentStreamEvent({ agentId: this.agentId, round: ctx.round, kind: "reasoning", delta: reasoningDelta });
    }
    if (contentDelta) {
      this.bus.emit(this.agentId, { event: "agent.stream", data: { kind: "content", delta: contentDelta } });
      void appendAgentStreamEvent({ agentId: this.agentId, round: ctx.round, kind: "content", delta: contentDelta });
    }
    for (const delta of toolCallDeltas) {
      this.bus.emit(this.agentId, { event: "agent.stream", data: { kind: "tool_calls", delta: delta.delta, tool_call_id: delta.tool_call_id, tool_call_name: delta.tool_call_name } });
      void appendAgentStreamEvent({ agentId: this.agentId, round: ctx.round, kind: "tool_calls", delta: delta.delta, tool_call_id: delta.tool_call_id, tool_call_name: delta.tool_call_name });
    }

    return nextState;
  }

  /**
   * Run the SSE event loop, emitting deltas to bus + DB as they arrive.
   * Returns the final assembled state.
   */
  private async runSseLoop(
    body: ReadableStream<Uint8Array>,
    assembler: { push(evt: unknown): StreamAssembledState; snapshot(): StreamAssembledState },
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ): Promise<StreamAssembledState> {
    let prev = assembler.snapshot();
    for await (const evt of parseSSEJsonLines(body)) {
      prev = this.processSseDeltas(prev, assembler.push(evt as any), ctx, evt);
    }
    return prev;
  }

  /** Emit agent.done events + DB bookkeeping after SSE loop completes. */
  private emitAgentDone(
    ctx: { workspaceId: UUID; groupId: UUID; round: number },
    finishReason: string | null
  ) {
    this.bus.emit(this.agentId, { event: "agent.done", data: { finishReason: finishReason ?? undefined } });
    void appendAgentStreamEvent({ agentId: this.agentId, round: ctx.round, kind: "done", finishReason });
    getWorkspaceUIBus().emit(ctx.workspaceId, { event: "ui.agent.llm.done", data: { workspaceId: ctx.workspaceId, agentId: this.agentId, groupId: ctx.groupId, round: ctx.round, finishReason: finishReason ?? undefined } });
  }

  /** Save token usage to group context (best-effort). */
  private async saveTokenUsage(groupId: UUID, totalTokens: number) {
    if (totalTokens <= 0) return;
    try {
      await store.setGroupContextTokens({ groupId, tokens: totalTokens });
    } catch { /* Best effort */ }
  }

  private async callLlmStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const chain = getProviderChain();
    const errors: string[] = [];

    for (const provider of chain) {
      try {
        const result = await this.callLlmProvider(provider, history, ctx);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const is429 = msg.includes("429") || msg.includes("upstream error");
        if (!is429) throw err; // non-429 errors are fatal
        errors.push(`${provider}: ${msg}`);
        console.warn(`[callLlmStreaming] ${provider} 429, trying next provider. Chain: ${chain.join(" → ")}`);
        // Keep streaming to the UI so the user sees the fallback
        getWorkspaceUIBus().emit(ctx.workspaceId, {
          event: "ui.agent.llm.fallback",
          data: {
            workspaceId: ctx.workspaceId,
            agentId: this.agentId,
            groupId: ctx.groupId,
            from: provider,
            to: chain[chain.indexOf(provider) + 1] ?? "none",
          },
        });
      }
    }

    throw new Error(`All providers returned 429: ${errors.join("; ")}`);
  }

  private async callLlmProvider(
    provider: LlmProvider,
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const handler = getProviderHandler(provider);
    if (!handler) {
      throw new Error(`Unknown LLM provider: "${provider}". Add it to PROVIDER_REGISTRY.`);
    }
    return handler(this, history, ctx);
  }

  /* internal */ async callOpenRouterStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { apiKey, baseUrl, model, backupModel, httpReferer, appTitle, keyPool } = getOpenRouterConfig();

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

    const tools = await getAgentTools(this.toolContext ?? undefined);
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

    const upstream = await llmFetch(baseUrl, {
      method: "POST",
      headers,
      body: requestBody,
    }, "OpenRouter", { backupModel, keyPool });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      throw new Error(`OpenRouter upstream error: ${upstream.status} ${text}`);
    }

    const assembler = new OpenAIStreamAssembler();
    const finalState = await this.runSseLoop(upstream.body, assembler, ctx);

    this.emitAgentDone(ctx, finalState.finishReason ?? null);
    await this.saveTokenUsage(ctx.groupId, finalState.usage?.totalTokens ?? 0);

    return {
      assistantText: finalState.content,
      assistantThinking: finalState.reasoningContent,
      toolCalls: (finalState.toolCalls ?? []) as ToolCall[],
      finishReason: finalState.finishReason ?? null,
    };
  }

  /* internal */ async callAnthropicStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { apiKey, baseUrl, model, backupModel, keyPool } = getAnthropicConfig();

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

    const tools = await getAgentTools(this.toolContext ?? undefined);

    // --- Anthropic Prompt Caching ---
    // Separate system messages from conversation, send as `system` param with cache_control.
    // Strategy: "system_and_3" — cache breakpoints on system prompt + last 3 messages.
    const systemMessages = history.filter((m) => m.role === "system");
    const chatMessages = history.filter((m) => m.role !== "system");

    // Build system parameter with cache_control (Anthropic API requirement)
    const systemParam = systemMessages.map((m) => ({
      type: "text" as const,
      text: typeof m.content === "string" ? m.content : String(m.content ?? ""),
      cache_control: { type: "ephemeral" as const },
    }));

    // Build messages array with cache_control on last 3 chat messages
    // Convert image_url (OpenAI format) to image (Anthropic format) for multimodal content
    const messages = chatMessages.map((msg, i) => {
      let content = msg.content;
      if (Array.isArray(content)) {
        content = (content as MultimodalContentPart[]).map((part) => {
          if (part.type === "image_url" && part.image_url?.url?.startsWith("data:")) {
            const url = part.image_url.url;
            const [header, data] = url.split(",");
            const mediaType = header.replace("data:", "").replace(";base64", "");
            return {
              type: "image" as const,
              source: { type: "base64" as const, media_type: mediaType, data },
            };
          }
          return part;
        }) as unknown as MultimodalContentPart[];
      }
      return {
        role: msg.role as "user" | "assistant",
        content,
        ...(i >= chatMessages.length - 3 ? { cache_control: { type: "ephemeral" as const } } : {}),
      };
    });

    const payload: Record<string, unknown> = {
      model,
      messages,
      max_tokens: 8192,
      stream: true,
    };
    if (systemParam.length > 0) {
      payload.system = systemParam;
    }
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
      "anthropic-beta": "prompt-caching-2024-07-31",
    };

    const upstream = await llmFetch(baseUrl, {
      method: "POST",
      headers,
      body: requestBody,
    }, "Anthropic", { backupModel, keyPool });

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

  /* internal */ async callGlmStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { apiKey, baseUrl, model, backupModel, keyPool } = getGlmConfig();

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
      tools: await getAgentTools(this.toolContext ?? undefined),
      tool_choice: "auto",
      stream: true,
      tool_stream: true,
    };
    const requestBody = JSON.stringify(glmPayload);
    void appendAgentLlmRequestRaw({ agentId: this.agentId, body: requestBody });

    const upstream = await llmFetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: requestBody,
    }, "GLM", { backupModel, keyPool });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      throw new Error(`GLM upstream error: ${upstream.status} ${text}`);
    }

    const assembler = new GLMStreamAssembler();
    const finalState = await this.runSseLoop(upstream.body, assembler, ctx);

    this.emitAgentDone(ctx, finalState.finishReason ?? null);
    await this.saveTokenUsage(ctx.groupId, finalState.usage?.totalTokens ?? 0);

    return {
      assistantText: finalState.content,
      assistantThinking: finalState.reasoningContent,
      toolCalls: (finalState.toolCalls ?? []) as ToolCall[],
      finishReason: finalState.finishReason ?? null,
    };
  }

  /* internal */ async callOllamaStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { baseUrl, model, backupModel } = getOllamaConfig();

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

    const tools = await getAgentTools(this.toolContext ?? undefined);
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

    const upstream = await llmFetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: requestBody,
    }, "Ollama", { backupModel });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      throw new Error(`Ollama upstream error: ${upstream.status} ${text}`);
    }

    const assembler = new OpenAIStreamAssembler();
    const finalState = await this.runSseLoop(upstream.body, assembler, ctx);

    this.emitAgentDone(ctx, finalState.finishReason ?? null);
    await this.saveTokenUsage(ctx.groupId, finalState.usage?.totalTokens ?? 0);

    return {
      assistantText: finalState.content,
      assistantThinking: finalState.reasoningContent,
      toolCalls: (finalState.toolCalls ?? []) as ToolCall[],
      finishReason: finalState.finishReason ?? null,
    };
  }

  /* internal */ async callFreellmapiStreaming(
    history: HistoryMessage[],
    ctx: { workspaceId: UUID; groupId: UUID; round: number }
  ) {
    const { baseUrl, apiKey, model, keyPool } = getFreellmapiConfig();

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

    const tools = await getAgentTools(this.toolContext ?? undefined);
    const payload: Record<string, unknown> = {
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

    const requestBody = JSON.stringify(payload);
    void appendAgentLlmRequestRaw({ agentId: this.agentId, body: requestBody });

    const upstream = await llmFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: requestBody,
    }, "FreeLLMAPI", { keyPool });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      throw new Error(`FreeLLMAPI upstream error: ${upstream.status} ${text}`);
    }

    const assembler = new OpenAIStreamAssembler();
    const finalState = await this.runSseLoop(upstream.body, assembler, ctx);

    this.emitAgentDone(ctx, finalState.finishReason ?? null);
    await this.saveTokenUsage(ctx.groupId, finalState.usage?.totalTokens ?? 0);

    return {
      assistantText: finalState.content,
      assistantThinking: finalState.reasoningContent,
      toolCalls: (finalState.toolCalls ?? []) as ToolCall[],
      finishReason: finalState.finishReason ?? null,
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
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  static readonly VERSION = 3;
  private static readonly RUNNER_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 min idle timeout
  private static readonly CLEANUP_INTERVAL_MS = 60 * 1000; // 1 min cleanup interval

  async bootstrap(workspaceId?: UUID) {
    if (this.bootstrapped) return;
    this.bootstrapped = true;

    // Start periodic cleanup timer
    this.startCleanupTimer();

    const agents = workspaceId
      ? await store.listAgents({ workspaceId })
      : await store.listAgents();
    for (const a of agents) {
      if (a.role === "human") continue;
      this.ensureRunner(a.id);
    }
  }

  private startCleanupTimer() {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleRunners();
    }, AgentRuntime.CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref(); // Don't keep process alive
  }

  private cleanupIdleRunners() {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, runner] of this.runners) {
      if (runner.isIdleTooLong(AgentRuntime.RUNNER_IDLE_TIMEOUT_MS)) {
        this.stopRunner(id);
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.info(`[AgentRuntime] Cleaned up ${cleaned} idle runners, ${this.runners.size} remaining`);
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

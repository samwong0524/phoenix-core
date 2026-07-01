import { getGlmKeyPool, getFreellmapiKeyPool, getOpenrouterKeyPool, getAnthropicKeyPool } from "./agent-keys";
import { getRuntimeSetting } from "./agent-helpers";
import { getSetting } from "@/lib/settings";
import type { AgentRunner } from "./agent-runtime";
import type { HistoryMessage, ToolCall, UUID } from "./agent-types";

export function getGlmConfig() {
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


// Ensure llama-server (Qwen3.6) doesn't reject requests missing a user role.
// Qwen3.6's Jinja template requires at least one user message, and prefers
// the last message to be from user. This patch handles three cases:
// 1. Empty history → inject a dummy user message.
// 2. No user role at all → append a dummy user message.
// 3. Last message is assistant → append a dummy user message.
export function ensureUserMessage(messages: any[]): any[] {
  const hasUser = messages.some((m: any) => m.role === "user");
  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role === "assistant";

  if (messages.length === 0) {
    console.log("[ensureUserMessage] Empty history, injecting user message");
    return [{ role: "user", content: "Hi" }];
  }
  if (!hasUser) {
    console.log("[ensureUserMessage] No user message, appending dummy user");
    return [...messages, { role: "user", content: "." }];
  }
  if (lastIsAssistant) {
    console.log("[ensureUserMessage] Last message is assistant, appending user prompt");
    return [...messages, { role: "user", content: "." }];
  }
  return messages;
}

export function getFreellmapiConfig() {
  const pool = getFreellmapiKeyPool();
  const apiKey = pool.getNext() ?? "";
  // Read from env first, then persistent settings (set via /models UI), then default
  const baseUrl = (process.env.FREELLMAPI_URL ?? getSetting("llm_base_url") ?? "http://127.0.0.1:3001/v1").replace(/\/+$/, "");
  // Runtime model switching: check runtime setting first, then env, then persistent, then "auto".
  const model = getRuntimeSetting("freellmapi_model") ?? process.env.FREELLMAPI_MODEL ?? getSetting("llm_model") ?? "auto";
  // Allow empty API key for local llama.cpp / local servers
  const isLocal = baseUrl.includes("127.0.0.1") || baseUrl.includes("localhost");
  if (!apiKey && !isLocal) {
    throw new Error("Missing FreeLLMAPI API key (set FREELLMAPI_API_KEY or FREELLMAPI_API_KEYS)");
  }
 return { baseUrl, apiKey, model, keyPool: pool };
}

export type LlmProvider = "glm" | "openrouter" | "ollama" | "anthropic" | "freellmapi";

export function getLlmProvider(): LlmProvider {
  const raw = (process.env.LLM_PROVIDER ?? getSetting("llm_provider") ?? "glm").toLowerCase();
  if (raw === "openrouter" || raw === "open-router" || raw === "or") return "openrouter";
  if (raw === "anthropic" || raw === "anthropic-compatible") return "anthropic";
  if (raw === "ollama" || raw === "o" || raw === "local") return "ollama";
  if (raw === "freellmapi" || raw === "free" || raw === "freellm") return "freellmapi";
  return "glm";
}

/** Returns whether each LLM provider has the required env vars configured. */
export function isProviderConfigured(provider: LlmProvider): boolean {
  switch (provider) {
    case "openrouter": return !!(process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEYS);
    case "anthropic": return !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEYS);
    case "glm": return !!(process.env.GLM_API_KEY || process.env.ZHIPUAI_API_KEY || process.env.GLM_API_KEYS);
    case "ollama": return true; // local, always available
    case "freellmapi": {
      const url = process.env.FREELLMAPI_URL ?? getSetting("llm_base_url") ?? "";
      const isLocal = url.includes("127.0.0.1") || url.includes("localhost");
      const hasKey = !!(process.env.FREELLMAPI_API_KEY || process.env.FREELLMAPI_API_KEYS || getSetting("llm_api_key"));
      return isLocal || hasKey;
    }
  }
}

/**
 * Returns the ordered provider chain for LLM calls.
 * Primary = LLM_PROVIDER env var (or "glm" default).
 * Fallbacks = other providers with configured API keys, tried in order after the primary fails with 429.
 * LLM_FALLBACK_PROVIDERS env var can override the fallback order (comma-separated).
 */
export function getProviderChain(): LlmProvider[] {
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
// RuntimeProvider abstraction 鈥?replace switch with registry (Sprint 2).
// Adding a new provider: add config function + method + registry entry.
// ---------------------------------------------------------------------------
export type StreamContext = { workspaceId: UUID; groupId: UUID; round: number };

export interface LlmStreamResult {
  assistantText: string;
  assistantThinking: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

// Keyed by LlmProvider (string) for extensibility 鈥?no switch needed.
export const PROVIDER_REGISTRY: Record<string, (self: AgentRunner, history: HistoryMessage[], ctx: StreamContext) => Promise<LlmStreamResult>> = {
  openrouter: (self, h, ctx) => self.callOpenRouterStreaming(h, ctx),
  anthropic: (self, h, ctx) => self.callAnthropicStreaming(h, ctx),
  glm: (self, h, ctx) => self.callGlmStreaming(h, ctx),
  ollama: (self, h, ctx) => self.callOllamaStreaming(h, ctx),
  freellmapi: (self, h, ctx) => self.callFreellmapiStreaming(ensureUserMessage(h), ctx),
};

export function getProviderHandler(provider: string) {
  return PROVIDER_REGISTRY[provider] ?? null;
}

export function normalizeOpenRouterUrl(value: string) {
  if (!value) return "https://openrouter.ai/api/v1/chat/completions";
  if (value.endsWith("/chat/completions")) return value;
  if (value.endsWith("/api/v1")) return `${value}/chat/completions`;
  if (value.endsWith("/v1")) return `${value}/chat/completions`;
  return value;
}

export function getOpenRouterConfig() {
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

export function getAnthropicConfig() {
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

export function getOllamaConfig() {
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


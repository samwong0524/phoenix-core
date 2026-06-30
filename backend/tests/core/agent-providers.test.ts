import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGlmPool = { getNext: vi.fn(), hasKeys: vi.fn(() => true), size: vi.fn(() => 1), hasAvailable: vi.fn(() => true), mark429: vi.fn() };
const mockFreellmapiPool = { getNext: vi.fn(), hasKeys: vi.fn(() => true), size: vi.fn(() => 1), hasAvailable: vi.fn(() => true), mark429: vi.fn() };
const mockOpenrouterPool = { getNext: vi.fn(), hasKeys: vi.fn(() => true), size: vi.fn(() => 1), hasAvailable: vi.fn(() => true), mark429: vi.fn() };
const mockAnthropicPool = { getNext: vi.fn(), hasKeys: vi.fn(() => true), size: vi.fn(() => 1), hasAvailable: vi.fn(() => true), mark429: vi.fn() };

vi.mock("@/runtime/agent-keys", () => ({
  getGlmKeyPool: () => mockGlmPool,
  getFreellmapiKeyPool: () => mockFreellmapiPool,
  getOpenrouterKeyPool: () => mockOpenrouterPool,
  getAnthropicKeyPool: () => mockAnthropicPool,
}));

const mockGetRuntimeSetting = vi.fn(() => undefined);
vi.mock("@/runtime/agent-helpers", () => ({
  getRuntimeSetting: (key: string) => mockGetRuntimeSetting(key),
}));

const mockGetSetting = vi.fn(() => undefined);
vi.mock("@/lib/settings", () => ({
  getSetting: (key: string) => mockGetSetting(key),
}));

import {
  getLlmProvider,
  isProviderConfigured,
  getProviderChain,
  ensureUserMessage,
  normalizeOpenRouterUrl,
  getGlmConfig,
  getFreellmapiConfig,
  getOpenRouterConfig,
  getAnthropicConfig,
  getOllamaConfig,
} from "@/runtime/agent-providers";
import type { LlmProvider } from "@/runtime/agent-providers";

// ─── Setup ───────────────────────────────────────────────────────────────────

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnv };
  // Set default pool returns
  mockGlmPool.getNext.mockReturnValue("glm-test-key");
  mockFreellmapiPool.getNext.mockReturnValue("freellmapi-test-key");
  mockOpenrouterPool.getNext.mockReturnValue("openrouter-test-key");
  mockAnthropicPool.getNext.mockReturnValue("anthropic-test-key");
});

afterEach(() => {
  process.env = originalEnv;
});

// ─── getLlmProvider ──────────────────────────────────────────────────────────

describe("getLlmProvider", () => {
  it('returns "glm" by default', () => {
    delete process.env.LLM_PROVIDER;
    mockGetSetting.mockReturnValue(undefined);
    expect(getLlmProvider()).toBe("glm");
  });

  it('returns "openrouter" for "openrouter"', () => {
    process.env.LLM_PROVIDER = "openrouter";
    expect(getLlmProvider()).toBe("openrouter");
  });

  it('returns "openrouter" for "open-router"', () => {
    process.env.LLM_PROVIDER = "open-router";
    expect(getLlmProvider()).toBe("openrouter");
  });

  it('returns "openrouter" for "or"', () => {
    process.env.LLM_PROVIDER = "or";
    expect(getLlmProvider()).toBe("openrouter");
  });

  it('returns "anthropic" for "anthropic"', () => {
    process.env.LLM_PROVIDER = "anthropic";
    expect(getLlmProvider()).toBe("anthropic");
  });

  it('returns "anthropic" for "anthropic-compatible"', () => {
    process.env.LLM_PROVIDER = "anthropic-compatible";
    expect(getLlmProvider()).toBe("anthropic");
  });

  it('returns "ollama" for "ollama"', () => {
    process.env.LLM_PROVIDER = "ollama";
    expect(getLlmProvider()).toBe("ollama");
  });

  it('returns "ollama" for "o"', () => {
    process.env.LLM_PROVIDER = "o";
    expect(getLlmProvider()).toBe("ollama");
  });

  it('returns "ollama" for "local"', () => {
    process.env.LLM_PROVIDER = "local";
    expect(getLlmProvider()).toBe("ollama");
  });

  it('returns "freellmapi" for "freellmapi"', () => {
    process.env.LLM_PROVIDER = "freellmapi";
    expect(getLlmProvider()).toBe("freellmapi");
  });

  it('returns "freellmapi" for "free"', () => {
    process.env.LLM_PROVIDER = "free";
    expect(getLlmProvider()).toBe("freellmapi");
  });

  it('returns "freellmapi" for "freellm"', () => {
    process.env.LLM_PROVIDER = "freellm";
    expect(getLlmProvider()).toBe("freellmapi");
  });

  it("is case-insensitive", () => {
    process.env.LLM_PROVIDER = "OpenRouter";
    expect(getLlmProvider()).toBe("openrouter");
  });

  it("falls back to getSetting when env not set", () => {
    delete process.env.LLM_PROVIDER;
    mockGetSetting.mockReturnValue("ollama");
    expect(getLlmProvider()).toBe("ollama");
  });
});

// ─── isProviderConfigured ────────────────────────────────────────────────────

describe("isProviderConfigured", () => {
  it("openrouter: true when OPENROUTER_API_KEY set", () => {
    process.env.OPENROUTER_API_KEY = "key";
    expect(isProviderConfigured("openrouter")).toBe(true);
  });

  it("openrouter: true when OPENROUTER_API_KEYS set", () => {
    process.env.OPENROUTER_API_KEYS = "key1,key2";
    expect(isProviderConfigured("openrouter")).toBe(true);
  });

  it("openrouter: false when no key", () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEYS;
    expect(isProviderConfigured("openrouter")).toBe(false);
  });

  it("anthropic: true when ANTHROPIC_API_KEY set", () => {
    process.env.ANTHROPIC_API_KEY = "key";
    expect(isProviderConfigured("anthropic")).toBe(true);
  });

  it("anthropic: false when no key", () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEYS;
    expect(isProviderConfigured("anthropic")).toBe(false);
  });

  it("glm: true when GLM_API_KEY set", () => {
    process.env.GLM_API_KEY = "key";
    expect(isProviderConfigured("glm")).toBe(true);
  });

  it("glm: true when ZHIPUAI_API_KEY set", () => {
    delete process.env.GLM_API_KEY;
    delete process.env.GLM_API_KEYS;
    process.env.ZHIPUAI_API_KEY = "key";
    expect(isProviderConfigured("glm")).toBe(true);
  });

  it("glm: false when no key", () => {
    delete process.env.GLM_API_KEY;
    delete process.env.GLM_API_KEYS;
    delete process.env.ZHIPUAI_API_KEY;
    expect(isProviderConfigured("glm")).toBe(false);
  });

  it("ollama: always true", () => {
    expect(isProviderConfigured("ollama")).toBe(true);
  });

  it("freellmapi: true for local URL even without key", () => {
    process.env.FREELLMAPI_URL = "http://127.0.0.1:3001/v1";
    delete process.env.FREELLMAPI_API_KEY;
    delete process.env.FREELLMAPI_API_KEYS;
    mockGetSetting.mockReturnValue(undefined);
    expect(isProviderConfigured("freellmapi")).toBe(true);
  });

  it("freellmapi: true when key set for remote URL", () => {
    process.env.FREELLMAPI_URL = "https://remote.api.com/v1";
    process.env.FREELLMAPI_API_KEY = "key";
    expect(isProviderConfigured("freellmapi")).toBe(true);
  });

  it("freellmapi: false for remote URL without key", () => {
    process.env.FREELLMAPI_URL = "https://remote.api.com/v1";
    delete process.env.FREELLMAPI_API_KEY;
    delete process.env.FREELLMAPI_API_KEYS;
    mockGetSetting.mockReturnValue(undefined);
    expect(isProviderConfigured("freellmapi")).toBe(false);
  });
});

// ─── getProviderChain ────────────────────────────────────────────────────────

describe("getProviderChain", () => {
  it("returns primary provider as first element", () => {
    process.env.LLM_PROVIDER = "glm";
    const chain = getProviderChain();
    expect(chain[0]).toBe("glm");
  });

  it("includes ollama as fallback (always configured)", () => {
    process.env.LLM_PROVIDER = "glm";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEYS;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEYS;
    delete process.env.FREELLMAPI_URL;
    delete process.env.FREELLMAPI_API_KEY;
    delete process.env.FREELLMAPI_API_KEYS;
    mockGetSetting.mockReturnValue(undefined);
    const chain = getProviderChain();
    expect(chain).toContain("ollama");
  });

  it("does not duplicate primary in fallbacks", () => {
    process.env.LLM_PROVIDER = "ollama";
    const chain = getProviderChain();
    const ollamaCount = chain.filter(p => p === "ollama").length;
    expect(ollamaCount).toBe(1);
  });

  it("respects LLM_FALLBACK_PROVIDERS override", () => {
    process.env.LLM_PROVIDER = "glm";
    process.env.LLM_FALLBACK_PROVIDERS = "ollama,openrouter";
    process.env.OPENROUTER_API_KEY = "key";
    const chain = getProviderChain();
    expect(chain).toEqual(["glm", "ollama", "openrouter"]);
  });

  it("skips unconfigured providers in fallback override", () => {
    process.env.LLM_PROVIDER = "glm";
    process.env.LLM_FALLBACK_PROVIDERS = "openrouter,ollama";
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEYS;
    const chain = getProviderChain();
    expect(chain).not.toContain("openrouter");
    expect(chain).toContain("ollama");
  });
});

// ─── ensureUserMessage ───────────────────────────────────────────────────────

describe("ensureUserMessage", () => {
  it("injects user message for empty history", () => {
    const result = ensureUserMessage([]);
    expect(result.length).toBe(1);
    expect(result[0].role).toBe("user");
    expect(result[0].content).toBe("Hi");
  });

  it("appends user message when no user role exists", () => {
    const messages = [
      { role: "system", content: "You are helpful" },
      { role: "assistant", content: "Hello" },
    ];
    const result = ensureUserMessage(messages);
    expect(result.length).toBe(3);
    expect(result[result.length - 1].role).toBe("user");
  });

  it("appends user message when last message is assistant", () => {
    const messages = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ];
    const result = ensureUserMessage(messages);
    expect(result.length).toBe(3);
    expect(result[result.length - 1].role).toBe("user");
  });

  it("returns messages unchanged when last message is user", () => {
    const messages = [
      { role: "assistant", content: "Hello" },
      { role: "user", content: "How are you?" },
    ];
    const result = ensureUserMessage(messages);
    expect(result).toEqual(messages);
  });

  it("does not mutate original array", () => {
    const messages = [{ role: "system", content: "sys" }];
    const result = ensureUserMessage(messages);
    expect(result).not.toBe(messages);
    expect(messages.length).toBe(1);
  });
});

// ─── normalizeOpenRouterUrl ──────────────────────────────────────────────────

describe("normalizeOpenRouterUrl", () => {
  it("returns default URL for empty string", () => {
    expect(normalizeOpenRouterUrl("")).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("returns URL unchanged if it already ends with /chat/completions", () => {
    const url = "https://example.com/api/v1/chat/completions";
    expect(normalizeOpenRouterUrl(url)).toBe(url);
  });

  it("appends /chat/completions to URL ending with /api/v1", () => {
    expect(normalizeOpenRouterUrl("https://example.com/api/v1")).toBe("https://example.com/api/v1/chat/completions");
  });

  it("appends /chat/completions to URL ending with /v1", () => {
    expect(normalizeOpenRouterUrl("https://example.com/v1")).toBe("https://example.com/v1/chat/completions");
  });

  it("returns URL unchanged if no pattern matches", () => {
    const url = "https://example.com/custom/endpoint";
    expect(normalizeOpenRouterUrl(url)).toBe(url);
  });
});

// ─── getGlmConfig ────────────────────────────────────────────────────────────

describe("getGlmConfig", () => {
  it("returns config with defaults", () => {
    delete process.env.GLM_BASE_URL;
    delete process.env.GLM_MODEL;
    delete process.env.GLM_BACKUP_MODEL;
    const config = getGlmConfig();
    expect(config.baseUrl).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    expect(config.model).toBe("glm-4.7");
    expect(config.backupModel).toBe("");
    expect(config.apiKey).toBe("glm-test-key");
  });

  it("uses env overrides", () => {
    process.env.GLM_BASE_URL = "https://custom.glm.com/v4";
    process.env.GLM_MODEL = "glm-5";
    process.env.GLM_BACKUP_MODEL = "glm-4";
    const config = getGlmConfig();
    expect(config.baseUrl).toBe("https://custom.glm.com/v4");
    expect(config.model).toBe("glm-5");
    expect(config.backupModel).toBe("glm-4");
  });

  it("throws when API key is empty", () => {
    mockGlmPool.getNext.mockReturnValue(null);
    expect(() => getGlmConfig()).toThrow("Missing GLM API key");
  });
});

// ─── getOpenRouterConfig ─────────────────────────────────────────────────────

describe("getOpenRouterConfig", () => {
  it("returns config with defaults", () => {
    delete process.env.OPENROUTER_BASE_URL;
    delete process.env.OPENROUTER_MODEL;
    delete process.env.OPENROUTER_BACKUP_MODEL;
    delete process.env.OPENROUTER_HTTP_REFERER;
    delete process.env.OPENROUTER_APP_TITLE;
    const config = getOpenRouterConfig();
    expect(config.baseUrl).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(config.model).toBe("");
    expect(config.apiKey).toBe("openrouter-test-key");
  });

  it("throws when API key is empty", () => {
    mockOpenrouterPool.getNext.mockReturnValue(null);
    expect(() => getOpenRouterConfig()).toThrow("Missing OPENROUTER_API_KEY");
  });

  it("uses env overrides", () => {
    process.env.OPENROUTER_MODEL = "gpt-4";
    process.env.OPENROUTER_BACKUP_MODEL = "gpt-3.5";
    process.env.OPENROUTER_HTTP_REFERER = "https://myapp.com";
    process.env.OPENROUTER_APP_TITLE = "MyApp";
    const config = getOpenRouterConfig();
    expect(config.model).toBe("gpt-4");
    expect(config.backupModel).toBe("gpt-3.5");
    expect(config.httpReferer).toBe("https://myapp.com");
    expect(config.appTitle).toBe("MyApp");
  });
});

// ─── getAnthropicConfig ──────────────────────────────────────────────────────

describe("getAnthropicConfig", () => {
  it("returns config with defaults", () => {
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_MODEL;
    delete process.env.ANTHROPIC_BACKUP_MODEL;
    const config = getAnthropicConfig();
    expect(config.baseUrl).toBe("");
    expect(config.model).toBe("qwen3.6-plus");
    expect(config.backupModel).toBe("");
    expect(config.apiKey).toBe("anthropic-test-key");
  });

  it("throws when API key is empty", () => {
    mockAnthropicPool.getNext.mockReturnValue(null);
    expect(() => getAnthropicConfig()).toThrow("Missing ANTHROPIC_API_KEY");
  });
});

// ─── getOllamaConfig ─────────────────────────────────────────────────────────

describe("getOllamaConfig", () => {
  it("returns config with defaults", () => {
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_MODEL;
    delete process.env.OLLAMA_BACKUP_MODEL;
    const config = getOllamaConfig();
    expect(config.baseUrl).toBe("http://localhost:11434/v1/chat/completions");
    expect(config.model).toBe("qwen3:8b");
    expect(config.backupModel).toBe("");
  });

  it("uses env overrides", () => {
    process.env.OLLAMA_BASE_URL = "http://custom:11434/v1";
    process.env.OLLAMA_MODEL = "llama3";
    process.env.OLLAMA_BACKUP_MODEL = "llama2";
    const config = getOllamaConfig();
    expect(config.baseUrl).toBe("http://custom:11434/v1/chat/completions");
    expect(config.model).toBe("llama3");
    expect(config.backupModel).toBe("llama2");
  });
});

// ─── getFreellmapiConfig ─────────────────────────────────────────────────────

describe("getFreellmapiConfig", () => {
  it("returns config for local URL without requiring key", () => {
    process.env.FREELLMAPI_URL = "http://127.0.0.1:3001/v1";
    delete process.env.FREELLMAPI_MODEL;
    mockGetRuntimeSetting.mockReturnValue(undefined);
    mockGetSetting.mockReturnValue(undefined);
    mockFreellmapiPool.getNext.mockReturnValue("");
    const config = getFreellmapiConfig();
    expect(config.baseUrl).toBe("http://127.0.0.1:3001/v1");
    expect(config.model).toBe("auto");
  });

  it("throws for remote URL without key", () => {
    process.env.FREELLMAPI_URL = "https://remote.api.com/v1";
    mockFreellmapiPool.getNext.mockReturnValue("");
    mockGetRuntimeSetting.mockReturnValue(undefined);
    mockGetSetting.mockReturnValue(undefined);
    expect(() => getFreellmapiConfig()).toThrow("Missing FreeLLMAPI API key");
  });

  it("strips trailing slashes from baseUrl", () => {
    process.env.FREELLMAPI_URL = "http://127.0.0.1:3001/v1///";
    mockGetRuntimeSetting.mockReturnValue(undefined);
    mockGetSetting.mockReturnValue(undefined);
    const config = getFreellmapiConfig();
    expect(config.baseUrl).toBe("http://127.0.0.1:3001/v1");
  });

  it("uses runtime setting for model when available", () => {
    process.env.FREELLMAPI_URL = "http://127.0.0.1:3001/v1";
    mockGetRuntimeSetting.mockReturnValue("custom-model");
    mockGetSetting.mockReturnValue(undefined);
    const config = getFreellmapiConfig();
    expect(config.model).toBe("custom-model");
  });
});

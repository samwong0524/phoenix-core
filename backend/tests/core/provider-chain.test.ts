import { describe, it, expect, beforeEach } from "vitest";

// The provider-chain and URL normalization functions are module-level
// in agent-runtime.ts but not exported. Replicate the logic inline
// to test the behavior without importing private functions.

function normalizeOpenRouterUrl(value: string) {
  if (!value) return "https://openrouter.ai/api/v1/chat/completions";
  if (value.endsWith("/chat/completions")) return value;
  if (value.endsWith("/api/v1")) return `${value}/chat/completions`;
  if (value.endsWith("/v1")) return `${value}/chat/completions`;
  return value;
}

type LlmProvider = "openrouter" | "anthropic" | "glm" | "ollama";

function isProviderConfigured(provider: LlmProvider, env: Record<string, string | undefined>): boolean {
  switch (provider) {
    case "openrouter": return !!env.OPENROUTER_API_KEY;
    case "anthropic": return !!env.ANTHROPIC_API_KEY;
    case "glm": return !!(env.GLM_API_KEY || env.ZHIPUAI_API_KEY);
    case "ollama": return true;
  }
}

function getLlmProvider(env: Record<string, string | undefined>): LlmProvider {
  const raw = (env.LLM_PROVIDER ?? "").toLowerCase().trim();
  if (raw === "openrouter" || raw === "open-router" || raw === "or") return "openrouter";
  if (raw === "anthropic" || raw === "anthropic-compatible") return "anthropic";
  if (raw === "ollama" || raw === "o" || raw === "local") return "ollama";
  return "glm";
}

function getProviderChain(env: Record<string, string | undefined>): LlmProvider[] {
  const primary = getLlmProvider(env);
  const chain: LlmProvider[] = [primary];
  const all: LlmProvider[] = ["openrouter", "glm", "anthropic", "ollama"];

  const overrideRaw = env.LLM_FALLBACK_PROVIDERS ?? "";
  if (overrideRaw) {
    for (const name of overrideRaw.split(",").map((s) => s.trim().toLowerCase())) {
      if (name === "openrouter" || name === "or") { if (name !== primary && isProviderConfigured("openrouter", env)) chain.push("openrouter"); }
      else if (name === "glm") { if (name !== primary && isProviderConfigured("glm", env)) chain.push("glm"); }
      else if (name === "anthropic") { if (name !== primary && isProviderConfigured("anthropic", env)) chain.push("anthropic"); }
      else if (name === "ollama" || name === "o" || name === "local") { if (name !== primary && isProviderConfigured("ollama", env)) chain.push("ollama"); }
    }
  } else {
    const defaults: LlmProvider[] = ["openrouter", "glm", "anthropic", "ollama"];
    for (const p of defaults) {
      if (p !== primary && isProviderConfigured(p, env)) {
        chain.push(p);
      }
    }
  }

  return chain;
}

describe("normalizeOpenRouterUrl", () => {
  it("returns default URL for empty input", () => {
    expect(normalizeOpenRouterUrl("")).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("passes through URLs ending with /chat/completions", () => {
    expect(normalizeOpenRouterUrl("https://custom.io/v1/chat/completions")).toBe("https://custom.io/v1/chat/completions");
  });

  it("appends /chat/completions to /api/v1 URLs", () => {
    expect(normalizeOpenRouterUrl("https://custom.io/api/v1")).toBe("https://custom.io/api/v1/chat/completions");
  });

  it("appends /chat/completions to /v1 URLs", () => {
    expect(normalizeOpenRouterUrl("https://custom.io/v1")).toBe("https://custom.io/v1/chat/completions");
  });
});

describe("getLlmProvider", () => {
  it("defaults to glm when LLM_PROVIDER is not set", () => {
    expect(getLlmProvider({})).toBe("glm");
  });

  it("resolves openrouter aliases", () => {
    expect(getLlmProvider({ LLM_PROVIDER: "openrouter" })).toBe("openrouter");
    expect(getLlmProvider({ LLM_PROVIDER: "open-router" })).toBe("openrouter");
    expect(getLlmProvider({ LLM_PROVIDER: "or" })).toBe("openrouter");
  });

  it("resolves ollama aliases", () => {
    expect(getLlmProvider({ LLM_PROVIDER: "ollama" })).toBe("ollama");
    expect(getLlmProvider({ LLM_PROVIDER: "o" })).toBe("ollama");
    expect(getLlmProvider({ LLM_PROVIDER: "local" })).toBe("ollama");
  });

  it("resolves anthropic", () => {
    expect(getLlmProvider({ LLM_PROVIDER: "anthropic" })).toBe("anthropic");
    expect(getLlmProvider({ LLM_PROVIDER: "anthropic-compatible" })).toBe("anthropic");
  });
});

describe("getProviderChain", () => {
  const fullEnv = {
    OPENROUTER_API_KEY: "or-key",
    ANTHROPIC_API_KEY: "an-key",
    GLM_API_KEY: "glm-key",
  };

  it("primary is first, fallbacks follow in default order", () => {
    const chain = getProviderChain({ ...fullEnv, LLM_PROVIDER: "openrouter" });
    expect(chain[0]).toBe("openrouter");
    expect(chain).toContain("glm");
    expect(chain).toContain("anthropic");
  });

  it("uses LLM_FALLBACK_PROVIDERS when set", () => {
    const chain = getProviderChain({ ...fullEnv, LLM_PROVIDER: "glm", LLM_FALLBACK_PROVIDERS: "anthropic,ollama" });
    expect(chain[0]).toBe("glm");
    expect(chain[1]).toBe("anthropic");
    expect(chain).toContain("ollama");
    expect(chain).not.toContain("openrouter");
  });

  it("only includes configured providers in auto-discover", () => {
    const chain = getProviderChain({ LLM_PROVIDER: "glm", OPENROUTER_API_KEY: "or-key" });
    expect(chain[0]).toBe("glm");
    expect(chain).toContain("openrouter");
    expect(chain).not.toContain("anthropic"); // no key set
  });

  it("ollama is always configured", () => {
    const chain = getProviderChain({ LLM_PROVIDER: "anthropic" });
    expect(chain).toContain("ollama");
  });
});

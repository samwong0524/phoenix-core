import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SETTINGS_PATH = join(process.cwd(), "config", "runtime-settings.json");

let cached: Record<string, string> | null = null;

function load(): Record<string, string> {
  if (cached) return cached;
  try {
    if (existsSync(SETTINGS_PATH)) {
      cached = JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
    } else {
      cached = {};
    }
  } catch {
    cached = {};
  }
  return cached ?? {};
}

function save() {
  const dir = join(process.cwd(), "config");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(cached, null, 2), "utf-8");
}

/**
 * Settings priority: env var > JSON file > undefined
 *
 * The JSON file (config/runtime-settings.json) is a local-only fallback.
 * Environment variables (.env) always take precedence to avoid secrets
 * being stored in plaintext files that could be accidentally committed.
 */
export function getSetting(key: string): string | undefined {
  // Map setting keys to their corresponding env var names
  const ENV_MAP: Record<string, string> = {
    llm_provider: "LLM_PROVIDER",
    llm_base_url: "LLM_BASE_URL",
    llm_api_key: "LLM_API_KEY",
    llm_model: "LLM_MODEL",
  };
  const envKey = ENV_MAP[key];
  if (envKey && process.env[envKey]) return process.env[envKey];
  return load()[key];
}

export function setSetting(key: string, value: string) {
  load()[key] = value;
  save();
}

export function getAllSettings(): Record<string, string> {
  return { ...load() };
}

export function resetSettingsCache() {
  cached = null;
}

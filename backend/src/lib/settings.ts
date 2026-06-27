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

export function getSetting(key: string): string | undefined {
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

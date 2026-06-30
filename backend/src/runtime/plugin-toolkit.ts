import { promises as fs } from "node:fs";
import path from "node:path";
import { getSkillDirectory } from "./skill-loader";

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  skills?: string[];       // skill names this plugin provides
  tools?: string[];        // tool names this plugin provides
  hooks?: {
    onLoad?: string;       // script to run when plugin loads
    onUnload?: string;     // script to run when plugin unloads
  };
  dependencies?: string[]; // other plugin names
  metadata?: Record<string, unknown>;
}

const PLUGIN_FILE = "plugin.json";

export async function discoverPlugins(): Promise<Map<string, PluginManifest>> {
  const skillsDir = getSkillDirectory();
  if (!skillsDir) return new Map();

  const plugins = new Map<string, PluginManifest>();

  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginPath = path.join(skillsDir, entry.name, PLUGIN_FILE);
      try {
        const content = await fs.readFile(pluginPath, "utf-8");
        const manifest: PluginManifest = JSON.parse(content);
        if (manifest.name && manifest.version) {
          plugins.set(manifest.name, manifest);
        }
      } catch {
        // No plugin.json in this directory, skip
      }
    }
  } catch {
    // Skills dir doesn't exist or can't be read
  }

  return plugins;
}

export async function getPluginManifest(skillDir: string): Promise<PluginManifest | null> {
  try {
    const content = await fs.readFile(path.join(skillDir, PLUGIN_FILE), "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

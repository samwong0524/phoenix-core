import { watch, type FSWatcher } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { invalidateSkillCache, getSkillDirectory } from "./skill-loader";

let watcher: FSWatcher | null = null;
let debounceTimer: NodeJS.Timeout | null = null;
let watching = false;

export function startSkillWatcher(): void {
  if (watching) return;

  const skillsDir = getSkillDirectory();
  if (!skillsDir || !existsSync(skillsDir)) {
    console.log("[skill-watcher] Skills directory not found, skipping watcher");
    return;
  }

  try {
    watcher = watch(skillsDir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      // Only react to SKILL.md changes
      if (!filename.endsWith("SKILL.md") && !filename.endsWith("plugin.json")) return;

      // Debounce: batch rapid changes into a single invalidation
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log(`[skill-watcher] Detected change: ${filename}, invalidating skill cache`);
        invalidateSkillCache();
        debounceTimer = null;
      }, 300);
    });

    watcher.on("error", (err) => {
      console.warn("[skill-watcher] Watcher error:", err.message);
    });

    watching = true;
    console.log(`[skill-watcher] Watching ${skillsDir} for skill changes`);
  } catch (err) {
    console.warn("[skill-watcher] Failed to start watcher:", err);
  }
}

export function stopSkillWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  watching = false;
}

export function isSkillWatcherRunning(): boolean {
  return watching;
}

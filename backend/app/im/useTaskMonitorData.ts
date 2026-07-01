import { useMemo } from "react";
import { useIMStore } from "./store";

export interface TodoItem {
  status: "completed" | "in_progress" | "pending" | "cancelled";
  content: string;
}

export interface ArtifactItem {
  path: string;
  type: "text" | "binary" | "directory";
}

export interface SkillItem {
  name: string;
  type: "skill" | "mcp";
}

export interface TaskMonitorData {
  todoItems: TodoItem[];
  artifacts: ArtifactItem[];
  usedSkills: SkillItem[];
}

// Phoenix-Core task status → TodoItem status mapping
const TASK_STATUS_MAP: Record<string, TodoItem["status"]> = {
  done: "completed",
  approved: "completed",
  failed: "completed",
  rejected: "completed",
  in_progress: "in_progress",
  review: "in_progress",
  blocked: "pending",
};

/** Parse llmHistory JSON → structured data for TaskMonitor panels. */
export function useTaskMonitorData(): TaskMonitorData {
  const llmHistory = useIMStore((s) => s.llmHistory);

  return useMemo(() => {
    const todoMap = new Map<string, TodoItem>();
    const artifactSet = new Map<string, "text" | "binary" | "directory">();
    const skillSet = new Map<string, "skill" | "mcp">();

    type Entry = {
      role?: string;
      tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
    };

    let entries: Entry[] = [];
    try {
      entries = JSON.parse(llmHistory || "[]");
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (entry?.role !== "assistant" || !Array.isArray(entry.tool_calls)) continue;
      for (const call of entry.tool_calls) {
        const fnName: string = call?.function?.name ?? "";
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call?.function?.arguments ?? "{}");
        } catch {
          /* ignore parse errors */
        }

        // ── Todo: update_task (workflow task status tracking) ──
        if (fnName === "update_task" && typeof args.taskId === "string") {
          const rawStatus = (args.status as string) ?? "pending";
          const status = TASK_STATUS_MAP[rawStatus] ?? "pending";
          const content = typeof args.result === "string" && args.result
            ? `${args.taskId}: ${args.result}`
            : args.taskId;
          todoMap.set(args.taskId, { status, content });
        }

        // ── Todo: todo_write (agent self-tracked todo list) ──
        // Each call replaces the entire todo list with the latest snapshot.
        if (fnName === "todo_write" && Array.isArray(args.todos)) {
          todoMap.clear();
          const validStatuses = new Set(["pending", "in_progress", "completed", "cancelled"]);
          for (const [idx, item] of (args.todos as Array<Record<string, unknown>>).entries()) {
            const desc = typeof item.description === "string" ? item.description.trim() : "";
            if (!desc) continue;
            const rawStatus = typeof item.status === "string" ? item.status : "pending";
            const status = validStatuses.has(rawStatus) ? (rawStatus as TodoItem["status"]) : "pending";
            todoMap.set(`todo-${idx}`, { status, content: desc });
          }
        }

        // ── Artifacts: bash file output ──
        if (fnName === "bash" && typeof args.command === "string") {
          // Detect file writes: > file, tee file, cp/mv to file, cat > file, etc.
          const writePatterns = [
            /(?:>\s*|tee\s+)([^\s;|&]+\.\w+)/g,
            /\b(?:cp|mv)\s+\S+\s+([^\s;|&]+\.\w+)/g,
            /\b(?:mkdir)\s+(?:-p\s+)?([^\s;|&]+)/g,
          ];
          for (const pattern of writePatterns) {
            let m: RegExpExecArray | null;
            while ((m = pattern.exec(args.command as string)) !== null) {
              if (m[1]) {
                const isDir = m[0].startsWith("mkdir");
                artifactSet.set(m[1], isDir ? "directory" : "text");
              }
            }
          }
        }

        // ── Artifacts: read_file ──
        if (fnName === "read_file" && typeof args.path === "string") {
          artifactSet.set(args.path, "text");
        }

        // ── Artifacts: create_skill ──
        if (fnName === "create_skill" && typeof args.name === "string") {
          artifactSet.set(`skills/${args.name}`, "text");
        }

        // ── Skills: get_skill / create_skill / search_skill / install_skill ──
        if (fnName === "get_skill" && typeof args.skill_name === "string") {
          skillSet.set(args.skill_name, "skill");
        }
        if (fnName === "create_skill" && typeof args.name === "string") {
          skillSet.set(args.name, "skill");
        }
        if (fnName === "search_skill" && typeof args.query === "string") {
          skillSet.set(`search: ${args.query}`, "skill");
        }
        if (fnName === "install_skill" && typeof args.name === "string") {
          skillSet.set(args.name, "skill");
        }

        // ── MCP tools (mcp__ prefix) ──
        if (fnName.startsWith("mcp__")) {
          const parts = fnName.split("__");
          const serverName = parts[1] ?? fnName;
          skillSet.set(serverName, "mcp");
        }
      }
    }

    return {
      todoItems: Array.from(todoMap.values()),
      artifacts: Array.from(artifactSet).map(([path, type]) => ({ path, type })),
      usedSkills: Array.from(skillSet).map(([name, type]) => ({ name, type })),
    };
  }, [llmHistory]);
}

import { useMemo } from "react";
import { useIMStore } from "./store";

export interface TodoItem {
  status: "completed" | "in_progress" | "pending";
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

/** Parse llmHistory JSON → structured data for TaskMonitor panels. */
export function useTaskMonitorData(): TaskMonitorData {
  const llmHistory = useIMStore((s) => s.llmHistory);

  return useMemo(() => {
    const todos: TodoItem[] = [];
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

        // TodoWrite → latest wins
        if (fnName === "TodoWrite" && Array.isArray(args.todos)) {
          todos.length = 0;
          for (const t of args.todos as Array<Record<string, unknown>>) {
            if (typeof t?.content === "string" && typeof t?.status === "string") {
              todos.push({ status: t.status as TodoItem["status"], content: t.content });
            }
          }
        }

        // Write / Edit / NotebookEdit → file artifact
        if (fnName === "Write" && typeof args.file_path === "string") {
          artifactSet.set(args.file_path, "text");
        }
        if (fnName === "Edit" && typeof args.file_path === "string") {
          artifactSet.set(args.file_path, "text");
        }
        if (fnName === "NotebookEdit" && typeof args.notebook_path === "string") {
          artifactSet.set(args.notebook_path, "text");
        }

        // Bash → output files (heuristic)
        if (fnName === "Bash" && typeof args.command === "string") {
          const m = (args.command as string).match(/(?:>\s*|tee\s+)([^\s;|&]+\.\w+)/);
          if (m) artifactSet.set(m[1], "text");
        }

        // Skill usage
        if (fnName === "Skill" && typeof args.skill === "string") {
          skillSet.set(args.skill, "skill");
        }

        // MCP tools (mcp__ prefix)
        if (fnName.startsWith("mcp__")) {
          const parts = fnName.split("__");
          const serverName = parts[1] ?? fnName;
          skillSet.set(serverName, "mcp");
        }
      }
    }

    return {
      todoItems: todos,
      artifacts: Array.from(artifactSet).map(([path, type]) => ({ path, type })),
      usedSkills: Array.from(skillSet).map(([name, type]) => ({ name, type })),
    };
  }, [llmHistory]);
}

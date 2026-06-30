import { memo } from "react";
import { cx } from "./helpers";

type HistoryEntry = {
  role?: string;
  content?: string;
  tool_calls?: Array<{
    function?: { name?: string; arguments?: string };
  }>;
  [key: string]: unknown;
};

type IMHistoryListProps = {
  entries: HistoryEntry[];
  historyRole: (entry: HistoryEntry) => string;
  summarizeHistoryEntry: (
    entry: HistoryEntry,
    index: number,
    opts?: { omitRole?: boolean }
  ) => string;
};

function roleToCssClass(role: string): string {
  if (role === "system") return "system";
  if (role === "user") return "user-e";
  if (role === "assistant") return "assistant-e";
  if (role === "tool") return "tool-e";
  return "system";
}

export const IMHistoryList = memo(function IMHistoryList({
  entries,
  historyRole,
  summarizeHistoryEntry,
}: IMHistoryListProps) {
  return (
    <>
      {entries.length === 0 ? (
        <div className="muted">—</div>
      ) : (
        entries.map((entry, idx) => {
          const role = historyRole(entry);
          const cls = roleToCssClass(role);
          return (
            <div key={String(entry?.id ?? idx)} className={cx("llm-entry", cls)}>
              <div className="entry-head">
                <span className="sys-tag">{role.toUpperCase()}</span>
                #{idx + 1} — {summarizeHistoryEntry(entry, idx, { omitRole: true })}
              </div>
              <div className="entry-text">
                {typeof entry?.content === "string"
                  ? entry.content.replace(/\s+/g, " ").slice(0, 200)
                  : JSON.stringify(entry?.content ?? "").slice(0, 200)}
              </div>
            </div>
          );
        })
      )}
    </>
  );
});

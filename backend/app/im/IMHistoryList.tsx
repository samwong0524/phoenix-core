type IMHistoryListProps = {
  entries: any[];
  historyRole: (entry: any) => string;
  historyAccent: (role?: string) => string;
  summarizeHistoryEntry: (
    entry: any,
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

export function IMHistoryList({
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
            <div key={entry?.id ?? `${idx}`} className={cx("llm-entry", cls)}>
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
}

function cx(...classes: Array<string | false | undefined | null>): string {
  return classes.filter(Boolean).join(" ");
}

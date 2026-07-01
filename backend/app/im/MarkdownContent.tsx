import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";

const code = createCodePlugin({
  themes: ["github-dark", "github-dark"],
});

const streamdownPlugins = { code, mermaid };

/** Regex matching `> [!suggestion] ...` lines (with optional leading whitespace). */
const SUGGESTION_RE = /^\s*>\s*\[!suggestion\]\s*(.+)$/gim;

export function MarkdownContent({
  content,
  className = "",
  onSuggestionClick,
}: {
  content: string;
  className?: string;
  onSuggestionClick?: (text: string) => void;
}) {
  if (!content) return <span className="muted">—</span>;

  // Extract [!suggestion] lines and split into main text + suggestion list
  const suggestions: string[] = [];
  const mainText = content.replace(SUGGESTION_RE, (_match, text: string) => {
    suggestions.push(text.trim());
    return "";
  }).replace(/\n{3,}/g, "\n\n").trim();

  return (
    <div className={className}>
      {mainText && (
        <Streamdown plugins={streamdownPlugins}>{mainText}</Streamdown>
      )}
      {suggestions.length > 0 && onSuggestionClick && (
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginTop: mainText ? 8 : 0,
        }}>
          {suggestions.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onSuggestionClick(s)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 12px",
                borderRadius: 16,
                border: "1px solid var(--border, #3a3a4a)",
                background: "var(--surface-2, #2a2a3a)",
                color: "var(--text-secondary, #bbb)",
                fontSize: 12,
                cursor: "pointer",
                transition: "background 0.15s, color 0.15s, border-color 0.15s",
                maxWidth: 360,
                textAlign: "left",
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget;
                el.style.background = "var(--surface-3, #3a3a5a)";
                el.style.color = "var(--text-primary, #eee)";
                el.style.borderColor = "var(--cyan-500, #06b6d4)";
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget;
                el.style.background = "var(--surface-2, #2a2a3a)";
                el.style.color = "var(--text-secondary, #bbb)";
                el.style.borderColor = "var(--border, #3a3a4a)";
              }}
            >
              <span style={{ opacity: 0.5, fontSize: 11 }} aria-hidden="true">→</span>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

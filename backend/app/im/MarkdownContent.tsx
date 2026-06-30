import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";

const code = createCodePlugin({
  themes: ["github-dark", "github-dark"],
});

const streamdownPlugins = { code, mermaid };

export function MarkdownContent({ content, className = "" }: { content: string; className?: string }) {
  if (!content) return <span className="muted">—</span>;
  return (
    <div className={className}>
      <Streamdown plugins={streamdownPlugins}>{content}</Streamdown>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type DiffLine = { type: "add" | "remove" | "normal"; content: string };

type CodeBlockProps = {
  /** Source code to display */
  code: string;
  /** Programming language for syntax highlighting (e.g. "typescript", "python") */
  language?: string;
  /** Optional title shown in the header bar */
  title?: string;
  /** Show line numbers (default: true) */
  lineNumbers?: boolean;
  /** Diff mode: array of {type, content} per line */
  diff?: DiffLine[];
  /** Additional className for the root container */
  className?: string;
};

const COPY_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CHECK_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export function CodeBlock({
  code,
  language,
  title,
  lineNumbers = true,
  diff,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleCopy = useCallback(async () => {
    const text = diff ? diff.map((d) => d.content).join("\n") : code;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    }
  }, [code, diff]);

  // Lazy-load shiki for syntax highlighting (client-side)
  useEffect(() => {
    if (!language || diff) return; // Skip highlighting in diff mode
    let cancelled = false;

    import("shiki/bundle/web")
      .then(({ createHighlighter }) =>
        createHighlighter({
          themes: ["github-dark"],
          langs: [language as "typescript"],
        })
      )
      .then((highlighter) => {
        if (cancelled) return;
        const loadedLangs = highlighter.getLoadedLanguages();
        if (!loadedLangs.includes(language as "typescript")) return;
        const html = highlighter.codeToHtml(code, {
          lang: language,
          theme: "github-dark",
        });
        if (!cancelled) setHighlightedHtml(html);
      })
      .catch(() => {
        // Silently fall back to plain text
      });

    return () => {
      cancelled = true;
    };
  }, [code, language, diff]);

  // Cleanup copy timer
  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  const lines = diff ?? code.split("\n").map((content) => ({ type: "normal" as const, content }));
  // Remove trailing empty line
  if (lines.length > 0 && lines[lines.length - 1].content === "") {
    lines.pop();
  }

  return (
    <div
      className={`bg-code border border-border rounded-lg overflow-hidden text-[13px] leading-[1.6] ${className ?? ""}`}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-elevated/50">
        <div className="flex items-center gap-2 min-w-0">
          {title && (
            <span className="text-text-secondary text-xs font-[family-name:var(--font-mono)] truncate">
              {title}
            </span>
          )}
          {language && !title && (
            <span className="text-text-dim text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider">
              {language}
            </span>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded border-0 bg-transparent text-text-dim text-xs cursor-pointer transition-colors hover:text-text-secondary hover:bg-hover"
          aria-label="Copy code"
        >
          {copied ? CHECK_ICON : COPY_ICON}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>

      {/* Code content */}
      {highlightedHtml ? (
        <div className="overflow-x-auto p-3">
          <div
            className="font-[family-name:var(--font-mono)] [&>pre]:!m-0 [&>pre]:!p-0 [&>pre]:!bg-transparent"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </div>
      ) : (
        <div className="overflow-x-auto p-3">
          <table className="border-collapse w-full border-0">
            <tbody>
              {lines.map((line, i) => (
                <tr
                  key={i}
                  className={
                    line.type === "add"
                      ? "bg-green-soft"
                      : line.type === "remove"
                        ? "bg-red-soft"
                        : ""
                  }
                >
                  {lineNumbers && (
                    <td className="pr-3 text-text-dim text-right select-none align-top w-[1%] whitespace-nowrap font-[family-name:var(--font-mono)] text-[12px]">
                      {i + 1}
                    </td>
                  )}
                  <td className="pl-1 whitespace-pre font-[family-name:var(--font-mono)] text-text">
                    {line.type === "add" && (
                      <span className="text-green-text mr-1 select-none">+</span>
                    )}
                    {line.type === "remove" && (
                      <span className="text-red-text mr-1 select-none">-</span>
                    )}
                    {line.content || "\n"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { Streamdown } from "streamdown";
import { createCodePlugin } from "@streamdown/code";
import { mermaid } from "@streamdown/mermaid";
import { BottomSheet } from "@/components/ui";
import { CheckCircle2, Loader2, Circle, Play, X } from "lucide-react";

// Create code plugin with light theme
const code = createCodePlugin({
  themes: ["github-light", "github-light"],
});

const plugins = { code, mermaid };

const testMarkdown = `## Test Markdown

This is a **bold** text and *italic* text.

### Code Block
\`\`\`javascript
// 防抖函数 - 优化频繁触发的事件
function debounce(fn, delay) {
  let timer = null;
  return function(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
\`\`\`

### Inline Code
Use \`const x = 42\` for variable declarations.

### List
- Item 1
- Item 2
- Item 3

### Table
| Name | Age |
|------|-----|
| Alice | 25 |
| Bob | 30 |
`;

export default function TestPage() {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <div style={{ padding: 40, background: "#f8fafc", minHeight: "100vh", color: "#0f172a" }}>
      <h1 style={{ marginBottom: 24 }}>Streamdown Test</h1>
      <div style={{ maxWidth: 800 }}>
        <Streamdown plugins={plugins}>
          {testMarkdown}
        </Streamdown>
      </div>

      {/* BottomSheet Demo */}
      <div style={{ marginTop: 48, paddingTop: 32, borderTop: "2px solid #e2e8f0" }}>
        <h2 style={{ marginBottom: 16 }}>BottomSheet Component</h2>
        <p style={{ color: "#64748b", marginBottom: 16 }}>
          点击按钮打开底部面板。支持下滑关闭、点击遮罩关闭、Escape 键关闭。
        </p>
        <button
          onClick={() => setSheetOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 24px",
            background: "var(--color-primary, #06b6d4)",
            color: "#fff",
            border: "none",
            borderRadius: "var(--radius-md, 10px)",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            minHeight: 44,
          }}
        >
          <Play size={16} />
          打开 BottomSheet
        </button>
      </div>

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="任务监控"
        maxHeight="70vh"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {mockTasks.map((task) => (
            <div
              key={task.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: 16,
                background: "var(--bg-card, #fff)",
                border: "1px solid var(--border, #e2e8f0)",
                borderRadius: "var(--radius-md, 10px)",
                minHeight: 48,
              }}
            >
              {task.status === "done" && <CheckCircle2 size={20} color="#10b981" />}
              {task.status === "running" && <Loader2 size={20} color="#06b6d4" style={{ animation: "spin 1s linear infinite" }} />}
              {task.status === "pending" && <Circle size={20} color="#94a3b8" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>{task.name}</p>
                {task.status === "running" && task.progress != null && (
                  <div
                    style={{
                      marginTop: 8,
                      height: 4,
                      background: "var(--border, #e2e8f0)",
                      borderRadius: "var(--radius-full, 999px)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${task.progress}%`,
                        background: "var(--color-primary, #06b6d4)",
                        borderRadius: "var(--radius-full, 999px)",
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                )}
              </div>
              <span style={{ fontSize: 12, color: "var(--text-secondary, #64748b)" }}>
                {task.status === "done" && "已完成"}
                {task.status === "running" && `${task.progress}%`}
                {task.status === "pending" && "等待中"}
              </span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 24, padding: 16, background: "#f1f5f9", borderRadius: "var(--radius-md, 10px)" }}>
          <p style={{ fontSize: 13, color: "#475569", margin: 0, lineHeight: 1.6 }}>
            <strong>交互说明：</strong>下滑面板超过 80px 或快速下滑（速度 &gt; 500px/s）可关闭。
            也可以点击遮罩层或按 Escape 键关闭。
          </p>
        </div>
      </BottomSheet>
    </div>
  );
}

// Mock task data for demo
const mockTasks = [
  { id: "t1", name: "性能分析", status: "done" as const, progress: 100 },
  { id: "t2", name: "代码优化", status: "running" as const, progress: 65 },
  { id: "t3", name: "单元测试", status: "pending" as const },
  { id: "t4", name: "构建验证", status: "pending" as const },
  { id: "t5", name: "部署上线", status: "pending" as const },
];

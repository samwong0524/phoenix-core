/**
 * Phoenix-Core — 任务监控面板 (QoderWork CN 风格)
 *
 * 右侧面板：待办 / 产物 / 技能与 MCP / 意识更新
 * 原始调试面板收进"调试"按钮
 */

import { memo, useState, useMemo, useCallback } from "react";
import { TraceTree } from "./TraceTree";

// ── Types ───────────────────────────────────────────────────

type AgentStatus = "IDLE" | "BUSY" | "WAKING";

type AgentInfo = { id: string; role: string };
type GroupInfo = { id: string; name: string | null; memberIds: string[]; contextTokens: number };
type VizEventItem = { id: string; kind: string; label: string; at: number };

/** TodoWrite 条目 */
type TodoItem = { status: "completed" | "in_progress" | "pending"; content: string };

/** 产物文件 */
type ArtifactFile = { path: string; type: "text" | "binary" | "directory" };

/** 技能条目 */
type SkillEntry = { name: string; type: "skill" | "mcp" };

type TaskMonitorProps = {
  agents: AgentInfo[];
  agentStatusById: Record<string, AgentStatus>;
  groups: GroupInfo[];
  activeGroupId: string | null;
  vizEvents: VizEventItem[];
  streamAgentId: string | null;
  contentStream: string;
  toolStream: string;
  agentError: string | null;
  llmHistory?: string;
  locale?: "zh" | "en";
  /** TodoWrite 条目（从 message 中解析） */
  todoItems?: TodoItem[];
  /** 产物文件列表 */
  artifacts?: ArtifactFile[];
  /** 使用的技能/MCP */
  usedSkills?: SkillEntry[];
};

type SectionId = "todo" | "artifacts" | "skills" | "awareness" | "debug";

// ─── Collapsible Section ────────────────────────────────────

function CollapsibleSection({
  title,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={sectionStyle}>
      <div
        style={sectionHeaderStyle}
        onClick={() => setOpen(!open)}
      >
        <span style={sectionChevronStyle}>{open ? "▾" : "▸"}</span>
        <span style={sectionIconStyle}>{icon}</span>
        <span style={sectionTitleStyle}>{title}</span>
      </div>
      {open && <div style={sectionContentStyle}>{children}</div>}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────

export const TaskMonitor = memo(function TaskMonitor(props: TaskMonitorProps) {
  const {
    agents, agentStatusById, groups, activeGroupId,
    vizEvents, streamAgentId, contentStream, toolStream,
    agentError, llmHistory = "", locale = "zh",
    todoItems, artifacts, usedSkills,
  } = props;

  const [showDebug, setShowDebug] = useState(false);
  const isZh = locale === "zh";

  // Filter non-human agents
  const nonHumanAgents = useMemo(
    () => agents.filter((a) => a.role !== "human"),
    [agents]
  );

  return (
    <div style={monitorStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <span style={headerTitleStyle}>{isZh ? "任务监控" : "Task Monitor"}</span>
        <button
          onClick={() => setShowDebug(!showDebug)}
          style={{
            ...headerDebugBtnStyle,
            ...(showDebug ? { color: "var(--cyan)", background: "rgba(0,240,255,0.1)" } : {}),
          }}
          title={isZh ? "调试面板" : "Debug panel"}
        >
          ⚙️
        </button>
      </div>

      {/* Scrollable content */}
      <div style={scrollStyle}>
        {/* 待办 */}
        <CollapsibleSection title={isZh ? "待办" : "Todo"} icon="✓" defaultOpen={!!todoItems?.length}>
          {todoItems && todoItems.length > 0 ? (
            todoItems.map((item, i) => (
              <div key={i} style={todoItemStyle}>
                <span style={todoCheckStyle(item.status)}>
                  {item.status === "completed" ? "✅" : item.status === "in_progress" ? "🔄" : "⏳"}
                </span>
                <span style={todoTextStyle(item.status)}>{item.content}</span>
              </div>
            ))
          ) : (
            <div style={emptyHintStyle}>{isZh ? "暂无待办任务" : "No tasks yet"}</div>
          )}
        </CollapsibleSection>

        {/* 产物 */}
        <CollapsibleSection title={isZh ? "产物" : "Artifacts"} icon="📦" defaultOpen={!!artifacts?.length}>
          {artifacts && artifacts.length > 0 ? (
            <div>
              <div style={artifactsSubLabelStyle}>{isZh ? "文件" : "Files"}</div>
              {artifacts.map((file, i) => (
                <div key={i} style={artifactItemStyle}>
                  <span style={artifactIconStyle}>{file.type === "directory" ? "📁" : "📄"}</span>
                  <span style={artifactNameStyle}>{file.path}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={emptyHintStyle}>{isZh ? "暂无产物" : "No artifacts yet"}</div>
          )}
        </CollapsibleSection>

        {/* 技能与 MCP */}
        <CollapsibleSection title={isZh ? "技能与 MCP" : "Skills & MCP"} icon="" defaultOpen={!!usedSkills?.length}>
          {usedSkills && usedSkills.length > 0 ? (
            usedSkills.map((skill, i) => (
              <div key={i} style={skillItemStyle}>
                <span style={skillIconStyle}>
                  {skill.type === "mcp" ? "" : "🔧"}
                </span>
                <span style={skillNameStyle}>{skill.name}</span>
              </div>
            ))
          ) : (
            <div style={emptyHintStyle}>{isZh ? "暂无技能/MCP" : "No skills/MCP yet"}</div>
          )}
        </CollapsibleSection>

        {/* 意识更新 */}
        <CollapsibleSection title={isZh ? "意识更新" : "Awareness"} icon="💡" defaultOpen={false}>
          <div style={awarenessGridStyle}>
            <div style={awarenessBtnStyle}>
              <span>🧠</span>
              <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{isZh ? "记忆" : "Memory"}</span>
            </div>
            <div style={awarenessBtnStyle}>
              <span>📅</span>
              <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{isZh ? "日历" : "Calendar"}</span>
            </div>
          </div>
        </CollapsibleSection>

        {/* 调试面板（收拢状态） */}
        {showDebug && (
          <CollapsibleSection title={isZh ? "调试" : "Debug"} icon="" defaultOpen>
            <DebugPanel
              vizEvents={vizEvents}
              llmHistory={llmHistory}
              contentStream={contentStream}
              toolStream={toolStream}
              agentError={agentError}
              streamAgentId={streamAgentId}
              locale={locale}
            />
          </CollapsibleSection>
        )}
      </div>

      {/* Status bar */}
      <div style={statusBarStyle}>
        <StatusDot
          color="var(--green)"
          count={nonHumanAgents.filter((a) => agentStatusById[a.id] === "IDLE").length}
          label={isZh ? "在线" : "Online"}
        />
        <StatusDot
          color="var(--magenta)"
          count={nonHumanAgents.filter((a) => agentStatusById[a.id] === "BUSY" || agentStatusById[a.id] === "WAKING").length}
          label={isZh ? "忙碌" : "Busy"}
        />
        <StatusDot
          color="var(--text-dim)"
          count={nonHumanAgents.filter((a) => !agentStatusById[a.id]).length}
          label={isZh ? "空闲" : "Idle"}
        />
      </div>
    </div>
  );
});

// ─── Debug Panel (original tabs) ────────────────────────────

function DebugPanel({
  vizEvents, llmHistory, contentStream, toolStream, agentError, streamAgentId, locale,
}: Omit<TaskMonitorProps, "agents" | "agentStatusById" | "groups" | "activeGroupId" | "todoItems" | "artifacts" | "usedSkills">) {
  const [tab, setTab] = useState<"trace" | "events" | "raw">("trace");
  const isZh = locale === "zh";

  return (
    <div>
      <div style={{ display: "flex", gap: 2, marginBottom: 6 }}>
        {(["trace", "events", "raw"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: "4px 8px", fontSize: 10, fontFamily: "var(--font-mono)",
              background: tab === t ? "rgba(0,240,255,0.1)" : "var(--bg-card)",
              color: tab === t ? "var(--cyan)" : "var(--text-dim)",
              border: "1px solid var(--border)", borderRadius: 3, cursor: "pointer",
            }}
          >
            {t === "trace" ? "Trace" : t === "events" ? (isZh ? "事件" : "Events") : "Raw"}
          </button>
        ))}
      </div>
      {tab === "trace" && <TraceTree llmHistory={llmHistory ?? ""} streamAgentId={streamAgentId} />}
      {tab === "events" && (
        <div style={{ maxHeight: 200, overflow: "auto" }}>
          {[...vizEvents].reverse().slice(0, 50).map((evt) => (
            <div key={evt.id} style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-dim)", padding: "2px 0", borderBottom: "1px solid var(--border)" }}>
              [{evt.kind}] {evt.label}
            </div>
          ))}
        </div>
      )}
      {tab === "raw" && (
        <pre style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-secondary)", maxHeight: 200, overflow: "auto", margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {contentStream || "—"}
        </pre>
      )}
    </div>
  );
}

// ─── Status Dot ──────────────────────────────────────────────

function StatusDot({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <div style={statusDotContainerStyle}>
      <span style={{ ...statusDotStyle, background: color }} />
      <span style={statusDotLabelStyle}>{label}</span>
      <span style={statusDotCountStyle}>{count}</span>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const monitorStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", height: "100%",
  background: "var(--bg-panel)", borderLeft: "1px solid var(--border)",
  fontFamily: "var(--font-body)", overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  padding: "12px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0,
};

const headerTitleStyle: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
};

const headerDebugBtnStyle: React.CSSProperties = {
  background: "none", border: "1px solid var(--border)", borderRadius: 4,
  padding: "2px 6px", cursor: "pointer", fontSize: 12, color: "var(--text-dim)",
};

const scrollStyle: React.CSSProperties = {
  flex: 1, overflow: "auto", padding: "var(--space-2)",
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 10,
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  padding: "8px 6px", cursor: "pointer",
  borderBottom: "1px solid var(--border)", marginBottom: 6,
};

const sectionChevronStyle: React.CSSProperties = {
  fontSize: 10, color: "var(--text-dim)", width: 12, textAlign: "center",
};

const sectionIconStyle: React.CSSProperties = {
  fontSize: 12,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 500, color: "var(--text-secondary)",
};

const sectionContentStyle: React.CSSProperties = {
  paddingLeft: 4,
};

const emptyHintStyle: React.CSSProperties = {
  fontSize: 11, color: "var(--text-dim)", padding: "8px 4px", fontStyle: "italic",
};

// Todo items
const todoItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "flex-start", gap: 6, padding: "4px 0",
};

const todoCheckStyle = (status: string): React.CSSProperties => ({
  fontSize: 12, flexShrink: 0, opacity: status === "completed" ? 0.5 : 1,
});

const todoTextStyle = (status: string): React.CSSProperties => ({
  fontSize: 12, color: status === "completed" ? "var(--text-dim)" : "var(--text-secondary)",
  textDecoration: status === "completed" ? "line-through" : "none",
});

// Artifacts
const artifactsSubLabelStyle: React.CSSProperties = {
  fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase",
  letterSpacing: "0.5px", marginBottom: 4,
};

const artifactItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, padding: "4px 0",
};

const artifactIconStyle: React.CSSProperties = { fontSize: 12, flexShrink: 0 };

const artifactNameStyle: React.CSSProperties = {
  fontSize: 11, color: "var(--text-secondary)", wordBreak: "break-all",
};

// Skills
const skillItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, padding: "4px 0",
};

const skillIconStyle: React.CSSProperties = { fontSize: 12, flexShrink: 0 };

const skillNameStyle: React.CSSProperties = {
  fontSize: 11, color: "var(--text-secondary)",
};

// Awareness
const awarenessGridStyle: React.CSSProperties = {
  display: "flex", gap: 8, padding: "4px 0",
};

const awarenessBtnStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
  padding: "8px 16px", borderRadius: 4, border: "1px solid var(--border)",
  cursor: "pointer", background: "var(--bg-card)",
};

// Status bar
const statusBarStyle: React.CSSProperties = {
  display: "flex", justifyContent: "space-around",
  padding: "8px 12px", borderTop: "1px solid var(--border)", flexShrink: 0,
};

const statusDotContainerStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4,
};

const statusDotStyle: React.CSSProperties = {
  width: 6, height: 6, borderRadius: "50%",
};

const statusDotLabelStyle: React.CSSProperties = {
  fontSize: 11, color: "var(--text-dim)",
};

const statusDotCountStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: "var(--text-secondary)",
  fontFamily: "var(--font-mono)",
};

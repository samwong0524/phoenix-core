/**
 * Phoenix-Core — 任务监控面板
 *
 * 替代原来的 events-panel + details-panel（7 个调试区块）
 * 三个 Tab：Agents / Activity / Metrics
 * 面向用户（非开发者调试），开发者模式可切换回原始视图
 */

import { memo, useState, useMemo } from "react";
import { translateEvent, statusText, statusColor } from "./eventTranslator";
import { TraceTree } from "./TraceTree";

// ─── Types ───────────────────────────────────────────────────

type AgentStatus = "IDLE" | "BUSY" | "WAKING";

type AgentInfo = {
  id: string;
  role: string;
};

type GroupInfo = {
  id: string;
  name: string | null;
  memberIds: string[];
  contextTokens: number;
};

type VizEventItem = {
  id: string;
  kind: "agent" | "message" | "llm" | "tool" | "db";
  label: string;
  at: number;
};

type TaskMonitorProps = {
  agents: AgentInfo[];
  agentStatusById: Record<string, AgentStatus>;
  groups: GroupInfo[];
  activeGroupId: string | null;
  vizEvents: VizEventItem[];
  /** Currently streaming agent id */
  streamAgentId: string | null;
  /** Streaming content (for agent detail expansion) */
  contentStream: string;
  toolStream: string;
  /** Agent error */
  agentError: string | null;
  /** LLM history raw text (for dev mode) */
  llmHistory?: string;
  /** Locale */
  locale?: "zh" | "en";
};

type TabId = "agents" | "activity" | "metrics" | "trace" | "dev";

// ─── Component ───────────────────────────────────────────────

export const TaskMonitor = memo(function TaskMonitor(props: TaskMonitorProps) {
  const {
    agents,
    agentStatusById,
    groups,
    activeGroupId,
    vizEvents,
    streamAgentId,
    contentStream,
    toolStream,
    agentError,
    llmHistory = "",
    locale = "zh",
  } = props;

  const [activeTab, setActiveTab] = useState<TabId>("agents");
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const isZh = locale === "zh";

  // Filter out human agent for status display
  const nonHumanAgents = useMemo(
    () => agents.filter((a) => a.role !== "human"),
    [agents]
  );

  // Status counts
  const statusCounts = useMemo(() => {
    let online = 0, busy = 0, idle = 0;
    for (const a of nonHumanAgents) {
      const s = agentStatusById[a.id];
      if (s === "BUSY" || s === "WAKING") busy++;
      else if (s === "IDLE") online++;
      else idle++;
    }
    return { online, busy, idle };
  }, [nonHumanAgents, agentStatusById]);

  // Token totals
  const totalTokens = useMemo(
    () => groups.reduce((sum, g) => sum + (g.contextTokens || 0), 0),
    [groups]
  );

  const activeGroup = useMemo(
    () => groups.find((g) => g.id === activeGroupId),
    [groups, activeGroupId]
  );

  return (
    <div style={monitorStyle}>
      {/* Tab bar */}
      <div style={tabBarStyle}>
        {(["agents", "activity", "metrics", "trace", "dev"] as TabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              ...tabStyle,
              ...(activeTab === tab ? tabActiveStyle : {}),
              ...(tab === "dev" ? { fontSize: 10, fontFamily: "var(--font-mono)" } : {}),
            }}
          >
            {tab === "agents" && "Agents"}
            {tab === "activity" && (isZh ? "活动" : "Activity")}
            {tab === "metrics" && (isZh ? "度量" : "Metrics")}
            {tab === "trace" && "Trace"}
            {tab === "dev" && "DEV"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={tabContentStyle}>
        {activeTab === "agents" && (
          <AgentsTab
            agents={nonHumanAgents}
            agentStatusById={agentStatusById}
            streamAgentId={streamAgentId}
            contentStream={contentStream}
            toolStream={toolStream}
            agentError={agentError}
            expandedAgent={expandedAgent}
            onToggle={(id) => setExpandedAgent(expandedAgent === id ? null : id)}
            locale={locale}
          />
        )}
        {activeTab === "activity" && (
          <ActivityTab vizEvents={vizEvents} locale={locale} />
        )}
        {activeTab === "metrics" && (
          <MetricsTab
            totalTokens={totalTokens}
            activeGroup={activeGroup}
            agentCount={nonHumanAgents.length}
            statusCounts={statusCounts}
            locale={locale}
          />
        )}
        {activeTab === "trace" && (
          <TraceTree llmHistory={llmHistory ?? ""} streamAgentId={streamAgentId} />
        )}
        {activeTab === "dev" && (
          <DevTab
            vizEvents={vizEvents}
            llmHistory={llmHistory}
            contentStream={contentStream}
            toolStream={toolStream}
            agentError={agentError}
            streamAgentId={streamAgentId}
            locale={locale}
          />
        )}
      </div>

      {/* Status bar (always visible) */}
      <div style={statusBarStyle}>
        <StatusDot color="var(--green)" count={statusCounts.online} label={isZh ? "在线" : "Online"} />
        <StatusDot color="var(--magenta)" count={statusCounts.busy} label={isZh ? "忙碌" : "Busy"} />
        <StatusDot color="var(--text-dim)" count={statusCounts.idle} label={isZh ? "空闲" : "Idle"} />
      </div>
    </div>
  );
});

// ─── Agents Tab ──────────────────────────────────────────────

function AgentsTab({
  agents,
  agentStatusById,
  streamAgentId,
  contentStream,
  toolStream,
  agentError,
  expandedAgent,
  onToggle,
  locale,
}: {
  agents: AgentInfo[];
  agentStatusById: Record<string, AgentStatus>;
  streamAgentId: string | null;
  contentStream: string;
  toolStream: string;
  agentError: string | null;
  expandedAgent: string | null;
  onToggle: (id: string) => void;
  locale: "zh" | "en";
}) {
  const isZh = locale === "zh";

  if (agents.length === 0) {
    return (
      <div style={emptyStyle}>
        {isZh ? "暂无活跃 Agent" : "No active agents"}
      </div>
    );
  }

  return (
    <div style={agentListStyle}>
      {agents.map((agent) => {
        const status = agentStatusById[agent.id];
        const isStreaming = agent.id === streamAgentId;
        const isExpanded = expandedAgent === agent.id;
        const color = statusColor(status);

        return (
          <div key={agent.id} style={agentCardStyle}>
            <div
              style={agentCardHeaderStyle}
              onClick={() => onToggle(agent.id)}
            >
              <span style={{ ...agentDotStyle, background: color }} />
              <span style={agentRoleStyle}>
                {agent.role.charAt(0).toUpperCase() + agent.role.slice(1)}
              </span>
              <span style={{ ...agentStatusTextStyle, color }}>
                {statusText(status, locale)}
              </span>
              {isStreaming && (
                <span style={streamingBadgeStyle}>
                  {isZh ? "输出中" : "Streaming"}
                </span>
              )}
            </div>
            {isExpanded && (
              <div style={agentDetailStyle}>
                {isStreaming && contentStream ? (
                  <div style={detailBlockStyle}>
                    <div style={detailLabelStyle}>
                      {isZh ? "当前输出" : "Current output"}
                    </div>
                    <div style={detailContentStyle}>
                      {contentStream.slice(0, 500)}
                      {contentStream.length > 500 ? "..." : ""}
                    </div>
                  </div>
                ) : null}
                {isStreaming && toolStream ? (
                  <div style={detailBlockStyle}>
                    <div style={detailLabelStyle}>
                      {isZh ? "工具调用" : "Tool calls"}
                    </div>
                    <div style={detailContentStyle}>{toolStream.slice(0, 300)}</div>
                  </div>
                ) : null}
                {isStreaming && agentError ? (
                  <div style={{ ...detailBlockStyle, color: "var(--red)" }}>
                    {agentError}
                  </div>
                ) : null}
                {!isStreaming && (
                  <div style={detailBlockStyle}>
                    <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
                      {isZh ? "ID: " : "ID: "}
                      {agent.id.slice(0, 8)}...
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Activity Tab ────────────────────────────────────────────

function ActivityTab({
  vizEvents,
  locale,
}: {
  vizEvents: VizEventItem[];
  locale: "zh" | "en";
}) {
  const isZh = locale === "zh";

  if (vizEvents.length === 0) {
    return (
      <div style={emptyStyle}>
        {isZh ? "暂无活动" : "No activity yet"}
      </div>
    );
  }

  return (
    <div style={activityListStyle}>
      {[...vizEvents].reverse().map((evt) => {
        const { text, icon } = translateEvent(evt, locale);
        const time = new Date(evt.at).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        });

        return (
          <div key={evt.id} style={activityItemStyle}>
            <span style={activityIconStyle}>{icon}</span>
            <span style={activityTextStyle}>{text}</span>
            <span style={activityTimeStyle}>{time}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Metrics Tab ─────────────────────────────────────────────

function MetricsTab({
  totalTokens,
  activeGroup,
  agentCount,
  statusCounts,
  locale,
}: {
  totalTokens: number;
  activeGroup: GroupInfo | undefined;
  agentCount: number;
  statusCounts: { online: number; busy: number; idle: number };
  locale: "zh" | "en";
}) {
  const isZh = locale === "zh";
  const groupTokens = activeGroup?.contextTokens ?? 0;

  return (
    <div style={metricsGridStyle}>
      <MetricCard
        label={isZh ? "总 Token" : "Total Tokens"}
        value={totalTokens ? `${(totalTokens / 1000).toFixed(1)}k` : "-"}
        color="var(--cyan)"
      />
      <MetricCard
        label={isZh ? "当前会话" : "Current Session"}
        value={groupTokens ? `${(groupTokens / 1000).toFixed(1)}k` : "-"}
        color="var(--cyan)"
      />
      <MetricCard
        label={isZh ? "Agent 数" : "Agents"}
        value={String(agentCount)}
        color="var(--yellow)"
      />
      <MetricCard
        label={isZh ? "预估成本" : "Est. Cost"}
        value={totalTokens ? `$${(totalTokens * 0.000003).toFixed(2)}` : "-"}
        color="var(--green)"
      />
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={metricCardStyle}>
      <div style={metricLabelStyle}>{label}</div>
      <div style={{ ...metricValueStyle, color }}>{value}</div>
    </div>
  );
}

function StatusDot({ color, count, label }: { color: string; count: number; label: string }) {
  return (
    <div style={statusDotContainerStyle}>
      <span style={{ ...statusDotStyle, background: color }} />
      <span style={statusDotLabelStyle}>{label}</span>
      <span style={statusDotCountStyle}>{count}</span>
    </div>
  );
}

// ─── Dev Tab ─────────────────────────────────────────────────

function DevTab({
  vizEvents,
  llmHistory,
  contentStream,
  toolStream,
  agentError,
  streamAgentId,
  locale,
}: {
  vizEvents: VizEventItem[];
  llmHistory: string;
  contentStream: string;
  toolStream: string;
  agentError: string | null;
  streamAgentId: string | null;
  locale: "zh" | "en";
}) {
  const isZh = locale === "zh";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {/* Streaming info */}
      <div style={devSectionStyle}>
        <div style={devLabelStyle}>
          <span style={devDotStyle} />
          {isZh ? "实时内容" : "Realtime content"}
          {contentStream ? <span style={devBadgeStyle}>●</span> : null}
        </div>
        <pre style={devPreStyle}>{contentStream || (isZh ? "—" : "—")}</pre>
      </div>

      <div style={devSectionStyle}>
        <div style={devLabelStyle}>
          <span style={devDotStyle} />
          {isZh ? "实时推理" : "Realtime reasoning"}
        </div>
        <pre style={devPreStyle}>{isZh ? "(已合并到内容流)" : "(merged into content stream)"}</pre>
      </div>

      <div style={devSectionStyle}>
        <div style={devLabelStyle}>
          <span style={devDotStyle} />
          {isZh ? "工具调用" : "Tool calls"}
          {toolStream ? <span style={devBadgeStyle}>●</span> : null}
        </div>
        <pre style={devPreStyle}>{toolStream || "—"}</pre>
      </div>

      {agentError ? (
        <div style={{ ...devSectionStyle, color: "var(--red)", border: "1px solid rgba(255,59,59,0.2)", borderRadius: "var(--radius-sm)", padding: "var(--space-2)" }}>
          {agentError}
        </div>
      ) : null}

      {/* LLM History */}
      <div style={devSectionStyle}>
        <div style={devLabelStyle}>
          <span style={devDotStyle} />
          LLM history
          {streamAgentId ? <span style={devBadgeStyle}>streaming: {streamAgentId.slice(0, 8)}</span> : null}
        </div>
        <pre style={{ ...devPreStyle, maxHeight: 200 }}>
          {llmHistory || "—"}
        </pre>
      </div>

      {/* Raw events */}
      <div style={devSectionStyle}>
        <div style={devLabelStyle}>
          <span style={devDotStyle} />
          {isZh ? "原始事件" : "Raw events"}
          <span style={devBadgeStyle}>{vizEvents.length}</span>
        </div>
        <div style={{ maxHeight: 160, overflow: "auto" }}>
          {vizEvents.length === 0 ? (
            <pre style={devPreStyle}>—</pre>
          ) : (
            vizEvents.slice(-20).reverse().map((evt) => (
              <div key={evt.id} style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-dim)", padding: "2px 0", borderBottom: "1px solid var(--border)" }}>
                <span style={{ color: evt.kind === "agent" ? "var(--green)" : evt.kind === "llm" ? "var(--cyan)" : evt.kind === "tool" ? "var(--magenta)" : "var(--text-secondary)" }}>
                  [{evt.kind}]
                </span>{" "}
                {evt.label}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────

const monitorStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  background: "var(--bg-panel)",
  borderLeft: "1px solid var(--border)",
  fontFamily: "var(--font-body)",
  overflow: "hidden",
};

const tabBarStyle: React.CSSProperties = {
  display: "flex",
  borderBottom: "1px solid var(--border)",
  padding: "0 var(--space-2)",
  flexShrink: 0,
};

const tabStyle: React.CSSProperties = {
  flex: 1,
  padding: "10px 8px",
  background: "none",
  border: "none",
  borderBottom: "2px solid transparent",
  color: "var(--text-dim)",
  fontSize: 11,
  fontWeight: 500,
  cursor: "pointer",
  transition: "all 0.2s",
  fontFamily: "var(--font-body)",
};

const tabActiveStyle: React.CSSProperties = {
  color: "var(--cyan)",
  borderBottomColor: "var(--cyan)",
};

const tabContentStyle: React.CSSProperties = {
  flex: 1,
  overflow: "auto",
  padding: "var(--space-2)",
};

const emptyStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: 120,
  color: "var(--text-dim)",
  fontSize: 12,
};

// Agents tab
const agentListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

const agentCardStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  overflow: "hidden",
};

const agentCardHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "8px 10px",
  cursor: "pointer",
};

const agentDotStyle: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  flexShrink: 0,
};

const agentRoleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: "var(--text-primary)",
  flex: 1,
};

const agentStatusTextStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
};

const streamingBadgeStyle: React.CSSProperties = {
  fontSize: 9,
  padding: "1px 6px",
  borderRadius: "var(--radius-full)",
  background: "rgba(0, 255, 136, 0.15)",
  color: "var(--green)",
  fontWeight: 500,
};

const agentDetailStyle: React.CSSProperties = {
  padding: "0 10px 8px",
  borderTop: "1px solid var(--border)",
  marginTop: 2,
};

const detailBlockStyle: React.CSSProperties = {
  marginTop: "var(--space-2)",
};

const detailLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-dim)",
  marginBottom: 2,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const detailContentStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  fontFamily: "var(--font-mono)",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  maxHeight: 120,
  overflow: "auto",
};

// Activity tab
const activityListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 1,
};

const activityItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-2)",
  padding: "6px 8px",
  borderRadius: "var(--radius-sm)",
  transition: "background 0.15s",
};

const activityIconStyle: React.CSSProperties = {
  fontSize: 12,
  flexShrink: 0,
  width: 18,
  textAlign: "center",
};

const activityTextStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-secondary)",
  flex: 1,
  lineHeight: 1.4,
};

const activityTimeStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-dim)",
  fontFamily: "var(--font-mono)",
  flexShrink: 0,
};

// Metrics tab
const metricsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "var(--space-2)",
  padding: "var(--space-1)",
};

const metricCardStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "10px 12px",
};

const metricLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-dim)",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const metricValueStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 600,
  fontFamily: "var(--font-mono)",
};

// Status bar
const statusBarStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-around",
  padding: "8px 12px",
  borderTop: "1px solid var(--border)",
  flexShrink: 0,
};

const statusDotContainerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const statusDotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: "50%",
};

const statusDotLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-dim)",
};

const statusDotCountStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--text-secondary)",
  fontFamily: "var(--font-mono)",
};

// Dev tab
const devSectionStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-2)",
};

const devLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 10,
  fontWeight: 500,
  color: "var(--text-dim)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  marginBottom: 4,
};

const devDotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: "var(--cyan)",
};

const devBadgeStyle: React.CSSProperties = {
  marginLeft: "auto",
  fontSize: 9,
  padding: "1px 6px",
  borderRadius: "var(--radius-full)",
  background: "rgba(0, 240, 255, 0.1)",
  color: "var(--cyan)",
  fontWeight: 500,
};

const devPreStyle: React.CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  fontSize: 10,
  fontFamily: "var(--font-mono)",
  color: "var(--text-secondary)",
  maxHeight: 100,
  overflow: "auto",
  wordBreak: "break-all",
};

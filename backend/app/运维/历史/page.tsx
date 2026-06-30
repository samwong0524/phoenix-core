"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Card, Loading } from "@/components/ui";
import { ROUTES } from "@/app/_components/routes";

// ─── Types ────────────────────────────────────────────

interface TaskLog {
  eventType: string;
  eventData: Record<string, unknown> | string | null;
  createdAt: string;
}

interface TaskExecution {
  id: string;
  name: string;
  displayName: string;
  nodeId: string | null;
  description: string | null;
  status: string;
  assigneeRole: string | null;
  assigneeId: string | null;
  result: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  duration: number | null;
  logs: TaskLog[];
}

interface WorkflowSummary {
  totalTasks: number;
  completed: number;
  failed: number;
  pending: number;
  inProgress: number;
  totalDuration: number;
}

interface WorkflowDetail {
  id: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface ExecutionData {
  workflow: WorkflowDetail;
  summary: WorkflowSummary;
  tasks: TaskExecution[];
}

interface WorkflowListItem {
  id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  taskSummary?: {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    inProgress: number;
  };
}

// ─── Helpers ──────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const statusConfig: Record<string, { icon: string; color: string; label: string }> = {
  pending: { icon: "○", color: "var(--text-dim)", label: "Pending" },
  in_progress: { icon: "◉", color: "var(--cyan)", label: "Running" },
  reviewed: { icon: "✓", color: "var(--green)", label: "Completed" },
  completed: { icon: "✓", color: "var(--green)", label: "Completed" },
  failed: { icon: "✗", color: "var(--red)", label: "Failed" },
  draft: { icon: "◇", color: "var(--text-dim)", label: "Draft" },
  active: { icon: "◆", color: "var(--green)", label: "Active" },
  paused: { icon: "❚❚", color: "var(--yellow, #f59e0b)", label: "Paused" },
};

// ─── Status Badge ─────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] || statusConfig.pending;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        fontFamily: "var(--font-mono)",
        color: cfg.color,
        background: `${cfg.color}15`,
        border: `1px solid ${cfg.color}30`,
        borderRadius: 4,
        padding: "2px 6px",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ─── Progress Bar ─────────────────────────────────────

function ProgressBar({ summary }: { summary: { total: number; completed: number; failed: number } }) {
  if (summary.total === 0) return null;
  const completedPct = (summary.completed / summary.total) * 100;
  const failedPct = (summary.failed / summary.total) * 100;

  return (
    <div
      style={{
        height: 4,
        borderRadius: 2,
        background: "var(--border)",
        overflow: "hidden",
        display: "flex",
      }}
    >
      <div style={{ width: `${completedPct}%`, background: "var(--green)", transition: "width 0.3s" }} />
      <div style={{ width: `${failedPct}%`, background: "var(--red)", transition: "width 0.3s" }} />
    </div>
  );
}

// ─── Task Card ────────────────────────────────────────

function TaskCard({ task }: { task: TaskExecution }) {
  const [expanded, setExpanded] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const cfg = statusConfig[task.status] || statusConfig.pending;

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: `1px solid ${expanded ? cfg.color + "60" : "var(--border)"}`,
        borderRadius: 8,
        overflow: "hidden",
        transition: "border-color 0.2s",
      }}
    >
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: "12px 16px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        {/* Status icon */}
        <span
          style={{
            fontSize: 18,
            color: cfg.color,
            width: 24,
            textAlign: "center",
            flexShrink: 0,
          }}
        >
          {cfg.icon}
        </span>

        {/* Task info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
            {task.displayName}
          </div>
          {task.assigneeRole && (
            <div
              style={{
                fontSize: 11,
                color: "var(--text-dim)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {task.assigneeRole}
            </div>
          )}
        </div>

        {/* Duration */}
        {task.duration !== null && (
          <span
            style={{
              fontSize: 11,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              flexShrink: 0,
            }}
          >
            {formatDuration(task.duration)}
          </span>
        )}

        {/* Status badge */}
        <StatusBadge status={task.status} />

        {/* Expand indicator */}
        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
          {expanded ? "▼" : "▶"}
        </span>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div
          style={{
            borderTop: "1px solid var(--border)",
            padding: "12px 16px",
          }}
        >
          {/* Description */}
          {task.description && (
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.5 }}>
              {task.description}
            </div>
          )}

          {/* Timing */}
          <div
            style={{
              display: "flex",
              gap: 16,
              fontSize: 11,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              marginBottom: 12,
            }}
          >
            {task.startedAt && <span>Started: {formatTime(task.startedAt)}</span>}
            {task.completedAt && <span>Ended: {formatTime(task.completedAt)}</span>}
          </div>

          {/* Error */}
          {task.error && (
            <div
              style={{
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: 12,
                color: "var(--red)",
                marginBottom: 12,
                fontFamily: "var(--font-mono)",
              }}
            >
              {task.error}
            </div>
          )}

          {/* Result */}
          {task.result && (
            <div style={{ marginBottom: 12 }}>
              <div
                onClick={() => setShowResult(!showResult)}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--cyan)",
                  cursor: "pointer",
                  marginBottom: 4,
                }}
              >
                {showResult ? "▼" : "▶"} Result
              </div>
              {showResult && (
                <pre
                  style={{
                    background: "var(--bg-panel)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: 12,
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-secondary)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    maxHeight: 300,
                    overflow: "auto",
                  }}
                >
                  {task.result}
                </pre>
              )}
            </div>
          )}

          {/* Event Logs */}
          {task.logs.length > 0 && (
            <div>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text-dim)",
                  marginBottom: 8,
                }}
              >
                Event Log ({task.logs.length})
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  maxHeight: 200,
                  overflow: "auto",
                }}
              >
                {task.logs.map((log, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      gap: 8,
                      fontSize: 10,
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-dim)",
                      padding: "3px 0",
                    }}
                  >
                    <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>
                      {formatTime(log.createdAt)}
                    </span>
                    <span
                      style={{
                        color: log.eventType.includes("fail") || log.eventType.includes("timeout")
                          ? "var(--red)"
                          : log.eventType.includes("started") || log.eventType.includes("sent")
                            ? "var(--cyan)"
                            : "var(--text-dim)",
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {log.eventType}
                    </span>
                    {log.eventData && typeof log.eventData === "object" && (
                      <span style={{ color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {JSON.stringify(log.eventData).slice(0, 80)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Workflow List Item ───────────────────────────────

function WorkflowItem({
  wf,
  selected,
  onClick,
}: {
  wf: WorkflowListItem;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: "10px 14px",
        cursor: "pointer",
        background: selected ? "var(--bg-card)" : "transparent",
        borderLeft: selected ? "3px solid var(--cyan)" : "3px solid transparent",
        borderBottom: "1px solid var(--border-hairline, rgba(255,255,255,0.04))",
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {wf.name}
        </span>
        <StatusBadge status={wf.status} />
      </div>

      {wf.taskSummary && wf.taskSummary.total > 0 && (
        <div style={{ marginTop: 6 }}>
          <ProgressBar summary={wf.taskSummary} />
          <div
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              marginTop: 4,
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <span>
              {wf.taskSummary.completed}/{wf.taskSummary.total} tasks
            </span>
            <span>{formatDate(wf.updated_at)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────

function HistoryContent() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || "";
  const { t } = useI18n();

  const [workflows, setWorkflows] = useState<WorkflowListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [execution, setExecution] = useState<ExecutionData | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Load workflow list
  useEffect(() => {
    if (!workspaceId) return;
    setLoadingList(true);
    fetch(`/api/workflows?workspaceId=${encodeURIComponent(workspaceId)}&includeSummary=true`)
      .then((r) => r.json())
      .then((data) => {
        setWorkflows(data.workflows || []);
      })
      .catch(() => {})
      .finally(() => setLoadingList(false));
  }, [workspaceId]);

  // Load execution detail when selected
  const loadExecution = useCallback((id: string) => {
    setSelectedId(id);
    setLoadingDetail(true);
    setExecution(null);
    fetch(`/api/workflows/${encodeURIComponent(id)}/executions`)
      .then((r) => r.json())
      .then((data) => setExecution(data))
      .catch(() => {})
      .finally(() => setLoadingDetail(false));
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Top bar */}
      <div
        style={{
          height: 44,
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: 12,
        }}
      >
        <Link href={ROUTES.HOME} style={{ fontSize: 12, color: "var(--text-dim)", textDecoration: "none" }}>
          ← Home
        </Link>
        <div
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: "var(--cyan)",
            fontFamily: "var(--font-display)",
          }}
        >
          EXECUTION HISTORY
        </div>
        <div style={{ flex: 1 }} />
        {execution && (
          <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
            {execution.summary.totalDuration > 0
              ? `Total: ${formatDuration(execution.summary.totalDuration)}`
              : ""}
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: Workflow list */}
        <div
          style={{
            width: 300,
            borderRight: "1px solid var(--border)",
            background: "var(--bg-panel)",
            overflow: "auto",
          }}
        >
          {loadingList ? (
            <div style={{ padding: 20, textAlign: "center" }}>
              <Loading />
            </div>
          ) : workflows.length === 0 ? (
            <div
              style={{
                padding: 20,
                textAlign: "center",
                color: "var(--text-dim)",
                fontSize: 12,
              }}
            >
              No workflows found
            </div>
          ) : (
            workflows.map((wf) => (
              <WorkflowItem
                key={wf.id}
                wf={wf}
                selected={selectedId === wf.id}
                onClick={() => loadExecution(wf.id)}
              />
            ))
          )}
        </div>

        {/* Right: Execution detail */}
        <div style={{ flex: 1, overflow: "auto", background: "var(--bg-void)" }}>
          {!selectedId ? (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-dim)",
                fontSize: 13,
              }}
            >
              Select a workflow to view execution details
            </div>
          ) : loadingDetail ? (
            <div style={{ padding: 40, textAlign: "center" }}>
              <Loading />
            </div>
          ) : execution ? (
            <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
              {/* Workflow header */}
              <div style={{ marginBottom: 24 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 8,
                  }}
                >
                  <h2
                    style={{
                      fontSize: 18,
                      fontWeight: 700,
                      color: "var(--text-primary)",
                      margin: 0,
                    }}
                  >
                    {execution.workflow.name}
                  </h2>
                  <StatusBadge status={execution.workflow.status} />
                </div>
                {execution.workflow.description && (
                  <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 12 }}>
                    {execution.workflow.description}
                  </div>
                )}

                {/* Summary stats */}
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-dim)",
                  }}
                >
                  <span>
                    <span style={{ color: "var(--green)" }}>{execution.summary.completed}</span> completed
                  </span>
                  {execution.summary.failed > 0 && (
                    <span>
                      <span style={{ color: "var(--red)" }}>{execution.summary.failed}</span> failed
                    </span>
                  )}
                  {execution.summary.inProgress > 0 && (
                    <span>
                      <span style={{ color: "var(--cyan)" }}>{execution.summary.inProgress}</span> running
                    </span>
                  )}
                  <span>{execution.summary.pending} pending</span>
                  {execution.summary.totalDuration > 0 && (
                    <span>Total: {formatDuration(execution.summary.totalDuration)}</span>
                  )}
                </div>
              </div>

              {/* Task timeline */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {execution.tasks.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>

              {execution.tasks.length === 0 && (
                <div
                  style={{
                    textAlign: "center",
                    padding: 40,
                    color: "var(--text-dim)",
                    fontSize: 12,
                  }}
                >
                  No tasks in this workflow
                </div>
              )}
            </div>
          ) : (
            <div
              style={{
                padding: 40,
                textAlign: "center",
                color: "var(--text-dim)",
                fontSize: 12,
              }}
            >
              Failed to load execution data
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            height: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--text-dim)",
          }}
        >
          Loading history...
        </div>
      }
    >
      <HistoryContent />
    </Suspense>
  );
}

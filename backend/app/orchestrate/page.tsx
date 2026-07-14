"use client";

import { memo, useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Play, Plus, GitBranch, Zap, Clock } from "lucide-react";
import { Button, Card } from "@/components/ui";
import { useI18n } from "@/lib/i18n/context";
import { ROUTES } from "../_components/routes";

type Workflow = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused";
  createdAt: string;
  taskCount?: number;
  completedCount?: number;
};

function OrchestrateContent() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId");

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadWorkflows() {
      try {
        const url = workspaceId
          ? `/api/workflows?workspaceId=${encodeURIComponent(workspaceId)}&includeSummary=true`
          : "/api/workflows?includeSummary=true";
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setWorkflows(data.workflows ?? []);
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    loadWorkflows();
  }, [workspaceId]);

  const stats = useMemo(() => {
    const active = workflows.filter((w) => w.status === "active").length;
    const draft = workflows.filter((w) => w.status === "draft").length;
    const paused = workflows.filter((w) => w.status === "paused").length;
    return { active, draft, paused, total: workflows.length };
  }, [workflows]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-xl font-bold text-text">{t("orchestrate.title")}</h1>
          <p className="text-sm text-text-secondary mt-1">{t("orchestrate.subtitle")}</p>
        </div>
        <Link href={ROUTES.WORKFLOW}>
          <Button variant="primary">
            <Plus size={16} className="mr-1" />
            {t("orchestrate.new")}
          </Button>
        </Link>
      </header>

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-4 px-6 py-4 shrink-0">
        <StatCard icon={<Play size={20} />} label={t("orchestrate.active")} value={stats.active} color="var(--green)" />
        <StatCard icon={<Clock size={20} />} label={t("orchestrate.draft")} value={stats.draft} color="var(--text-dim)" />
        <StatCard icon={<GitBranch size={20} />} label={t("orchestrate.paused")} value={stats.paused} color="var(--amber)" />
        <StatCard icon={<Zap size={20} />} label={t("orchestrate.total")} value={stats.total} color="var(--cyan)" />
      </div>

      {/* Workflow list */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="text-center py-12 text-text-secondary">{t("common.loading")}</div>
        ) : workflows.length === 0 ? (
          <EmptyState onCreate={() => window.location.href = ROUTES.WORKFLOW} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {workflows.map((wf) => (
              <WorkflowCard key={wf.id} workflow={wf} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <Card padding="16px">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-md" style={{ background: `${color}20`, color }}>
          {icon}
        </div>
        <div>
          <div className="text-2xl font-bold text-text">{value}</div>
          <div className="text-xs text-text-secondary">{label}</div>
        </div>
      </div>
    </Card>
  );
}

function WorkflowCard({ workflow }: { workflow: Workflow }) {
  const { t } = useI18n();
  const statusColor = {
    active: "var(--green)",
    draft: "var(--text-dim)",
    paused: "var(--amber)",
  }[workflow.status];

  const progress = workflow.taskCount
    ? Math.round(((workflow.completedCount ?? 0) / workflow.taskCount) * 100)
    : 0;

  return (
    <Link href={`${ROUTES.WORKFLOW}?workflowId=${workflow.id}`} className="no-underline">
      <Card hoverable padding="16px">
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-sm font-semibold text-text truncate flex-1">{workflow.name}</h3>
          <span
            className="text-xs px-2 py-0.5 rounded-full ml-2 shrink-0"
            style={{ background: `${statusColor}20`, color: statusColor }}
          >
            {t(`orchestrate.status.${workflow.status}`)}
          </span>
        </div>

        {workflow.taskCount ? (
          <div className="mb-2">
            <div className="flex justify-between text-xs text-text-secondary mb-1">
              <span>{t("orchestrate.progress")}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="text-xs text-text-dim">
          {new Date(workflow.createdAt).toLocaleDateString()}
        </div>
      </Card>
    </Link>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-16 h-16 rounded-full bg-surface-2 flex items-center justify-center mb-4">
        <GitBranch size={32} className="text-text-dim" />
      </div>
      <h3 className="text-lg font-semibold text-text mb-2">{t("orchestrate.empty_title")}</h3>
      <p className="text-sm text-text-secondary mb-6 max-w-md">
        {t("orchestrate.empty_desc")}
      </p>
      <Button variant="primary" onClick={onCreate}>
        <Plus size={16} className="mr-1" />
        {t("orchestrate.create_first")}
      </Button>
    </div>
  );
}

export default function OrchestratePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-full">Loading...</div>}>
      <OrchestrateContent />
    </Suspense>
  );
}

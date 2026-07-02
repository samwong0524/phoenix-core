"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { corporateVariants } from "@/lib/motion";
import dynamic from "next/dynamic";

const WorkflowCanvas = dynamic(
  () => import("../_components/workflow/WorkflowCanvas").then((m) => ({ default: m.default })),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex items-center justify-center text-text-dim text-[13px]">
        Loading canvas...
      </div>
    ),
  }
);
import { useWorkflowStore, type WorkflowState } from "../_components/workflow/store";
import { Button } from "@/components/ui";
import { ROUTES, templatesUrl } from "@/app/_components/routes";
import { useI18n } from "@/lib/i18n/context";

/* ── Save-as-Template modal ── */

function SaveAsTemplateModal({
  open,
  workflowName,
  workflowDescription,
  onClose,
  onSaved,
}: {
  open: boolean;
  workflowName: string;
  workflowDescription: string;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(workflowName);
  const [desc, setDesc] = useState(workflowDescription);
  const [icon, setIcon] = useState("📋");
  const [category, setCategory] = useState("general");
  const [saving, setSaving] = useState(false);

  const toDSL = useWorkflowStore((s) => s.toDSL);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const dsl = toDSL();
      const res = await fetch("/api/workflow-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || workflowName, description: desc || workflowDescription, icon, category, dsl }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      onSaved(t("workflow.saved"));
      onClose();
    } catch (e) {
      onSaved(e instanceof Error ? e.message : t("workflow.save_failed"));
    } finally {
      setSaving(false);
    }
  }, [toDSL, name, desc, icon, category, workflowName, workflowDescription, onClose, onSaved, t]);

  const categories = [
    { value: "general", label: t("workflow.tpl_cat_general") },
    { value: "research", label: t("workflow.tpl_cat_research") },
    { value: "development", label: t("workflow.tpl_cat_development") },
    { value: "content", label: t("workflow.tpl_cat_content") },
    { value: "operations", label: t("workflow.tpl_cat_operations") },
  ];

  const labelCls = "text-[10px] font-bold text-text-dim uppercase tracking-[0.08em] block mb-1";
  const inputCls = "w-full px-2.5 py-1.5 text-xs text-text bg-card border border-border rounded-md outline-none box-border";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center"
          variants={corporateVariants.modalOverlay}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={onClose}
        >
          <motion.div
            className="bg-panel border border-border rounded-xl p-6 w-[380px] max-w-[90vw]"
            variants={corporateVariants.modalPanel}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
        <div className="text-sm font-bold text-text mb-4">
          {t("workflow.tpl_title")}
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className={labelCls}>{t("workflow.tpl_name")}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>{t("workflow.tpl_desc")}</label>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className={`${inputCls} resize-y`} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className={labelCls}>{t("workflow.tpl_icon")}</label>
              <input value={icon} onChange={(e) => setIcon(e.target.value)} className={`${inputCls} text-base`} />
            </div>
            <div className="flex-[2]">
              <label className={labelCls}>{t("workflow.tpl_category")}</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end mt-5">
          <Button variant="ghost" onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={() => void handleSave()} disabled={saving}>
            {saving ? t("workflow.tpl_saving") : t("workflow.tpl_save")}
          </Button>
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Main editor ── */

function WorkflowEditor() {
  const searchParams = useSearchParams();
  const { t } = useI18n();
  const workspaceId = searchParams.get("workspaceId") || "";
  const workflowId = searchParams.get("workflowId");

  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);

  const workflowName = useWorkflowStore((s) => s.workflowName);
  const workflowDescription = useWorkflowStore((s) => s.workflowDescription);
  const setWorkflowMeta = useWorkflowStore((s) => s.setWorkflowMeta);
  const setAvailableRoles = useWorkflowStore((s) => s.setAvailableRoles);
  const loadFromDSL = useWorkflowStore((s) => s.loadFromDSL);
  const toDSL = useWorkflowStore((s) => s.toDSL);
  const resetExecutionStatus = useWorkflowStore((s) => s.resetExecutionStatus);

  // Load workspace agents for role selection
  useEffect(() => {
    if (!workspaceId) return;
    fetch(`/api/agents?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then((r) => r.json())
      .then((data) => {
        const roles = (data.agents || [])
          .map((a: Record<string, unknown>) => String(a.role ?? ""))
          .filter((r: string) => r && r !== "human")
          .filter((v: string, i: number, arr: string[]) => arr.indexOf(v) === i);
        setAvailableRoles(roles);
      })
      .catch(() => {});
  }, [workspaceId, setAvailableRoles]);

  // Load existing workflow if editing
  useEffect(() => {
    if (!workflowId) return;
    fetch(`/api/workflows/${encodeURIComponent(workflowId)}/dsl`)
      .then((r) => r.json())
      .then((data) => {
        if (data.dsl) {
          loadFromDSL(data.dsl);
          setWorkflowMeta({
            id: data.workflow.id,
            name: data.workflow.name,
            description: data.workflow.description || "",
            status: data.workflow.status,
          });
        }
      })
      .catch(() => {});
  }, [workflowId, loadFromDSL, setWorkflowMeta]);

  // SSE subscription for pipeline execution events
  const connectionTimeRef = useRef(Date.now());
  const setExecutionStatus = useWorkflowStore((s: WorkflowState) => s.setExecutionStatus);

  useEffect(() => {
    if (!workspaceId) return;
    const currentStatus = useWorkflowStore.getState().workflowStatus;
    if (currentStatus !== "active") return;

    connectionTimeRef.current = Date.now();
    const es = new EventSource(
      `/api/ui-stream?workspaceId=${encodeURIComponent(workspaceId)}`
    );

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as {
          event: string;
          data: Record<string, unknown>;
        };

        if (event.data && typeof event.data === "object" && "at" in event.data) {
          const eventTime = event.data.at as number;
          if (eventTime < connectionTimeRef.current) return;
        }

        const d = event.data;
        switch (event.event) {
          case "pipeline.stage_start": {
            const nodeId = d.nodeId as string;
            if (nodeId) setExecutionStatus(nodeId, "running");
            break;
          }
          case "pipeline.stage_complete": {
            const nodeId = d.nodeId as string;
            const status = d.status as string;
            if (nodeId) {
              setExecutionStatus(
                nodeId,
                status === "completed" ? "completed" : "failed"
              );
            }
            break;
          }
          case "pipeline.complete": {
            setRunning(false);
            const overallStatus = d.overallStatus as string;
            const failedTasks = d.failedTasks as number;
            setMessage(
              overallStatus === "completed"
                ? t("workflow.completed")
                : t("workflow.finished_errors", { n: String(failedTasks) })
            );
            break;
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {};

    return () => {
      es.close();
    };
  }, [workspaceId, setExecutionStatus, t]);

  // Save workflow
  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const dsl = toDSL();

      const groupsRes = await fetch(
        `/api/groups?workspaceId=${encodeURIComponent(workspaceId)}`
      );
      const groupsData = await groupsRes.json();
      const groupId = groupsData.groups?.[0]?.id;
      if (!groupId) throw new Error("No group found for workspace");

      const agentsRes = await fetch(
        `/api/agents?workspaceId=${encodeURIComponent(workspaceId)}`
      );
      const agentsData = await agentsRes.json();
      const humanAgent = (agentsData.agents || []).find(
        (a: Record<string, unknown>) => a.role === "human"
      );
      const creatorId = humanAgent?.id;
      if (!creatorId) throw new Error("No human agent found");

      if (workflowId && useWorkflowStore.getState().workflowId) {
        const res = await fetch(
          `/api/workflows/${encodeURIComponent(workflowId)}/dsl`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: workflowName,
              description: workflowDescription,
              dsl,
            }),
          }
        );
        if (!res.ok) throw new Error(`${res.status}`);
        setMessage(t("workflow.saved"));
      } else {
        const res = await fetch("/api/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            groupId,
            name: workflowName,
            description: workflowDescription,
            creatorId,
            dsl,
          }),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        setWorkflowMeta({ id: data.workflowId });
        setMessage(t("workflow.created"));
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("workflow.save_failed"));
    } finally {
      setSaving(false);
    }
  }

  // Run workflow (activate)
  async function handleRun() {
    const wfId = useWorkflowStore.getState().workflowId;
    if (!wfId) {
      setMessage(t("workflow.save_first"));
      return;
    }
    setRunning(true);
    setMessage(null);
    resetExecutionStatus();
    connectionTimeRef.current = Date.now();
    try {
      const res = await fetch(
        `/api/workflows/${encodeURIComponent(wfId)}/activate`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error(`${res.status}`);
      setWorkflowMeta({ status: "active" });
      setMessage(t("workflow.activated"));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : t("workflow.save_failed"));
      setRunning(false);
    }
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Top bar */}
      <div className="h-11 border-b border-border bg-panel flex items-center px-4 gap-3">
        <Link
          href={ROUTES.HOME}
          className="text-xs text-text-dim no-underline"
        >
          {t("common.back_home")}
        </Link>
        <div className="text-[13px] font-bold text-primary font-[family-name:var(--font-display)]">
          {t("workflow.editor_title")}
        </div>
        <div className="flex-1" />
        {message && (
          <span
            className="text-[11px]"
            style={{
              color:
                message.includes("failed") || message.includes(t("workflow.save_first"))
                  ? "var(--red-text)"
                  : "var(--green)",
            }}
          >
            {message}
          </span>
        )}
        <Link
          href={templatesUrl(workspaceId || undefined)}
          className="text-[11px] text-text-dim no-underline font-[family-name:var(--font-mono)]"
        >
          {t("workflow.templates")}
        </Link>
        <Button
          variant="ghost"
          onClick={() => setShowSaveAsTemplate(true)}
          disabled={!useWorkflowStore.getState().workflowId}
          className="text-[11px]"
        >
          {t("workflow.save_as_template")}
        </Button>
        <Button
          variant="primary"
          onClick={() => void handleSave()}
          disabled={saving || running}
        >
          {saving ? t("workflow.saving") : t("common.save")}
        </Button>
        <Button
          variant="ghost"
          onClick={() => void handleRun()}
          disabled={running || !useWorkflowStore.getState().workflowId}
          style={running ? {
            color: "var(--cyan)",
            animation: "pulse 1.5s ease-in-out infinite",
          } : undefined}
        >
          {running ? t("workflow.running") : t("workflow.run")}
        </Button>
      </div>

      {/* Save as Template dialog */}
      <SaveAsTemplateModal
        open={showSaveAsTemplate}
        workflowName={workflowName}
        workflowDescription={workflowDescription}
        onClose={() => setShowSaveAsTemplate(false)}
        onSaved={setMessage}
      />

      {/* Canvas */}
      <div className="flex-1">
        <WorkflowCanvas />
      </div>
    </div>
  );
}

export default function WorkflowPage() {
  const { t } = useI18n();
  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center text-text-dim">
          {t("workflow.loading")}
        </div>
      }
    >
      <WorkflowEditor />
    </Suspense>
  );
}

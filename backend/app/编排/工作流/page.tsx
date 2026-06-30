"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import WorkflowCanvas from "../../_components/workflow/WorkflowCanvas";
import { useWorkflowStore, type WorkflowState } from "../../_components/workflow/store";
import { Button } from "@/components/ui";
import { ROUTES, templatesUrl } from "@/app/_components/routes";

function WorkflowEditor() {
  const searchParams = useSearchParams();
  const workspaceId = searchParams.get("workspaceId") || "";
  const workflowId = searchParams.get("workflowId");

  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplDesc, setTplDesc] = useState("");
  const [tplIcon, setTplIcon] = useState("📋");
  const [tplCategory, setTplCategory] = useState("general");
  const [savingTemplate, setSavingTemplate] = useState(false);

  const workflowName = useWorkflowStore((s) => s.workflowName);
  const workflowDescription = useWorkflowStore((s) => s.workflowDescription);
  const workflowStatus = useWorkflowStore((s) => s.workflowStatus);
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
          .map((a: any) => a.role)
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

        // Skip replayed history events
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
            setMessage(
              overallStatus === "completed"
                ? "Workflow completed successfully!"
                : `Workflow finished with errors (${d.failedTasks} failed tasks)`
            );
            break;
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // EventSource will auto-reconnect
    };

    return () => {
      es.close();
    };
  }, [workspaceId, setExecutionStatus]);

  // Save workflow
  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const dsl = toDSL();

      // Get group ID for this workspace
      const groupsRes = await fetch(
        `/api/groups?workspaceId=${encodeURIComponent(workspaceId)}`
      );
      const groupsData = await groupsRes.json();
      const groupId = groupsData.groups?.[0]?.id;
      if (!groupId) throw new Error("No group found for workspace");

      // Get human agent ID as creator
      const agentsRes = await fetch(
        `/api/agents?workspaceId=${encodeURIComponent(workspaceId)}`
      );
      const agentsData = await agentsRes.json();
      const humanAgent = (agentsData.agents || []).find(
        (a: any) => a.role === "human"
      );
      const creatorId = humanAgent?.id;
      if (!creatorId) throw new Error("No human agent found");

      if (workflowId && useWorkflowStore.getState().workflowId) {
        // Update existing
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
        if (!res.ok) throw new Error(`Save failed: ${res.status}`);
        setMessage("Saved!");
      } else {
        // Create new
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
        if (!res.ok) throw new Error(`Create failed: ${res.status}`);
        const data = await res.json();
        setWorkflowMeta({ id: data.workflowId });
        setMessage("Created!");
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // Run workflow (activate)
  async function handleRun() {
    const wfId = useWorkflowStore.getState().workflowId;
    if (!wfId) {
      setMessage("Save the workflow first");
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
      if (!res.ok) throw new Error(`Activate failed: ${res.status}`);
      setWorkflowMeta({ status: "active" });
      setMessage("Workflow activated! Watching execution...");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Run failed");
      setRunning(false);
    }
  }

  // Save as template
  async function handleSaveAsTemplate() {
    setSavingTemplate(true);
    setMessage(null);
    try {
      const dsl = toDSL();
      const res = await fetch("/api/workflow-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tplName || workflowName,
          description: tplDesc || workflowDescription,
          icon: tplIcon,
          category: tplCategory,
          dsl,
        }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setMessage("Saved as template!");
      setShowSaveAsTemplate(false);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save template failed");
    } finally {
      setSavingTemplate(false);
    }
  }

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
        <Link
          href={ROUTES.HOME}
          style={{
            fontSize: 12,
            color: "var(--text-dim)",
            textDecoration: "none",
          }}
        >
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
          WORKFLOW EDITOR
        </div>
        <div style={{ flex: 1 }} />
        {message && (
          <span
            style={{
              fontSize: 11,
              color:
                message.includes("failed") || message.includes("Save the")
                  ? "var(--red-text)"
                  : "var(--green)",
            }}
          >
            {message}
          </span>
        )}
        <Link
          href={templatesUrl(workspaceId || undefined)}
          style={{ fontSize: 11, color: "var(--text-dim)", textDecoration: "none", fontFamily: "var(--font-mono)" }}
        >
          Templates
        </Link>
        <Button
          variant="ghost"
          onClick={() => {
            setTplName(workflowName);
            setTplDesc(workflowDescription);
            setShowSaveAsTemplate(true);
          }}
          disabled={!useWorkflowStore.getState().workflowId}
          style={{ fontSize: 11 }}
        >
          Save as Template
        </Button>
        <Button
          variant="primary"
          onClick={() => void handleSave()}
          disabled={saving || running}
        >
          {saving ? "Saving..." : "Save"}
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
          {running ? "● Running..." : "Run"}
        </Button>
      </div>

      {/* Save as Template dialog */}
      {showSaveAsTemplate && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }} onClick={() => setShowSaveAsTemplate(false)}>
          <div
            style={{
              background: "var(--bg-panel)", border: "1px solid var(--border)",
              borderRadius: 12, padding: 24, width: 380, maxWidth: "90vw",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 16 }}>
              Save as Template
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 4 }}>Name</label>
                <input value={tplName} onChange={(e) => setTplName(e.target.value)} style={{ width: "100%", padding: "6px 10px", fontSize: 12, color: "var(--text-primary)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 4 }}>Description</label>
                <textarea value={tplDesc} onChange={(e) => setTplDesc(e.target.value)} rows={2} style={{ width: "100%", padding: "6px 10px", fontSize: 12, color: "var(--text-primary)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, outline: "none", boxSizing: "border-box", resize: "vertical" }} />
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 4 }}>Icon</label>
                  <input value={tplIcon} onChange={(e) => setTplIcon(e.target.value)} style={{ width: "100%", padding: "6px 10px", fontSize: 16, color: "var(--text-primary)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: 2 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 4 }}>Category</label>
                  <select value={tplCategory} onChange={(e) => setTplCategory(e.target.value)} style={{ width: "100%", padding: "6px 10px", fontSize: 12, color: "var(--text-primary)", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 6, outline: "none", boxSizing: "border-box" }}>
                    <option value="general">General</option>
                    <option value="research">Research</option>
                    <option value="development">Development</option>
                    <option value="content">Content</option>
                    <option value="operations">Operations</option>
                  </select>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 20 }}>
              <Button variant="ghost" onClick={() => setShowSaveAsTemplate(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => void handleSaveAsTemplate()} disabled={savingTemplate}>
                {savingTemplate ? "Saving..." : "Save Template"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Canvas */}
      <div style={{ flex: 1 }}>
        <WorkflowCanvas />
      </div>
    </div>
  );
}

export default function WorkflowPage() {
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
          Loading workflow editor...
        </div>
      }
    >
      <WorkflowEditor />
    </Suspense>
  );
}

"use client";

import { useWorkflowStore } from "./store";
import type { AgentNodeData, ConditionNodeData } from "@/lib/workflow-types";

export default function PropertiesPanel() {
  const selectedNodeId = useWorkflowStore((s) => s.selectedNodeId);
  const nodes = useWorkflowStore((s) => s.nodes);
  const availableRoles = useWorkflowStore((s) => s.availableRoles);
  const workflowName = useWorkflowStore((s) => s.workflowName);
  const workflowDescription = useWorkflowStore((s) => s.workflowDescription);
  const workflowStatus = useWorkflowStore((s) => s.workflowStatus);
  const updateAgentData = useWorkflowStore((s) => s.updateAgentData);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const setWorkflowMeta = useWorkflowStore((s) => s.setWorkflowMeta);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const isAgentSelected = selectedNode?.type === "agent";
  const isConditionSelected = selectedNode?.type === "condition";
  const agentData = isAgentSelected ? (selectedNode.data as AgentNodeData) : null;
  const condData = isConditionSelected ? (selectedNode.data as ConditionNodeData) : null;

  return (
    <div className="w-[280px] border-l border-border bg-panel flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3.5 py-3 border-b border-border text-[11px] font-bold text-primary font-[family-name:var(--font-display)] uppercase tracking-[0.1em]">
        {isAgentSelected ? "Agent Properties" : isConditionSelected ? "Condition" : "Workflow"}
      </div>

      <div className="p-3.5 overflow-y-auto flex-1">
        {isAgentSelected && agentData ? (
          /* ── Agent node selected ─────────────────────────── */
          <AgentProperties
            nodeId={selectedNodeId!}
            data={agentData}
            availableRoles={availableRoles}
            updateAgentData={updateAgentData}
          />
        ) : isConditionSelected && condData ? (
          /* ── Condition node selected ─────────────────────── */
          <ConditionProperties
            nodeId={selectedNodeId!}
            data={condData}
            updateNodeData={updateNodeData}
          />
        ) : (
          /* ── No node selected — show workflow meta ──────── */
          <WorkflowMeta
            name={workflowName}
            description={workflowDescription}
            status={workflowStatus}
            setWorkflowMeta={setWorkflowMeta}
          />
        )}
      </div>
    </div>
  );
}

// ── Shared class names ──────────────────────────────────────────

const labelClass = "block text-[10px] font-bold text-text-dim uppercase tracking-[0.08em] mb-1";

const inputClass = "w-full px-2.5 py-1.5 text-xs text-text bg-card border border-border rounded-sm outline-none box-border";

const selectClass = `${inputClass} cursor-pointer`;

// ── Status color helper ────────────────────────────────────────

function statusColorClass(status?: string): string {
  switch (status) {
    case "running": return "text-primary";
    case "completed": return "text-green";
    case "failed": return "text-red";
    default: return "text-text-dim";
  }
}

// ── Sub-components ─────────────────────────────────────────────

function AgentProperties({
  nodeId,
  data,
  availableRoles,
  updateAgentData,
}: {
  nodeId: string;
  data: AgentNodeData;
  availableRoles: string[];
  updateAgentData: (id: string, d: Partial<AgentNodeData>) => void;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <label className={labelClass}>Role</label>
        <select
          value={data.role}
          onChange={(e) => updateAgentData(nodeId, { role: e.target.value })}
          className={selectClass}
        >
          {(availableRoles.length > 0
            ? availableRoles
            : ["assistant", "coordinator", "researcher", "creator", "reviewer", "specialist"]
          ).map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Name</label>
        <input
          value={data.label}
          onChange={(e) => updateAgentData(nodeId, { label: e.target.value })}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Task Description</label>
        <textarea
          value={data.description || ""}
          onChange={(e) => updateAgentData(nodeId, { description: e.target.value })}
          placeholder="What should this agent do?"
          rows={3}
          className={`${inputClass} resize-y`}
        />
      </div>
      <div>
        <label className={labelClass}>Expected Output</label>
        <textarea
          value={data.expectedOutput || ""}
          onChange={(e) => updateAgentData(nodeId, { expectedOutput: e.target.value })}
          placeholder="What should the agent produce?"
          rows={2}
          className={`${inputClass} resize-y`}
        />
      </div>
      <div>
        <label className={labelClass}>Status</label>
        <div className={`text-xs font-[family-name:var(--font-mono)] ${statusColorClass(data.executionStatus)}`}>
          {data.executionStatus?.toUpperCase() || "IDLE"}
        </div>
      </div>
    </div>
  );
}

function ConditionProperties({
  nodeId,
  data,
  updateNodeData,
}: {
  nodeId: string;
  data: ConditionNodeData;
  updateNodeData: (id: string, d: Record<string, unknown>) => void;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <label className={labelClass}>Name</label>
        <input
          value={data.label}
          onChange={(e) => updateNodeData(nodeId, { label: e.target.value })}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Condition</label>
        <textarea
          value={data.condition}
          onChange={(e) => updateNodeData(nodeId, { condition: e.target.value })}
          placeholder="e.g. result.contains('approved') or upstream.score > 0.8"
          rows={4}
          className={`${inputClass} resize-y font-[family-name:var(--font-mono)] text-[11px]`}
        />
      </div>
      <div>
        <label className={labelClass}>Input Variable (optional)</label>
        <input
          value={data.inputVariable || ""}
          onChange={(e) => updateNodeData(nodeId, { inputVariable: e.target.value })}
          placeholder="e.g. upstream.researcher.output"
          className={inputClass}
        />
        <div className="text-[10px] text-text-dim mt-1 leading-normal">
          Reference an upstream agent&apos;s output to evaluate the condition against.
        </div>
      </div>
      <div>
        <label className={labelClass}>Branches</label>
        <div className="text-[11px] text-text-dim leading-relaxed">
          <span className="text-green font-semibold">Right</span> = true branch
          <br />
          <span className="text-red font-semibold">Bottom</span> = false branch
        </div>
      </div>
      <div>
        <label className={labelClass}>Status</label>
        <div className={`text-xs font-[family-name:var(--font-mono)] ${statusColorClass(data.executionStatus)}`}>
          {data.executionStatus?.toUpperCase() || "IDLE"}
        </div>
      </div>
    </div>
  );
}

function WorkflowMeta({
  name,
  description,
  status,
  setWorkflowMeta,
}: {
  name: string;
  description: string;
  status: string;
  setWorkflowMeta: (meta: { name?: string; description?: string; status?: "draft" | "active" | "paused" }) => void;
}) {
  const statusClass =
    status === "active"
      ? "text-green"
      : status === "paused"
        ? "text-yellow"
        : "text-text-dim";

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <label className={labelClass}>Workflow Name</label>
        <input
          value={name}
          onChange={(e) => setWorkflowMeta({ name: e.target.value })}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Description</label>
        <textarea
          value={description}
          onChange={(e) => setWorkflowMeta({ description: e.target.value })}
          placeholder="What does this workflow do?"
          rows={3}
          className={`${inputClass} resize-y`}
        />
      </div>
      <div>
        <label className={labelClass}>Status</label>
        <div className={`text-xs font-[family-name:var(--font-mono)] ${statusClass}`}>
          {status.toUpperCase()}
        </div>
      </div>
      <div className="mt-2 p-3 bg-card rounded-[8px] border border-border">
        <div className="text-[11px] text-text-dim leading-relaxed">
          Drag agent or condition nodes from the left panel onto the canvas.
          Connect them by dragging between handles.
          Condition nodes branch into true (right) and false (bottom) paths.
        </div>
      </div>
    </div>
  );
}

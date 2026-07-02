"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui";
import { ROUTES, workflowUrl } from "./routes";

// ── Types ────────────────────────────────────────────────────────

interface TemplateRecord {
  id: string;
  name: string;
  description: string | null;
  icon: string;
  category: string;
  tags: string[];
  nodeCount: number;
  edgeCount: number;
  usageCount: number;
  isBuiltin: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TemplateDetail extends TemplateRecord {
  dsl: {
    nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
    edges: Array<{ id: string; source: string; target: string; branchLabel?: string }>;
  };
}

const CATEGORIES = [
  { key: "all", label: "All" },
  { key: "research", label: "Research" },
  { key: "development", label: "Development" },
  { key: "content", label: "Content" },
  { key: "operations", label: "Operations" },
  { key: "general", label: "General" },
];

const CATEGORY_COLORS: Record<string, string> = {
  research: "#a855f7",
  development: "#06b6d4",
  content: "#f59e0b",
  operations: "#ef4444",
  general: "#6b7280",
};

// ── Main Component ───────────────────────────────────────────────

export default function WorkflowTemplateGallery() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const workspaceId = searchParams.get("workspaceId") || "";

  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<TemplateDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      if (search) params.set("search", search);
      const res = await fetch(`/api/workflow-templates?${params}`);
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [category, search]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  async function handleSelectTemplate(tpl: TemplateRecord) {
    try {
      const res = await fetch(`/api/workflow-templates/${tpl.id}`);
      const data = await res.json();
      setSelected(data.template);
    } catch {
      // silent
    }
  }

  async function handleUseTemplate() {
    if (!selected || !workspaceId) {
      setError("No workspace selected. Go to the workflow editor first.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      // Get a creator agent ID from the workspace
      const agentsRes = await fetch(`/api/agents?workspaceId=${encodeURIComponent(workspaceId)}`);
      const agentsData = await agentsRes.json();
      const creator = (agentsData.agents || []).find((a: Record<string, unknown>) => a.role !== "human");
      if (!creator) throw new Error("No agent found in workspace");

      // Get the default group
      const groupsRes = await fetch(`/api/groups?workspaceId=${encodeURIComponent(workspaceId)}`);
      const groupsData = await groupsRes.json();
      const group = (groupsData.groups || [])[0];
      if (!group) throw new Error("No group found in workspace");

      const res = await fetch(`/api/workflow-templates/${selected.id}/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: group.id,
          name: selected.name,
          creatorId: creator.id,
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      router.push(workflowUrl({ workspaceId, workflowId: data.workflow.id }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  // ── Detail panel ─────────────────────────────────────────────

  if (selected) {
    const agentNodes = selected.dsl.nodes.filter((n) => n.type === "agent" || n.type === "condition");
    return (
      <div className="p-6 max-w-[720px] mx-auto">
        <button
          onClick={() => setSelected(null)}
          className="bg-transparent border-0 text-primary cursor-pointer text-[13px] mb-4 font-[family-name:var(--font-mono)]"
        >
          &larr; Back to templates
        </button>

        <div className="flex items-center gap-4 mb-5">
          <span className="text-5xl">{selected.icon}</span>
          <div>
            <h2 className="m-0 text-[22px] font-bold text-text">{selected.name}</h2>
            <div className="text-xs text-text-dim mt-1">
              {selected.category} &middot; {selected.nodeCount} nodes &middot; {selected.edgeCount} edges &middot; Used {selected.usageCount} times
            </div>
          </div>
        </div>

        <p className="text-sm text-text-secondary leading-[1.7] mb-6">
          {selected.description}
        </p>

        {/* Tags */}
        {selected.tags.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mb-6">
            {selected.tags.map((tag) => (
              <span key={tag} className="px-2.5 py-0.5 text-[11px] font-[family-name:var(--font-mono)] text-primary bg-primary-soft border border-border rounded-xl">
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Node list */}
        <div className="mb-6">
          <div className="text-[11px] font-bold text-text-dim uppercase tracking-[0.08em] mb-2.5">
            Steps
          </div>
          <div className="flex flex-col gap-1.5">
            {agentNodes.map((n, i) => (
              <div key={n.id} className="flex items-center gap-2.5 px-3 py-2 bg-card border border-border rounded-lg text-[13px]">
                <span
                  className="w-[22px] h-[22px] rounded-full text-black flex items-center justify-center text-[11px] font-bold shrink-0"
                  style={{ background: n.type === "condition" ? "#a855f7" : "var(--color-primary)" }}
                >
                  {n.type === "condition" ? "?" : i + 1}
                </span>
                <span className="font-semibold text-text">
                  {String(n.data.label || n.id)}
                </span>
                {n.type === "agent" && Boolean(n.data.role) && (
                  <span className="text-[11px] text-text-dim font-[family-name:var(--font-mono)]">
                    [{String(n.data.role)}]
                  </span>
                )}
                {n.type === "condition" && (
                  <span className="text-[11px] text-purple font-[family-name:var(--font-mono)]">
                    [condition]
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="px-3 py-2 bg-red-soft border border-red rounded-lg text-red text-xs mb-4">
            {error}
          </div>
        )}

        <Button onClick={handleUseTemplate} disabled={creating}>
          {creating ? "Creating..." : "Use Template"}
        </Button>
      </div>
    );
  }

  // ── Grid view ────────────────────────────────────────────────

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="m-0 text-xl font-bold text-text font-[family-name:var(--font-display)] tracking-[0.05em]">
            WORKFLOW TEMPLATES
          </h1>
          <p className="mt-1 text-xs text-text-dim">
            Reusable workflow blueprints. Pick a template to get started.
          </p>
        </div>
        <Link href={workflowUrl(workspaceId ? { workspaceId } : undefined)}>
          <Button variant="ghost">Back to Editor</Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-2 items-center mb-5 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setCategory(cat.key)}
            className={`px-3.5 py-1 text-[11px] font-semibold font-[family-name:var(--font-mono)] uppercase tracking-[0.05em] rounded-2xl cursor-pointer border ${
              category === cat.key
                ? "text-primary bg-primary-soft border-primary"
                : "text-text-dim bg-transparent border-border"
            }`}
          >
            {cat.label}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates..."
          className="ml-auto px-3 py-1 text-xs font-[family-name:var(--font-body)] text-text bg-card border border-border rounded-md outline-none w-[180px]"
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-center py-16 text-text-dim text-[13px]">Loading templates...</div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16 text-text-dim text-[13px]">No templates found.</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              onClick={() => handleSelectTemplate(tpl)}
              className="p-5 bg-card border border-border rounded-xl cursor-pointer transition-all hover:border-primary-dim hover:shadow-[0_2px_8px_rgba(0,0,0,0.15)]"
            >
              <div className="flex items-center gap-3 mb-2.5">
                <span className="text-[32px]">{tpl.icon}</span>
                <div className="flex-1">
                  <div className="text-sm font-bold text-text">{tpl.name}</div>
                  <div
                    className="text-[11px] font-[family-name:var(--font-mono)] uppercase"
                    style={{ color: CATEGORY_COLORS[tpl.category] || "var(--text-dim)" }}
                  >
                    {tpl.category}
                  </div>
                </div>
                {tpl.isBuiltin && (
                  <span className="text-[9px] px-1.5 py-px bg-primary-soft text-primary rounded-lg font-[family-name:var(--font-mono)]">
                    BUILTIN
                  </span>
                )}
              </div>
              <div className="text-xs text-text-dim leading-[1.5] mb-3 line-clamp-2">
                {tpl.description}
              </div>
              <div className="flex gap-3 text-[11px] text-text-dim font-[family-name:var(--font-mono)]">
                <span>{tpl.nodeCount} nodes</span>
                <span>{tpl.edgeCount} edges</span>
                <span className="ml-auto">{tpl.usageCount} uses</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

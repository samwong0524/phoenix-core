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
      const creator = (agentsData.agents || []).find((a: any) => a.role !== "human");
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
      <div style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}>
        <button
          onClick={() => setSelected(null)}
          style={{ background: "none", border: "none", color: "var(--cyan)", cursor: "pointer", fontSize: 13, marginBottom: 16, fontFamily: "var(--font-mono)" }}
        >
          &larr; Back to templates
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
          <span style={{ fontSize: 48 }}>{selected.icon}</span>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text-primary)" }}>{selected.name}</h2>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
              {selected.category} &middot; {selected.nodeCount} nodes &middot; {selected.edgeCount} edges &middot; Used {selected.usageCount} times
            </div>
          </div>
        </div>

        <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.7, marginBottom: 24 }}>
          {selected.description}
        </p>

        {/* Tags */}
        {selected.tags.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 24 }}>
            {selected.tags.map((tag) => (
              <span key={tag} style={{
                padding: "2px 10px",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "var(--cyan)",
                background: "rgba(0,240,255,0.08)",
                border: "1px solid var(--border)",
                borderRadius: 12,
              }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Node list */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
            Steps
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {agentNodes.map((n, i) => (
              <div key={n.id} style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 13,
              }}>
                <span style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: n.type === "condition" ? "#a855f7" : "var(--cyan)",
                  color: "#000",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}>
                  {n.type === "condition" ? "?" : i + 1}
                </span>
                <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                  {String(n.data.label || n.id)}
                </span>
                {n.type === "agent" && Boolean(n.data.role) && (
                  <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                    [{String(n.data.role)}]
                  </span>
                )}
                {n.type === "condition" && (
                  <span style={{ fontSize: 11, color: "#a855f7", fontFamily: "var(--font-mono)" }}>
                    [condition]
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.1)", border: "1px solid var(--red)", borderRadius: 8, color: "var(--red)", fontSize: 12, marginBottom: 16 }}>
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
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text-primary)", fontFamily: "var(--font-display)", letterSpacing: "0.05em" }}>
            WORKFLOW TEMPLATES
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-dim)" }}>
            Reusable workflow blueprints. Pick a template to get started.
          </p>
        </div>
        <Link href={workflowUrl(workspaceId ? { workspaceId } : undefined)}>
          <Button variant="ghost">Back to Editor</Button>
        </Link>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setCategory(cat.key)}
            style={{
              padding: "4px 14px",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
              color: category === cat.key ? "var(--cyan)" : "var(--text-dim)",
              background: category === cat.key ? "rgba(0,240,255,0.1)" : "transparent",
              border: `1px solid ${category === cat.key ? "var(--cyan)" : "var(--border)"}`,
              borderRadius: 16,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {cat.label}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates..."
          style={{
            marginLeft: "auto",
            padding: "4px 12px",
            fontSize: 12,
            fontFamily: "var(--font-body)",
            color: "var(--text-primary)",
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            outline: "none",
            width: 180,
          }}
        />
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-dim)", fontSize: 13 }}>Loading templates...</div>
      ) : templates.length === 0 ? (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-dim)", fontSize: 13 }}>No templates found.</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              onClick={() => handleSelectTemplate(tpl)}
              style={{
                padding: 20,
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                cursor: "pointer",
                transition: "border-color 0.15s, box-shadow 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--cyan-dim, var(--cyan))";
                (e.currentTarget as HTMLElement).style.boxShadow = "0 0 12px rgba(0,240,255,0.1)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
                (e.currentTarget as HTMLElement).style.boxShadow = "none";
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                <span style={{ fontSize: 32 }}>{tpl.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{tpl.name}</div>
                  <div style={{ fontSize: 11, color: CATEGORY_COLORS[tpl.category] || "var(--text-dim)", fontFamily: "var(--font-mono)", textTransform: "uppercase" }}>
                    {tpl.category}
                  </div>
                </div>
                {tpl.isBuiltin && (
                  <span style={{ fontSize: 9, padding: "1px 6px", background: "rgba(0,240,255,0.1)", color: "var(--cyan)", borderRadius: 8, fontFamily: "var(--font-mono)" }}>
                    BUILTIN
                  </span>
                )}
              </div>
              <div style={{
                fontSize: 12,
                color: "var(--text-dim)",
                lineHeight: 1.5,
                marginBottom: 12,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}>
                {tpl.description}
              </div>
              <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
                <span>{tpl.nodeCount} nodes</span>
                <span>{tpl.edgeCount} edges</span>
                <span style={{ marginLeft: "auto" }}>{tpl.usageCount} uses</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

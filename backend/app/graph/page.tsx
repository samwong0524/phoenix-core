"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card, Loading, EmptyState, Alert } from "@/components/ui";
import { ROUTES } from "@/app/_components/routes";

type UUID = string;

type WorkspaceDefaults = {
  workspaceId: UUID;
  humanAgentId: UUID;
  assistantAgentId: UUID;
  defaultGroupId: UUID;
};

type GraphNode = { id: UUID; role: string; parentId: UUID | null };
type GraphEdge = { from: UUID; to: UUID; count: number; lastSendTime: string };

const SESSION_KEY = "agent-wechat.session.v1";

function loadSession(): WorkspaceDefaults | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WorkspaceDefaults;
  } catch {
    return null;
  }
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

/* ── SVG Topology Visualization ── */

function TopologyGraph({
  nodes,
  edges,
  width,
  height,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

  // Circular layout
  const positions = useMemo(() => {
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.35;
    const pos = new Map<string, { x: number; y: number }>();
    const count = nodes.length;
    if (count === 0) return pos;
    if (count === 1) {
      pos.set(nodes[0].id, { x: cx, y: cy });
      return pos;
    }
    nodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      pos.set(n.id, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    });
    return pos;
  }, [nodes, width, height]);

  const roleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) map.set(n.id, n.role);
    return map;
  }, [nodes]);

  const maxCount = useMemo(() => Math.max(1, ...edges.map((e) => e.count)), [edges]);

  if (nodes.length === 0) return null;

  const nodeRadius = 24;
  const roleColors: Record<string, string> = {
    human: "#00f0ff",
    coordinator: "#a78bfa",
    researcher: "#34d399",
    developer: "#f59e0b",
    reviewer: "#f472b6",
    qa: "#fb923c",
    creator: "#38bdf8",
    editor: "#c084fc",
  };

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <defs>
        <marker
          id="arrowhead"
          markerWidth="8"
          markerHeight="6"
          refX="7"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill="var(--text-dim)" opacity={0.6} />
        </marker>
        <marker
          id="arrowhead-active"
          markerWidth="8"
          markerHeight="6"
          refX="7"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 8 3, 0 6" fill="var(--accent-cyan)" />
        </marker>
      </defs>

      {/* Edges */}
      {edges.map((e) => {
        const from = positions.get(e.from);
        const to = positions.get(e.to);
        if (!from || !to) return null;
        const edgeKey = `${e.from}=>${e.to}`;
        const isHovered = hoveredEdge === edgeKey;
        const isNodeHovered = hoveredNode === e.from || hoveredNode === e.to;
        const thickness = 1 + (e.count / maxCount) * 3;

        // Shorten line to stop at node boundary
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) return null;
        const ux = dx / dist;
        const uy = dy / dist;
        const x1 = from.x + ux * (nodeRadius + 2);
        const y1 = from.y + uy * (nodeRadius + 2);
        const x2 = to.x - ux * (nodeRadius + 10);
        const y2 = to.y - uy * (nodeRadius + 10);

        return (
          <g key={edgeKey}>
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={isHovered || isNodeHovered ? "var(--accent-cyan)" : "var(--text-dim)"}
              strokeWidth={isHovered ? thickness + 1 : thickness}
              opacity={isHovered || isNodeHovered ? 0.9 : 0.3}
              markerEnd={isHovered || isNodeHovered ? "url(#arrowhead-active)" : "url(#arrowhead)"}
              style={{ cursor: "pointer", transition: "opacity 0.15s" }}
              onMouseEnter={() => setHoveredEdge(edgeKey)}
              onMouseLeave={() => setHoveredEdge(null)}
            />
            {isHovered && (
              <text
                x={(x1 + x2) / 2}
                y={(y1 + y2) / 2 - 8}
                textAnchor="middle"
                fontSize={11}
                fill="var(--accent-cyan)"
                fontFamily="var(--font-mono)"
              >
                {roleById.get(e.from) ?? "?"} → {roleById.get(e.to) ?? "?"} ×{e.count}
              </text>
            )}
          </g>
        );
      })}

      {/* Nodes */}
      {nodes.map((n) => {
        const pos = positions.get(n.id);
        if (!pos) return null;
        const isHovered = hoveredNode === n.id;
        const color = roleColors[n.role] ?? "var(--text-secondary)";

        return (
          <g
            key={n.id}
            onMouseEnter={() => setHoveredNode(n.id)}
            onMouseLeave={() => setHoveredNode(null)}
            style={{ cursor: "pointer" }}
          >
            <circle
              cx={pos.x}
              cy={pos.y}
              r={isHovered ? nodeRadius + 3 : nodeRadius}
              fill={isHovered ? `${color}22` : "var(--bg-card)"}
              stroke={color}
              strokeWidth={isHovered ? 2.5 : 1.5}
              style={{ transition: "all 0.15s" }}
            />
            <text
              x={pos.x}
              y={pos.y + 1}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={11}
              fontWeight={600}
              fill={isHovered ? color : "var(--text-primary)"}
              fontFamily="var(--font-mono)"
            >
              {n.role.length > 6 ? n.role.slice(0, 6) : n.role}
            </text>
            {isHovered && (
              <text
                x={pos.x}
                y={pos.y + nodeRadius + 16}
                textAnchor="middle"
                fontSize={10}
                fill="var(--text-dim)"
                fontFamily="var(--font-mono)"
              >
                {n.role} ({n.id.slice(0, 8)})
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/* ── Main Page ── */

export default function GraphPage() {
  const { t } = useI18n();
  const [session] = useState<WorkspaceDefaults | null>(() => loadSession());
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphSize, setGraphSize] = useState({ width: 600, height: 400 });

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const q = new URLSearchParams({ workspaceId: session.workspaceId, limitMessages: "2000" });
        const res = await api<{ nodes: GraphNode[]; edges: GraphEdge[] }>(`/api/agent-graph?${q.toString()}`);
        setNodes(res.nodes);
        setEdges(res.edges);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  // Measure container for responsive SVG
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        setGraphSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const stats = useMemo(() => {
    const totalEdges = edges.length;
    const totalMessages = edges.reduce((sum, e) => sum + e.count, 0);
    return { totalEdges, totalMessages };
  }, [edges]);

  const roleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) map.set(n.id, n.role);
    return map;
  }, [nodes]);

  if (!session) {
    return (
      <div style={{ padding: 24 }}>
        <EmptyState
          icon=""
          message={t("graph.no_session")}
          hint={t("graph.no_session_hint")}
          action={
            <Link className="btn btn-primary" href={ROUTES.CHAT}>
              {t("graph.open_im")}
            </Link>
          }
        />
      </div>
    );
  }

  if (loading) {
    return <Loading variant="skeleton" lines={4} fullPage />;
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg-void)" }}>
      {/* Header */}
      <div
        style={{
          height: 44,
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <Link
          href={ROUTES.CHAT}
          style={{ fontSize: 12, color: "var(--text-dim)", textDecoration: "none" }}
        >
          {t("graph.back_im")}
        </Link>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--cyan)", fontFamily: "var(--font-display)" }}>
          {t("graph.title")}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 16, fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
          <span>{t("graph.edges")}: <b style={{ color: "var(--text-primary)" }}>{stats.totalEdges}</b></span>
          <span>{t("graph.messages")}: <b style={{ color: "var(--text-primary)" }}>{stats.totalMessages}</b></span>
        </div>
      </div>

      {error && (
        <div style={{ padding: "8px 16px" }}>
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {/* Main content: graph + sidebar */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Graph area */}
        <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {nodes.length > 0 && graphSize.width > 0 ? (
            <TopologyGraph
              nodes={nodes}
              edges={edges}
              width={graphSize.width}
              height={graphSize.height}
            />
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--text-dim)",
                fontSize: 13,
              }}
            >
              {t("graph.no_edges")}
            </div>
          )}
        </div>

        {/* Sidebar: recent flows */}
        <div
          style={{
            width: 280,
            borderLeft: "1px solid var(--border)",
            background: "var(--bg-panel)",
            overflowY: "auto",
            flexShrink: 0,
            padding: "12px 16px",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            {t("graph.recent_flows")}
          </div>
          {edges.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("graph.no_edges")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {edges.slice(0, 50).map((e) => {
                const fromLabel = roleById.get(e.from) ?? e.from.slice(0, 8);
                const toLabel = roleById.get(e.to) ?? e.to.slice(0, 8);
                return (
                  <div
                    key={`${e.from}=>${e.to}`}
                    style={{
                      padding: "8px 10px",
                      borderRadius: "var(--radius-sm)",
                      background: "var(--bg-card)",
                      border: "1px solid var(--border)",
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {fromLabel} → {toLabel}
                      </span>
                      <span style={{ color: "var(--accent-cyan)", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
                        ×{e.count}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginTop: 4 }}>
                      {t("graph.last")}{new Date(e.lastSendTime).toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

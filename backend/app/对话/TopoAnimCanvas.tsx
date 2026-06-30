"use client";

import { useEffect, useRef } from "react";

type TopoNode = { id: string; x: number; y: number; color: string; r: number; status: string };
type TopoEdge = { fromId: string; toId: string };

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace(/^#/, "");
  const r = parseInt(h.substring(0, 2), 16);
  if (isNaN(r)) return `rgba(100,100,100,${a})`;
  const g = parseInt(h.substring(2, 4), 16);
  if (isNaN(g)) return `rgba(100,100,100,${a})`;
  const b = parseInt(h.substring(4, 6), 16);
  if (isNaN(b)) return `rgba(100,100,100,${a})`;
  return `rgba(${r},${g},${b},${a})`;
}

export function TopoAnimCanvas({
  width,
  height,
  nodes,
  edges,
}: {
  width: number;
  height: number;
  nodes: TopoNode[];
  edges: TopoEdge[];
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let t = 0;
    let animId = 0;

    const nodeMap = new Map<string, TopoNode>();
    for (const n of nodes) nodeMap.set(n.id, n);

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      t += 0.012;

      // --- Edges: flowing dashes + moving beads ---
      for (let ei = 0; ei < edges.length; ei++) {
        const edge = edges[ei];
        const na = nodeMap.get(edge.fromId);
        const nb = nodeMap.get(edge.toId);
        if (!na || !nb) continue;
        const ax = na.x, ay = na.y, bx = nb.x, by = nb.y;

        // Flowing dashed line
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.strokeStyle = "rgba(0, 240, 255, 0.18)";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.lineDashOffset = -t * 18;
        ctx.stroke();
        ctx.setLineDash([]);

        // Moving light bead (sine-driven)
        const p = Math.sin(t * 1.8 + ei * 1.2) * 0.5 + 0.5;
        const px = ax + (bx - ax) * p;
        const py = ay + (by - ay) * p;
        ctx.beginPath();
        ctx.arc(px, py, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 240, 255, 0.45)";
        ctx.fill();
      }

      // --- Nodes: outer ring glow ---
      for (const n of nodes) {
        const nx = n.x, ny = n.y;
        const alpha = n.status === "BUSY" ? 0.25 : 0.19;
        const g = ctx.createRadialGradient(nx, ny, n.r - 2, nx, ny, n.r + 28);
        g.addColorStop(0, hexToRgba(n.color, alpha));
        g.addColorStop(0.5, hexToRgba(n.color, 0.06));
        g.addColorStop(1, "transparent");
        ctx.beginPath();
        ctx.arc(nx, ny, n.r + 28, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [nodes, edges, width, height]);

  return (
    <canvas
      ref={ref}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width,
        height,
        pointerEvents: "none",
        zIndex: "var(--z-bg)",
      }}
    />
  );
}

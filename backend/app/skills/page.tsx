"use client";

import { useEffect, useState } from "react";

type SkillStat = {
  skillName: string;
  totalCalls: number;
  successRate: number;
  lastUsed: string;
  agentCount: number;
};

type SkillStatsData = {
  totalInvocations: { allTime: number; last7Days: number; last24Hours: number };
  perSkill: SkillStat[];
  topSkills: Array<{ skillName: string; totalCalls: number }>;
};

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function SkillsPage() {
  const [data, setData] = useState<SkillStatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/skills/stats")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch skill stats");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: "2rem", color: "#888" }}>Loading skill stats...</div>;
  if (error) return <div style={{ padding: "2rem", color: "#e44" }}>Error: {error}</div>;
  if (!data) return <div style={{ padding: "2rem", color: "#888" }}>No data</div>;

  return (
    <div style={{ padding: "2rem", maxWidth: "900px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Skill Usage Dashboard</h1>

      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "2rem" }}>
        <StatCard label="All Time" value={data.totalInvocations.allTime} />
        <StatCard label="Last 7 Days" value={data.totalInvocations.last7Days} />
        <StatCard label="Last 24 Hours" value={data.totalInvocations.last24Hours} />
      </div>

      {/* Top skills */}
      {data.topSkills.length > 0 && (
        <section style={{ marginBottom: "2rem" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Top Skills</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {data.topSkills.map((s) => (
              <span key={s.skillName} style={{
                padding: "0.25rem 0.75rem",
                background: "rgba(0,240,255,0.08)",
                borderRadius: "9999px",
                fontSize: "0.85rem",
                border: "1px solid rgba(0,240,255,0.15)",
              }}>
                {s.skillName} ({s.totalCalls})
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Per-skill table */}
      <section>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>All Skills</h2>
        {data.perSkill.length === 0 ? (
          <div style={{ color: "#888" }}>No skill usage recorded yet.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", textAlign: "left" }}>
                <th style={{ padding: "0.5rem" }}>Skill</th>
                <th style={{ padding: "0.5rem" }}>Calls</th>
                <th style={{ padding: "0.5rem" }}>Success</th>
                <th style={{ padding: "0.5rem" }}>Agents</th>
                <th style={{ padding: "0.5rem" }}>Last Used</th>
              </tr>
            </thead>
            <tbody>
              {data.perSkill.map((s) => (
                <tr key={s.skillName} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <td style={{ padding: "0.5rem" }}>{s.skillName}</td>
                  <td style={{ padding: "0.5rem" }}>{s.totalCalls}</td>
                  <td style={{ padding: "0.5rem" }}>
                    <span style={{ color: s.successRate >= 80 ? "#4e4" : s.successRate >= 50 ? "#ee4" : "#e44" }}>
                      {s.successRate}%
                    </span>
                  </td>
                  <td style={{ padding: "0.5rem" }}>{s.agentCount}</td>
                  <td style={{ padding: "0.5rem", color: "#888" }}>
                    {s.lastUsed ? timeAgo(s.lastUsed) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      padding: "1rem",
      background: "rgba(255,255,255,0.03)",
      borderRadius: "0.5rem",
      border: "1px solid rgba(255,255,255,0.08)",
    }}>
      <div style={{ fontSize: "0.75rem", color: "#888", marginBottom: "0.25rem" }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 700 }}>{value}</div>
    </div>
  );
}

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

type SkillEntry = {
  name: string;
  description: string;
  autoLoad: boolean;
  roles: string[];
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
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStats = fetch("/api/skills/stats")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch skill stats");
        return r.json();
      })
      .then(setData);

    const fetchSkills = fetch("/api/skills")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch skills");
        return r.json();
      })
      .then((d) => setSkills(d.skills || []));

    Promise.all([fetchStats, fetchSkills])
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const handleSearch = async () => {
    if (!searchQuery || searchQuery.trim().length < 2) return;
    setSearching(true);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        body: JSON.stringify({ action: "search_remote", query: searchQuery }),
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      setSearchResults(data.skills || []);
    } catch (e) {
      setSearchResults([]);
      console.error(e);
    } finally {
      setSearching(false);
    }
  };

  const handleInstall = async (name: string, url: string) => {
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        body: JSON.stringify({ action: "install_remote", name, source_url: url }),
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (data.ok) {
        alert(`Skill "${name}" installed!`);
        // Refresh skills
        window.location.reload();
      } else {
        alert(`Install failed: ${data.error}`);
      }
    } catch (e) {
      alert(`Install failed: ${e}`);
    }
  };

  if (loading) return <div style={{ padding: "2rem", color: "#888" }}>Loading skill data...</div>;
  if (error) return <div style={{ padding: "2rem", color: "#e44" }}>Error: {error}</div>;
  if (!data) return <div style={{ padding: "2rem", color: "#888" }}>No data</div>;

  return (
    <div style={{ padding: "2rem", maxWidth: "900px", margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Skill Management</h1>

      {/* Installed Skills List */}
      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Installed Skills ({skills.length})</h2>
        {skills.length === 0 ? (
          <div style={{ color: "#888" }}>No skills installed. Search and install skills from the dashboard below.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.75rem" }}>
            {skills.map((s) => (
              <div key={s.name} style={{
                padding: "0.75rem",
                background: "rgba(255,255,255,0.03)",
                borderRadius: "0.5rem",
                border: "1px solid rgba(255,255,255,0.08)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.25rem" }}>
                  <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "#00f0ff" }}>{s.name}</div>
                  {s.autoLoad && <div style={{ fontSize: "0.65rem", color: "#00ff88", border: "1px solid rgba(0,255,136,0.3)", padding: "0.1rem 0.4rem", borderRadius: "4px" }}>AUTO</div>}
                </div>
                <div style={{ fontSize: "0.75rem", color: "#aaa", marginBottom: "0.25rem", minHeight: "2.4em" }}>{s.description}</div>
                {s.roles.length > 0 && (
                  <div style={{ fontSize: "0.65rem", color: "#888", display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                    {s.roles.map(r => <span key={r} style={{ background: "rgba(255,255,255,0.1)", padding: "0.1rem 0.3rem", borderRadius: "3px" }}>{r}</span>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Summary cards */}
      <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Usage Dashboard</h2>
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

      {/* Search & Install Skills */}
      <section style={{ marginTop: "3rem", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.5rem" }}>Skill Marketplace</h2>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search skills (e.g., web scraping, coding, data analysis)"
            style={{
              flex: 1,
              padding: "0.5rem 1rem",
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "0.5rem",
              color: "inherit",
              fontSize: "0.85rem",
            }}
          />
          <button
            onClick={handleSearch}
            disabled={searching || searchQuery.trim().length < 2}
            style={{
              padding: "0.5rem 1.5rem",
              background: "rgba(0,240,255,0.1)",
              border: "1px solid rgba(0,240,255,0.3)",
              borderRadius: "0.5rem",
              color: "#00f0ff",
              cursor: searching ? "wait" : "pointer",
              fontWeight: 600,
              fontSize: "0.85rem",
            }}
          >
            {searching ? "Searching..." : "Search"}
          </button>
        </div>

        {searchResults.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
            {searchResults.map((r) => (
              <div key={r.name + r.source} style={{
                padding: "1rem",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "0.5rem",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "0.5rem" }}>
                  <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#a855f7" }}>{r.name}</div>
                  <div style={{ fontSize: "0.6rem", color: "#888", background: "rgba(255,255,255,0.05)", padding: "0.1rem 0.3rem", borderRadius: "3px" }}>{r.source}</div>
                </div>
                <div style={{ fontSize: "0.75rem", color: "#aaa", marginBottom: "0.75rem", minHeight: "2.5em" }}>{r.description}</div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <a href={r.source_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: "0.65rem", color: "#00f0ff", textDecoration: "none" }}>View Source</a>
                  <button onClick={() => handleInstall(r.name, r.source_url)} style={{ marginLeft: "auto", fontSize: "0.75rem", padding: "0.2rem 0.6rem", background: "rgba(0,255,136,0.1)", border: "1px solid rgba(0,255,136,0.3)", borderRadius: "3px", color: "#00ff88", cursor: "pointer" }}>
                    Install
                  </button>
                </div>
              </div>
            ))}
          </div>
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

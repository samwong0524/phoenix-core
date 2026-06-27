"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

type RemoteSkill = {
  name: string;
  description: string;
  source_url: string;
  source: string;
};

type TabKey = "installed" | "stats" | "marketplace";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(date: string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  return `${days} 天前`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SkillsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("installed");
  const [data, setData] = useState<SkillStatsData | null>(null);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RemoteSkill[]>([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "ok" | "err"; msg: string } | null>(null);

  // Initial data load
  useEffect(() => {
    const fetchStats = fetch("/api/skills/stats")
      .then((r) => { if (!r.ok) throw new Error("Failed to fetch skill stats"); return r.json(); })
      .then(setData);
    const fetchSkills = fetch("/api/skills")
      .then((r) => { if (!r.ok) throw new Error("Failed to fetch skills"); return r.json(); })
      .then((d) => setSkills(d.skills || []));
    Promise.all([fetchStats, fetchSkills])
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const flash = useCallback((type: "ok" | "err", msg: string) => {
    setToast({ type, msg });
  }, []);

  const handleSearch = async () => {
    if (!searchQuery || searchQuery.trim().length < 2) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        body: JSON.stringify({ action: "search_remote", query: searchQuery }),
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      setSearchResults(json.skills || []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleInstall = async (name: string, url: string) => {
    setInstalling(name);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        body: JSON.stringify({ action: "install_remote", name, source_url: url }),
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (json.ok) {
        flash("ok", `Skill "${name}" 安装成功`);
        // Optimistic: append to local list without full reload
        setSkills(prev => {
          if (prev.some(s => s.name === name)) return prev;
          return [...prev, { name, description: searchResults.find(r => r.name === name)?.description ?? "", autoLoad: false, roles: [] }];
        });
      } else {
        flash("err", `安装失败: ${json.error}`);
      }
    } catch {
      flash("err", "安装失败");
    } finally {
      setInstalling(null);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        body: JSON.stringify({ action: "delete", name }),
        headers: { "Content-Type": "application/json" },
      });
      const json = await res.json();
      if (json.ok) {
        flash("ok", `Skill "${name}" 已删除`);
        setSkills(prev => prev.filter(s => s.name !== name));
      } else {
        flash("err", `删除失败: ${json.error}`);
      }
    } catch {
      flash("err", "删除失败");
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorFallback message={error} />;
  if (!data) return <div style={{ padding: "3rem", color: "#64748b" }}>无数据</div>;

  const tabs: { key: TabKey; label: string; icon: string; badge?: string }[] = [
    { key: "installed", label: "已安装", icon: "󰏓", badge: String(skills.length) },
    { key: "stats", label: "使用统计", icon: "󰊯" },
    { key: "marketplace", label: "技能市场", icon: "󰵮" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#0F172A", color: "#F8FAFC" }}>
      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 50,
          padding: "10px 16px", borderRadius: 8,
          background: toast.type === "ok" ? "#065f46" : "#7f1d1d",
          border: `1px solid ${toast.type === "ok" ? "#059669" : "#dc2626"}`,
          color: toast.type === "ok" ? "#6ee7b7" : "#fca5a5",
          fontSize: 13, fontWeight: 500,
          animation: "slideIn 0.2s ease-out",
        }}>
          {toast.type === "ok" ? "✓" : "✗"} {toast.msg}
        </div>
      )}

      {/* Header */}
      <header style={{
        padding: "24px 32px 0",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "start", gap: 16 }}>
          <Link href="/" style={{
            marginTop: 4,
            padding: "6px 12px", borderRadius: 6,
            background: "rgba(255,255,255,0.05)", color: "#94a3b8",
            textDecoration: "none", fontSize: 12,
            border: "1px solid rgba(255,255,255,0.08)",
            transition: "background 0.15s, color 0.15s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.1)"; (e.currentTarget as HTMLAnchorElement).style.color = "#F8FAFC"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLAnchorElement).style.color = "#94a3b8"; }}
          >← 返回首页</Link>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>
              技能管理
            </h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
              管理 Agent 技能库 · 安装远程技能 · 查看使用统计
            </p>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav style={{
        maxWidth: 1200, margin: "0 auto",
        padding: "0 32px",
        display: "flex", gap: 0,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
      }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "12px 20px",
              background: "none", border: "none",
              borderBottom: activeTab === tab.key ? "2px solid #22C55E" : "2px solid transparent",
              color: activeTab === tab.key ? "#F8FAFC" : "#64748b",
              fontSize: 13, fontWeight: activeTab === tab.key ? 600 : 400,
              cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
              transition: "color 0.2s, border-color 0.2s",
            }}
          >
            {tab.label}
            {tab.badge && (
              <span style={{
                fontSize: 11, padding: "1px 6px", borderRadius: 9999,
                background: "rgba(255,255,255,0.08)", color: "#94a3b8",
              }}>{tab.badge}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 32px" }}>
        {activeTab === "installed" && (
          <InstalledTab skills={skills} onDelete={handleDelete} />
        )}
        {activeTab === "stats" && (
          <StatsTab data={data} />
        )}
        {activeTab === "marketplace" && (
          <MarketplaceTab
            query={searchQuery}
            setQuery={setSearchQuery}
            onSearch={handleSearch}
            searching={searching}
            results={searchResults}
            installing={installing}
            onInstall={handleInstall}
          />
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Installed Tab
// ---------------------------------------------------------------------------

function InstalledTab({ skills, onDelete }: { skills: SkillEntry[]; onDelete: (n: string) => void }) {
  if (skills.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "4rem 0", color: "#475569" }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>󰏓</div>
        <div style={{ fontSize: 14 }}>还没有安装任何技能</div>
        <div style={{ fontSize: 12, marginTop: 4, color: "#334155" }}>切换到"技能市场"搜索并安装</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header row with count and scroll hint */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "#64748b" }}>共 {skills.length} 个技能</span>
      </div>
      {/* Scrollable grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
        gap: 12,
        maxHeight: "calc(100vh - 260px)",
        overflowY: "auto",
        paddingRight: 8,
      }}>
      {skills.map(s => (
        <div key={s.name} style={{
          padding: 16,
          background: "rgba(255,255,255,0.02)",
          borderRadius: 10,
          border: "1px solid rgba(255,255,255,0.06)",
          transition: "border-color 0.2s, background 0.2s",
          cursor: "default",
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(34,197,94,0.3)";
          (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.06)";
          (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.02)";
        }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#F8FAFC", flex: 1 }}>{s.name}</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
              {s.autoLoad && (
                <span style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 4,
                  background: "rgba(34,197,94,0.1)", color: "#4ade80",
                  border: "1px solid rgba(34,197,94,0.2)",
                }}>AUTO</span>
              )}
              <button
                onClick={() => onDelete(s.name)}
                title="删除"
                style={{
                  padding: "2px 6px", borderRadius: 4,
                  background: "rgba(239,68,68,0.08)", color: "#f87171",
                  border: "1px solid rgba(239,68,68,0.15)",
                  cursor: "pointer", fontSize: 11,
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.15)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.08)"; }}
              >删除</button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5, minHeight: "2.4em", marginBottom: 8 }}>
            {s.description}
          </div>
          {s.roles.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {s.roles.map(r => (
                <span key={r} style={{
                  fontSize: 10, padding: "2px 8px", borderRadius: 9999,
                  background: "rgba(148,163,184,0.08)", color: "#94a3b8",
                  border: "1px solid rgba(148,163,184,0.12)",
                }}>{r}</span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats Tab
// ---------------------------------------------------------------------------

function StatsTab({ data }: { data: SkillStatsData }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <StatCard label="累计调用" value={data.totalInvocations.allTime} accent="#3b82f6" />
        <StatCard label="近 7 天" value={data.totalInvocations.last7Days} accent="#22C55E" />
        <StatCard label="近 24 小时" value={data.totalInvocations.last24Hours} accent="#a855f7" />
      </div>

      {/* Top skills */}
      {data.topSkills.length > 0 && (
        <div>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#cbd5e1" }}>热门技能</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {data.topSkills.map(s => (
              <span key={s.skillName} style={{
                padding: "6px 14px", borderRadius: 9999,
                background: "rgba(59,130,246,0.08)",
                border: "1px solid rgba(59,130,246,0.15)",
                fontSize: 13, color: "#93c5fd",
              }}>
                {s.skillName} <span style={{ color: "#64748b" }}>({s.totalCalls})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Per-skill table */}
      {data.perSkill.length === 0 ? (
        <div style={{ color: "#475569", fontSize: 13 }}>暂无使用记录</div>
      ) : (
        <div style={{
          borderRadius: 10, overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.06)",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                {["技能", "调用次数", "成功率", "Agent 数", "最后使用"].map(h => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 500, color: "#64748b", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.perSkill.map((s, i) => (
                <tr key={s.skillName} style={{
                  background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}>
                  <td style={{ padding: "10px 14px", fontWeight: 500, color: "#F8FAFC" }}>{s.skillName}</td>
                  <td style={{ padding: "10px 14px", color: "#94a3b8" }}>{s.totalCalls}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{
                      padding: "2px 8px", borderRadius: 4, fontSize: 12,
                      color: s.successRate >= 80 ? "#4ade80" : s.successRate >= 50 ? "#facc15" : "#f87171",
                      background: s.successRate >= 80 ? "rgba(34,197,94,0.1)" : s.successRate >= 50 ? "rgba(250,204,21,0.1)" : "rgba(239,68,68,0.1)",
                    }}>{s.successRate}%</span>
                  </td>
                  <td style={{ padding: "10px 14px", color: "#94a3b8" }}>{s.agentCount}</td>
                  <td style={{ padding: "10px 14px", color: "#64748b" }}>
                    {s.lastUsed ? timeAgo(s.lastUsed) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marketplace Tab
// ---------------------------------------------------------------------------

function MarketplaceTab({
  query, setQuery, onSearch, searching, results, installing, onInstall,
}: {
  query: string; setQuery: (v: string) => void;
  onSearch: () => void; searching: boolean;
  results: RemoteSkill[]; installing: string | null;
  onInstall: (name: string, url: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Search bar */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onSearch()}
          placeholder="搜索技能（如 web scraping, coding, data analysis）"
          style={{
            flex: 1, padding: "10px 14px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8, color: "#F8FAFC", fontSize: 13,
            outline: "none",
            transition: "border-color 0.2s",
          }}
          onFocus={e => { e.target.style.borderColor = "rgba(34,197,94,0.4)"; }}
          onBlur={e => { e.target.style.borderColor = "rgba(255,255,255,0.1)"; }}
        />
        <button
          onClick={onSearch}
          disabled={searching || query.trim().length < 2}
          style={{
            padding: "10px 24px",
            background: "rgba(34,197,94,0.12)",
            border: "1px solid rgba(34,197,94,0.3)",
            borderRadius: 8,
            color: "#4ade80",
            cursor: searching || query.trim().length < 2 ? "not-allowed" : "pointer",
            fontWeight: 600, fontSize: 13,
            opacity: searching || query.trim().length < 2 ? 0.5 : 1,
            transition: "background 0.15s",
          }}
        >
          {searching ? "搜索中..." : "搜索"}
        </button>
      </div>

      {/* Results */}
      {results.length === 0 && !searching && (
        <div style={{ textAlign: "center", padding: "3rem 0", color: "#475569" }}>
          <div style={{ fontSize: 14 }}>输入关键词搜索远程技能</div>
          <div style={{ fontSize: 12, marginTop: 4, color: "#334155" }}>支持 GitHub、LobeHub、ClawHub 等源</div>
        </div>
      )}
      {searching && (
        <div style={{ textAlign: "center", padding: "2rem", color: "#64748b" }}>搜索中...</div>
      )}
      {results.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
          {results.map(r => (
            <div key={r.name + r.source} style={{
              padding: 16,
              background: "rgba(255,255,255,0.02)",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.06)",
              transition: "border-color 0.2s",
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(168,85,247,0.3)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.06)"; }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#c084fc", flex: 1 }}>{r.name}</div>
                <span style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 4,
                  background: "rgba(255,255,255,0.05)", color: "#64748b",
                }}>{r.source}</span>
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5, minHeight: "2.4em", marginBottom: 12 }}>
                {r.description}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <a
                  href={r.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, color: "#60a5fa", textDecoration: "none" }}
                >查看源文件</a>
                <button
                  onClick={() => onInstall(r.name, r.source_url)}
                  disabled={installing === r.name}
                  style={{
                    marginLeft: "auto",
                    padding: "4px 12px", borderRadius: 6,
                    background: installing === r.name ? "rgba(34,197,94,0.05)" : "rgba(34,197,94,0.1)",
                    border: "1px solid rgba(34,197,94,0.25)",
                    color: installing === r.name ? "#64748b" : "#4ade80",
                    cursor: installing === r.name ? "wait" : "pointer",
                    fontSize: 12, fontWeight: 500,
                    transition: "background 0.15s",
                  }}
                >
                  {installing === r.name ? "安装中..." : "安装"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div style={{
      padding: 16,
      borderRadius: 10,
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.06)",
      borderLeft: `3px solid ${accent}`,
    }}>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{value.toLocaleString()}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading / Error
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div style={{ minHeight: "100vh", background: "#0F172A", padding: "2rem 32px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ height: 28, width: 120, background: "rgba(255,255,255,0.06)", borderRadius: 6 }} />
      <div style={{ display: "flex", gap: 8 }}>
        {[1,2,3].map(i => (
          <div key={i} style={{ height: 36, width: 100, background: "rgba(255,255,255,0.04)", borderRadius: 6 }} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {[1,2,3].map(i => (
          <div key={i} style={{ height: 80, background: "rgba(255,255,255,0.03)", borderRadius: 10 }} />
        ))}
      </div>
    </div>
  );
}

function ErrorFallback({ message }: { message: string }) {
  return (
    <div style={{ minHeight: "100vh", background: "#0F172A", padding: "3rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 24, color: "#f87171", marginBottom: 8 }}>✗</div>
        <div style={{ fontSize: 14, color: "#94a3b8" }}>{message}</div>
      </div>
    </div>
  );
}

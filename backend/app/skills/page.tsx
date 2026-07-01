"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { EmptyState, Loading, Card, PageHeader, toast } from "@/components/ui";

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

type PopularSkill = {
  name: string;
  description: string;
  totalCalls: number;
};

type TrendingSkill = {
  name: string;
  description: string;
  callsLast7Days: number;
  growth?: string;
};

type CategorySkill = {
  name: string;
  description: string;
  source_url: string;
};

type Category = {
  id: string;
  name: string;
  icon: string;
  skills: CategorySkill[];
};

type PopularData = {
  popular: PopularSkill[];
  trending: TrendingSkill[];
  categories: Category[];
};

type TabKey = "installed" | "stats" | "marketplace";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(date: string, t: (key: string, params?: Record<string, unknown>) => string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("skills.just_now");
  if (mins < 60) return t("skills.minutes_ago", { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("skills.hours_ago", { n: hrs });
  const days = Math.floor(hrs / 24);
  return t("skills.days_ago", { n: days });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function SkillsPage() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabKey>("installed");
  const [data, setData] = useState<SkillStatsData | null>(null);
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<RemoteSkill[]>([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [popularData, setPopularData] = useState<PopularData | null>(null);
  const [popularLoading, setPopularLoading] = useState(true);

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

    // Fetch popular recommendations separately (non-blocking)
    fetch("/api/skills/popular")
      .then((r) => { if (!r.ok) throw new Error("Failed"); return r.json(); })
      .then(setPopularData)
      .catch(() => setPopularData(null))
      .finally(() => setPopularLoading(false));
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
        toast.success(t("skills.install_ok", { name }));
        // Optimistic: append to local list without full reload
        setSkills(prev => {
          if (prev.some(s => s.name === name)) return prev;
          return [...prev, { name, description: searchResults.find(r => r.name === name)?.description ?? "", autoLoad: false, roles: [] }];
        });
      } else {
        toast.error(t("skills.install_fail", { error: json.error }));
      }
    } catch {
      toast.error(t("skills.install_fail_generic"));
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
        toast.success(t("skills.uninstall_ok", { name }));
        setSkills(prev => prev.filter(s => s.name !== name));
      } else {
        toast.error(t("skills.uninstall_fail", { error: json.error }));
      }
    } catch {
      toast.error(t("skills.uninstall_fail_generic"));
    }
  };

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorFallback message={error} />;
  if (!data) return <div style={{ padding: "3rem", color: "var(--text-secondary)" }}>{t("skills.no_data")}</div>;

  const tabs: { key: TabKey; label: string; icon: string; badge?: string }[] = [
    { key: "installed", label: t("skills.tab_installed"), icon: "󰏓", badge: String(skills.length) },
    { key: "stats", label: t("skills.tab_stats"), icon: "󰊯" },
    { key: "marketplace", label: t("skills.tab_market"), icon: "󰵮" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-void)", color: "var(--text-primary)" }}>
      {/* Header */}
      <div style={{ padding: "24px 32px 0", borderBottom: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <PageHeader
            title={t("skills.title")}
            subtitle={t("skills.subtitle")}
            backHref="/"
            backLabel={t("common.back_home")}
          />
        </div>
      </div>

      {/* Tabs */}
      <nav style={{
        maxWidth: 1200, margin: "0 auto",
        padding: "0 32px",
        display: "flex", gap: 0,
        borderBottom: "1px solid var(--border)",
      }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "12px 20px",
              background: "none", border: "none",
              borderBottom: activeTab === tab.key ? "2px solid var(--green)" : "2px solid transparent",
              color: activeTab === tab.key ? "var(--text-primary)" : "var(--text-secondary)",
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
                background: "var(--bg-hover)", color: "var(--text-dim)",
              }}>{tab.badge}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 32px" }}>
        {activeTab === "installed" && (
          <InstalledTab skills={skills} onDelete={handleDelete} t={t} />
        )}
        {activeTab === "stats" && (
          <StatsTab data={data} t={t} />
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
            popularData={popularData}
            popularLoading={popularLoading}
            t={t}
          />
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Installed Tab
// ---------------------------------------------------------------------------

function InstalledTab({ skills, onDelete, t }: { skills: SkillEntry[]; onDelete: (n: string) => void; t: (key: string, params?: Record<string, unknown>) => string }) {
  if (skills.length === 0) {
    return (
      <EmptyState icon="󰏓" message={t("skills.no_skills")} hint={t("skills.go_market")} />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header row with count and scroll hint */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{t("skills.total", { count: skills.length })}</span>
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
        <Card key={s.name} hoverable hoverBorderColor="var(--green-mid)" padding={16} borderRadius="var(--radius-md)" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>{s.name}</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
              {s.autoLoad && (
                <span style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 4,
                  background: "var(--green-soft)", color: "var(--green-text)",
                  border: "1px solid var(--green-muted)",
                }}>{t("skills.auto")}</span>
              )}
              <button
                onClick={() => onDelete(s.name)}
                title={t("common.delete")}
                style={{
                  padding: "2px 6px", borderRadius: 4,
                  background: "var(--red-soft)", color: "var(--red-text)",
                  border: "1px solid var(--red-muted)",
                  cursor: "pointer", fontSize: 11,
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--red-muted)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--red-soft)"; }}
              >{t("common.delete")}</button>
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5, minHeight: "2.4em", marginBottom: 8 }}>
            {s.description}
          </div>
          {s.roles.length > 0 && (
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {s.roles.map(r => (
                <span key={r} style={{
                  fontSize: 10, padding: "2px 8px", borderRadius: 9999,
                  background: "var(--slate-soft)", color: "var(--text-dim)",
                  border: "1px solid var(--slate-muted)",
                }}>{r}</span>
              ))}
            </div>
          )}
        </Card>
      ))}
    </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats Tab
// ---------------------------------------------------------------------------

function StatsTab({ data, t }: { data: SkillStatsData; t: (key: string, params?: Record<string, unknown>) => string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Summary cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <StatCard label={t("skills.total_calls")} value={data.totalInvocations.allTime} accent="var(--cyan)" />
        <StatCard label={t("skills.last_7d")} value={data.totalInvocations.last7Days} accent="var(--green)" />
        <StatCard label={t("skills.last_24h")} value={data.totalInvocations.last24Hours} accent="var(--purple)" />
      </div>

      {/* Top skills */}
      {data.topSkills.length > 0 && (
        <div>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "var(--text-secondary)" }}>{t("skills.hot_skills")}</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {data.topSkills.map(s => (
              <span key={s.skillName} style={{
                padding: "6px 14px", borderRadius: 9999,
                background: "var(--blue-soft)",
                border: "1px solid var(--blue-muted)",
                fontSize: 13, color: "var(--blue-text)",
              }}>
                {s.skillName} <span style={{ color: "var(--text-secondary)" }}>({s.totalCalls})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Per-skill table */}
      {data.perSkill.length === 0 ? (
        <div style={{ color: "var(--text-dim)", fontSize: 13 }}>{t("skills.no_usage")}</div>
      ) : (
        <div style={{
          borderRadius: "var(--radius-md)", overflow: "hidden",
          border: "1px solid var(--border)",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--bg-card)" }}>
                {[t("skills.col_skill"), t("skills.col_calls"), t("skills.col_success"), t("skills.col_agents"), t("skills.col_last")].map(h => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", borderBottom: "1px solid var(--border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.perSkill.map((s, i) => (
                <tr key={s.skillName} style={{
                  background: i % 2 === 0 ? "transparent" : "var(--bg-hover)",
                  borderBottom: "1px solid var(--border-hairline)",
                }}>
                  <td style={{ padding: "10px 14px", fontWeight: 500, color: "var(--text-primary)" }}>{s.skillName}</td>
                  <td style={{ padding: "10px 14px", color: "var(--text-dim)" }}>{s.totalCalls}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{
                      padding: "2px 8px", borderRadius: 4, fontSize: 12,
                      color: s.successRate >= 80 ? "var(--green-text)" : s.successRate >= 50 ? "var(--yellow-text)" : "var(--red-text)",
                      background: s.successRate >= 80 ? "var(--green-soft)" : s.successRate >= 50 ? "var(--yellow-soft)" : "var(--red-soft)",
                    }}>{s.successRate}%</span>
                  </td>
                  <td style={{ padding: "10px 14px", color: "var(--text-dim)" }}>{s.agentCount}</td>
                  <td style={{ padding: "10px 14px", color: "var(--text-secondary)" }}>
                    {s.lastUsed ? timeAgo(s.lastUsed, t) : "—"}
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
  query, setQuery, onSearch, searching, results, installing, onInstall, popularData, popularLoading, t,
}: {
  query: string; setQuery: (v: string) => void;
  onSearch: () => void; searching: boolean;
  results: RemoteSkill[]; installing: string | null;
  onInstall: (name: string, url: string) => void;
  popularData: PopularData | null; popularLoading: boolean;
  t: (key: string, params?: Record<string, unknown>) => string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Popular Recommendations Section */}
      {!popularLoading && popularData && (
        <PopularSection data={popularData} installing={installing} onInstall={onInstall} t={t} />
      )}
      {popularLoading && (
        <div style={{ padding: "16px", textAlign: "center", color: "var(--text-secondary)", fontSize: 13 }}>
          {t("skills.loading_popular")}
        </div>
      )}

      {/* Search bar */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onSearch()}
          placeholder={t("skills.search_placeholder")}
          style={{
            flex: 1, padding: "10px 14px",
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)", color: "var(--text-primary)", fontSize: 13,
            outline: "none",
            transition: "border-color 0.2s",
          }}
          onFocus={e => { e.target.style.borderColor = "var(--green-vivid)"; }}
          onBlur={e => { e.target.style.borderColor = "var(--border)"; }}
        />
        <button
          onClick={onSearch}
          disabled={searching || query.trim().length < 2}
          style={{
            padding: "10px 24px",
            background: "var(--green-soft)",
            border: "1px solid var(--green-mid)",
            borderRadius: "var(--radius-md)",
            color: "var(--green-text)",
            cursor: searching || query.trim().length < 2 ? "not-allowed" : "pointer",
            fontWeight: 600, fontSize: 13,
            opacity: searching || query.trim().length < 2 ? 0.5 : 1,
            transition: "background 0.15s",
          }}
        >
          {searching ? t("skills.searching") : t("skills.search")}
        </button>
      </div>

      {/* Results */}
      {results.length === 0 && !searching && (
        <EmptyState icon="" message={t("skills.search_hint")} hint={t("skills.search_sources")} />
      )}
      {searching && (
        <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-secondary)" }}>{t("skills.searching")}</div>
      )}
      {results.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12 }}>
          {results.map(r => (
            <Card key={r.name + r.source} hoverable padding={16} borderRadius="var(--radius-md)" style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--purple-text)", flex: 1 }}>{r.name}</div>
                <span style={{
                  fontSize: 10, padding: "2px 6px", borderRadius: 4,
                  background: "var(--bg-hover)", color: "var(--text-secondary)",
                }}>{r.source}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5, minHeight: "2.4em", marginBottom: 12 }}>
                {r.description}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <a
                  href={r.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: 12, color: "var(--blue-link)", textDecoration: "none" }}
                >{t("skills.view_source")}</a>
                <button
                  onClick={() => onInstall(r.name, r.source_url)}
                  disabled={installing === r.name}
                  style={{
                    marginLeft: "auto",
                    padding: "4px 12px", borderRadius: "var(--radius-sm)",
                    background: installing === r.name ? "var(--bg-hover)" : "var(--green-soft)",
                    border: "1px solid var(--green-muted)",
                    color: installing === r.name ? "var(--text-secondary)" : "var(--green-text)",
                    cursor: installing === r.name ? "wait" : "pointer",
                    fontSize: 12, fontWeight: 500,
                    transition: "background 0.15s",
                  }}
                >
                  {installing === r.name ? t("skills.installing") : t("skills.install")}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Popular Recommendations Section
// ---------------------------------------------------------------------------

function PopularSection({
  data, installing, onInstall, t,
}: {
  data: PopularData;
  installing: string | null;
  onInstall: (name: string, url: string) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 8 }}>
      {/* Popular Skills */}
      {data.popular.length > 0 && (
        <div>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
            <span>🔥</span> {t("skills.popular_title")}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {data.popular.map((skill) => (
              <Card
                key={skill.name}
                hoverable
                hoverBorderColor="var(--green-mid)"
                padding={12}
                borderRadius="var(--radius-md)"
                style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>{skill.name}</span>
                  <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{skill.totalCalls} {t("skills.calls")}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.4, marginBottom: 8, minHeight: "1.8em" }}>
                  {skill.description}
                </div>
                <button
                  onClick={() => onInstall(skill.name, "")}
                  disabled={installing === skill.name}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "var(--radius-sm)",
                    background: installing === skill.name ? "var(--bg-hover)" : "var(--green-soft)",
                    border: "1px solid var(--green-muted)",
                    color: installing === skill.name ? "var(--text-secondary)" : "var(--green-text)",
                    cursor: installing === skill.name ? "wait" : "pointer",
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  {installing === skill.name ? t("skills.installing") : t("skills.install")}
                </button>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Trending Skills */}
      {data.trending.length > 0 && (
        <div>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
            <span>📈</span> {t("skills.trending_title")}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {data.trending.map((skill) => (
              <Card
                key={skill.name}
                hoverable
                hoverBorderColor="var(--cyan)"
                padding={12}
                borderRadius="var(--radius-md)"
                style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>{skill.name}</span>
                  <span style={{ fontSize: 11, color: "var(--cyan)", fontWeight: 500, marginLeft: 8 }}>
                    {skill.growth || `+${skill.callsLast7Days}`}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.4, marginBottom: 8, minHeight: "1.8em" }}>
                  {skill.description}
                </div>
                <button
                  onClick={() => onInstall(skill.name, "")}
                  disabled={installing === skill.name}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "var(--radius-sm)",
                    background: installing === skill.name ? "var(--bg-hover)" : "var(--green-soft)",
                    border: "1px solid var(--green-muted)",
                    color: installing === skill.name ? "var(--text-secondary)" : "var(--green-text)",
                    cursor: installing === skill.name ? "wait" : "pointer",
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  {installing === skill.name ? t("skills.installing") : t("skills.install")}
                </button>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Categories */}
      {data.categories.length > 0 && (
        <div>
          <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
            <span>📂</span> {t("skills.categories_title")}
          </h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {data.categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 9999,
                  background: selectedCategory === cat.id ? "var(--green-soft)" : "var(--bg-card)",
                  border: selectedCategory === cat.id ? "1px solid var(--green-mid)" : "1px solid var(--border)",
                  color: selectedCategory === cat.id ? "var(--green-text)" : "var(--text-secondary)",
                  fontSize: 12,
                  fontWeight: selectedCategory === cat.id ? 600 : 400,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  transition: "all 0.15s",
                }}
              >
                <span>{cat.icon}</span>
                <span>{cat.name}</span>
              </button>
            ))}
          </div>
          {selectedCategory && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
              {data.categories
                .find((c) => c.id === selectedCategory)
                ?.skills.map((skill) => (
                  <Card
                    key={skill.name}
                    hoverable
                    hoverBorderColor="var(--green-mid)"
                    padding={12}
                    borderRadius="var(--radius-md)"
                    style={{ background: "var(--bg-card)", borderColor: "var(--border)" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", flex: 1 }}>{skill.name}</span>
                      <button
                        onClick={() => onInstall(skill.name, skill.source_url)}
                        disabled={installing === skill.name}
                        style={{
                          padding: "2px 8px",
                          borderRadius: "var(--radius-sm)",
                          background: installing === skill.name ? "var(--bg-hover)" : "var(--green-soft)",
                          border: "1px solid var(--green-muted)",
                          color: installing === skill.name ? "var(--text-secondary)" : "var(--green-text)",
                          cursor: installing === skill.name ? "wait" : "pointer",
                          fontSize: 11,
                          fontWeight: 500,
                        }}
                      >
                        {installing === skill.name ? t("skills.installing") : t("skills.install")}
                      </button>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.4 }}>{skill.description}</div>
                  </Card>
                ))}
            </div>
          )}
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
      borderRadius: "var(--radius-md)",
      background: "var(--bg-card)",
      border: "1px solid var(--border)",
      borderLeft: `3px solid ${accent}`,
    }}>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>{value.toLocaleString()}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading / Error
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <Loading variant="skeleton" lines={5} fullPage />
  );
}

function ErrorFallback({ message }: { message: string }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-void)", padding: "3rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 24, color: "var(--red-text)", marginBottom: 8 }}>✗</div>
        <div style={{ fontSize: 14, color: "var(--text-dim)" }}>{message}</div>
      </div>
    </div>
  );
}

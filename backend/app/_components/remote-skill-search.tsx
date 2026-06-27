"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type RemoteSkill = {
  name: string;
  description: string;
  source_url: string;
  repo: string;
  trust_level: "official" | "community" | "unknown";
};

export default function RemoteSkillSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RemoteSkill[]>([]);
  const [searching, setSearching] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onSearch() {
    if (query.trim().length < 2) return;
    setSearching(true);
    setError(null);
    setMessage(null);
    setResults([]);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "search_remote", query: query.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Search failed");
        return;
      }
      setResults(data.skills ?? []);
      setMessage(data.message || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  async function onInstall(skill: RemoteSkill) {
    setInstalling(skill.name);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "install_remote",
          name: skill.name,
          source_url: skill.source_url,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`安装失败: ${data.error}`);
        return;
      }
      setResults((prev) => prev.filter((s) => s.name !== skill.name));
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(null);
    }
  }

  return (
    <div className="card">
      {/* Search bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="搜索远程技能 (如: web scraping, data visualization, image generation...)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onSearch()}
          className="chat-input-field"
          style={{ flex: 1, margin: 0, fontSize: 13 }}
        />
        <button
          className="btn btn-primary"
          onClick={onSearch}
          disabled={searching || query.trim().length < 2}
          style={{ fontSize: 13, padding: "6px 16px", cursor: "pointer" }}
        >
          {searching ? "搜索中..." : "搜索"}
        </button>
      </div>

      {error && (
        <div className="toast" style={{ marginBottom: 12 }}>
          <div className="mono">{error}</div>
        </div>
      )}
      {message && (
        <div className="muted mono" style={{ marginBottom: 12, fontSize: 12 }}>{message}</div>
      )}

      {/* Results grid */}
      {results.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 12,
          }}
        >
          {results.map((skill) => (
            <RemoteSkillCard
              key={skill.source_url}
              skill={skill}
              installing={installing === skill.name}
              onInstall={() => onInstall(skill)}
            />
          ))}
        </div>
      )}

      {searching && (
        <div className="muted" style={{ padding: "12px 0" }}>搜索 GitHub 技能库...</div>
      )}

      {!searching && results.length === 0 && error === null && (
        <div className="muted" style={{ padding: "12px 0", fontSize: 13 }}>
          输入关键词搜索 GitHub 上的远程技能
        </div>
      )}

      <div className="muted mono" style={{ fontSize: 11, marginTop: 16, textAlign: "right" }}>
        来源: GitHub Code Search
      </div>
    </div>
  );
}

function RemoteSkillCard({
  skill,
  installing,
  onInstall,
}: {
  skill: RemoteSkill;
  installing: boolean;
  onInstall: () => void;
}) {
  const trustColors = {
    official: "var(--green)",
    community: "var(--yellow)",
    unknown: "var(--text-dim)",
  };
  const trustLabels = {
    official: "官方",
    community: "社区",
    unknown: "未知",
  };

  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "14px 16px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        background: "var(--bg-card)",
        minHeight: 100,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span className="mono" style={{ fontWeight: 600, fontSize: 13, color: "var(--cyan)" }}>
              {skill.name}
            </span>
            <span
              className="mono"
              style={{
                fontSize: 9,
                color: trustColors[skill.trust_level],
                padding: "1px 5px",
                border: `1px solid ${trustColors[skill.trust_level]}`,
                borderRadius: 3,
              }}
            >
              {trustLabels[skill.trust_level]}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
            {skill.description}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 10 }}>
        <button
          className="btn"
          onClick={onInstall}
          disabled={installing}
          style={{
            fontSize: 10,
            padding: "3px 10px",
            color: "var(--green)",
            border: "1px solid var(--green-dim)",
            borderRadius: 4,
            cursor: installing ? "wait" : "pointer",
            background: "rgba(0, 255, 136, 0.08)",
          }}
        >
          {installing ? "安装中..." : "安装"}
        </button>
        <span className="muted mono" style={{ fontSize: 10, lineHeight: 2 }}>
          {skill.repo}
        </span>
      </div>
    </div>
  );
}

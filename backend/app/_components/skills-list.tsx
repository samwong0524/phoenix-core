"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "./confirm-dialog";

type LocalSkill = {
  type: "local";
  name: string;
  description: string;
  autoLoad: boolean;
  roles: string[];
  skillPath: string;
  skillDir: string;
};

type RemoteSkill = {
  type: "remote";
  name: string;
  description: string;
  source_url: string;
  repo: string;
  trust_level: "official" | "community" | "unknown";
  source: string; // "github" | "lobehub" | "clawhub" | "skills.sh"
};

type Skill = LocalSkill | RemoteSkill;

const PAGE_SIZE = 18;

const CATEGORIES: { key: string; label: string; icon: string; match: (s: Skill) => boolean }[] = [
  { key: "all", label: "All Skills", icon: "", match: () => true },
  { key: "other", label: "Other", icon: "", match: () => false },
  { key: "software_dev", label: "Software Dev", icon: "", match: (s) => /dev|code|build|test|debug|refactor|api|sdk|compile|deploy|ci/i.test(s.name + s.description) },
  { key: "creative", label: "Creative", icon: "", match: (s) => /creative|design|image|video|music|audio|comfyui|generate|art|draw/i.test(s.name + s.description) },
  { key: "research", label: "Research", icon: "", match: (s) => /research|crawl|benchmark|eval|paper|paper/i.test(s.name + s.description) },
  { key: "mlops", label: "MLOps", icon: "", match: (s) => /ml|model|train|infer|llm|prompt|rag|embed|vector|hugging|dataset/i.test(s.name + s.description) },
  { key: "translation", label: "Translation", icon: "", match: (s) => /translat|i18n|locale|language|lang/i.test(s.name + s.description) },
  { key: "productivity", label: "Productivity", icon: "", match: (s) => /productiv|workflow|task|todo|calendar|schedule|workflow/i.test(s.name + s.description) },
  { key: "gaming", label: "Gaming", icon: "", match: (s) => /game|gaming|play/i.test(s.name + s.description) },
  { key: "finance", label: "Finance", icon: "", match: (s) => /finance|stock|trading|crypto|bank/i.test(s.name + s.description) },
  { key: "health", label: "Health", icon: "", match: (s) => /health|medical|fitness/i.test(s.name + s.description) },
  { key: "ai_agents", label: "AI Agents", icon: "", match: (s) => /agent|multi-agent|orchestrat|autonomous|swarm/i.test(s.name + s.description) },
  { key: "devops", label: "DevOps", icon: "", match: (s) => /devops|docker|k8s|kubernetes|terraform/i.test(s.name + s.description) },
  { key: "media", label: "Media", icon: "", match: (s) => /media|youtube|podcast|stream|content/i.test(s.name + s.description) },
  { key: "social_media", label: "Social Media", icon: "", match: (s) => /twitter|discord|slack|telegram|wechat|social/i.test(s.name + s.description) },
  { key: "github", label: "GitHub", icon: "", match: (s) => /github|pr|issue|repo|commit|fork/i.test(s.name + s.description) },
  { key: "security", label: "Security", icon: "", match: (s) => /security|audit|scan|vuln|encrypt|auth/i.test(s.name + s.description) },
  { key: "apple", label: "Apple", icon: "", match: (s) => /apple|macos|ios|xcode|swift|mac/i.test(s.name + s.description) },
  { key: "copywriting", label: "Copywriting", icon: "", match: (s) => /copy|write|blog|article|seo|marketing/i.test(s.name + s.description) },
];

export default function SkillsList() {
  const router = useRouter();
  const confirm = useConfirm();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showCount, setShowCount] = useState(PAGE_SIZE);
  const [activeCategory, setActiveCategory] = useState("all");
  const [searchingRemote, setSearchingRemote] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/skills");
      const data = await res.json();
      const local: LocalSkill[] = (data.skills ?? []).map((s: Record<string, unknown>) => ({
        type: "local" as const,
        name: String(s.name ?? ""),
        description: String(s.description ?? ""),
        autoLoad: Boolean(s.autoLoad),
        roles: Array.isArray(s.roles) ? s.roles.map(String) : [],
        skillPath: String(s.skillPath ?? s.path ?? ""),
        skillDir: String(s.skillDir ?? ""),
      }));
      setSkills(local);
    } catch {
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  async function onDelete(name: string) {
    const ok = await confirm({
      title: `Delete Skill "${name}"`,
      message: `This will remove the skill "${name}" for all agents. This action cannot be undone.`,
      confirmLabel: "Delete Skill",
      variant: "danger",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/skills?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { alert(`Failed: ${data.error || "unknown error"}`); return; }
      await loadSkills();
    } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
  }

  async function onToggleAuto(name: string, autoLoad: boolean) {
    try {
      const res = await fetch("/api/skills", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, autoLoad }),
      });
      if (!res.ok) return;
      setSkills((prev) =>
        prev.map((s) => s.type === "local" && s.name === name ? { ...s, autoLoad } : s) as Skill[]
      );
    } catch {
      await loadSkills();
    }
  }

  async function onInstall(skill: RemoteSkill) {
    setInstalling(skill.name);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install_remote", name: skill.name, source_url: skill.source_url }),
      });
      const data = await res.json();
      if (!res.ok) { alert(`安装失败: ${data.error}`); return; }
      setSkills((prev) => [
        ...prev.filter((s) => !(s.type === "remote" && s.name === skill.name)),
        { type: "local", name: skill.name, description: skill.description, autoLoad: false, roles: [], skillPath: "", skillDir: "" } as LocalSkill,
      ]);
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setInstalling(null);
    }
  }

  // Search remote skills when query changes
  useEffect(() => {
    if (search.trim().length < 2) {
      setSkills((prev) => prev.filter((s) => s.type === "local"));
      setSearchingRemote(false);
      setRemoteError(null);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchingRemote(true);
      setRemoteError(null);
      try {
        const res = await fetch("/api/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "search_remote", query: search.trim() }),
        });
        const data = await res.json();
        const remote: RemoteSkill[] = (data.skills ?? []).map((s: Record<string, unknown>) => ({
          type: "remote" as const,
          name: String(s.name ?? ""),
          description: String(s.description ?? ""),
          source_url: String(s.source_url ?? ""),
          repo: String(s.repo ?? ""),
          trust_level: (s.trust_level === "official" || s.trust_level === "community" ? s.trust_level : "unknown") as RemoteSkill["trust_level"],
          source: String(s.source ?? ""),
        }));
        setSkills((prev) => [...prev.filter((s) => s.type === "local"), ...remote]);
      } catch {
        /* ignore */
      } finally {
        setSearchingRemote(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const cat = CATEGORIES.find((c) => c.key === activeCategory);
    return skills.filter((s) => {
      if (activeCategory === "other") {
        // "Other" = doesn't match any specific category
        const matchesSpecific = CATEGORIES.some(
          (c) => c.key !== "all" && c.key !== "other" && c.match(s)
        );
        if (matchesSpecific) return false;
      } else if (cat && !cat.match(s)) {
        return false;
      }
      if (q) {
        return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
      }
      return true;
    });
  }, [skills, search, activeCategory]);

  const visible = filtered.slice(0, showCount);
  const hasMore = showCount < filtered.length;

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of CATEGORIES) {
      counts[cat.key] = skills.filter(cat.match).length;
    }
    // "Other" = total - sum of all specific categories (avoid double-counting)
    const specificCount = CATEGORIES.filter((c) => c.key !== "all" && c.key !== "other").reduce(
      (sum, c) => sum + skills.filter(c.match).length,
      0
    );
    counts["other"] = Math.max(0, skills.length - specificCount);
    return counts;
  }, [skills]);

  useEffect(() => {
    setShowCount(PAGE_SIZE);
  }, [search, activeCategory]);

  if (loading) {
    return (
      <div className="card">
        <div className="muted mono" style={{ padding: 16 }}>Loading skills...</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 20 }}>
      {/* Left sidebar */}
      <div style={{ width: 180, flexShrink: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        <div
          className="muted mono"
          style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}
        >
          Categories
        </div>
        {CATEGORIES.map((cat) => {
          const count = categoryCounts[cat.key] || 0;
          const isActive = activeCategory === cat.key;
          return (
            <button
              key={cat.key}
              onClick={() => setActiveCategory(cat.key)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 10px",
                fontSize: 12,
                background: isActive ? "var(--cyan-dim)" : "transparent",
                color: isActive ? "var(--cyan)" : "var(--text-secondary)",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.1s ease",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </span>
              <span className="muted mono" style={{ fontSize: 10, opacity: isActive ? 1 : 0.5 }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main area */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <input
          type="text"
          placeholder="Search local + remote skills... (press / to focus)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="chat-input-field"
          style={{ width: "100%", margin: 0, marginBottom: 16, fontSize: 13 }}
        />

        {/* Top tags */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          <TagChip
            label={`All ${skills.length}`}
            active={activeCategory === "all"}
            onClick={() => setActiveCategory("all")}
          />
          <TagChip
            label={`Auto ${skills.filter((s) => s.type === "local" && s.autoLoad).length}`}
            active={activeCategory === "auto"}
            onClick={() => setActiveCategory("auto")}
            color="var(--green)"
          />
          <TagChip
            label={`Manual ${skills.filter((s) => s.type === "local" && !s.autoLoad).length}`}
            active={activeCategory === "manual"}
            onClick={() => setActiveCategory("manual")}
          />
        </div>

        {remoteError && (
          <div style={{ marginBottom: 12, padding: "8px 12px", borderRadius: "var(--radius-sm)", background: "var(--red-soft)", border: "1px solid var(--red-muted)", color: "var(--red-text)", fontSize: 13 }}>
            {remoteError}
          </div>
        )}

        {/* Card grid */}
        {visible.length === 0 ? (
          <div className="muted" style={{ padding: "24px 0" }}>
            {skills.filter((s) => s.type === "local").length === 0
              ? "No skills installed. Agents can install skills via search_skill / install_skill."
              : "No skills match the current filter."}
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            {visible.map((skill) =>
              skill.type === "local" ? (
                <LocalSkillCard key={skill.name} skill={skill} onDelete={onDelete} onToggleAuto={onToggleAuto} />
              ) : (
                <RemoteSkillCard
                  key={skill.source_url}
                  skill={skill}
                  installing={installing === skill.name}
                  onInstall={() => onInstall(skill)}
                />
              )
            )}
          </div>
        )}

        {searchingRemote && (
          <div className="muted" style={{ padding: "12px 0", fontSize: 12 }}>
            Searching remote skills...
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 20,
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
          }}
        >
          <span className="muted">
            Showing {visible.length} / {filtered.length} skills
          </span>
          {hasMore && (
            <button
              className="btn btn-primary"
              onClick={() => setShowCount((c) => c + PAGE_SIZE)}
              style={{ fontSize: 12, padding: "4px 16px", cursor: "pointer" }}
            >
              Show more ({filtered.length - showCount})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TagChip({ label, active, onClick, color }: { label: string; active: boolean; onClick: () => void; color?: string }) {
  const c = color ?? "var(--cyan)";
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11,
        padding: "3px 10px",
        background: active ? `${c}22` : "transparent",
        color: active ? c : "var(--text-secondary)",
        border: `1px solid ${active ? `${c}66` : "var(--border)"}`,
        borderRadius: 12,
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
      }}
    >
      {label}
    </button>
  );
}

function LocalSkillCard({
  skill,
  onDelete,
  onToggleAuto,
}: {
  skill: LocalSkill;
  onDelete: (name: string) => void;
  onToggleAuto: (name: string, autoLoad: boolean) => void;
}) {
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
        minHeight: 120,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono" style={{ fontWeight: 600, fontSize: 13, color: "var(--cyan)", wordBreak: "break-all" }}>
            {skill.name}
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4, maxHeight: 40, overflow: "hidden" }}>
            {skill.description}
          </div>
        </div>
        {skill.autoLoad && (
          <span
            className="mono"
            style={{
              fontSize: 9,
              color: "var(--green)",
              padding: "2px 6px",
              border: "1px solid var(--green-dim)",
              borderRadius: 3,
              flexShrink: 0,
              background: "var(--green-soft)",
            }}
          >
            ✓ auto
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 10 }}>
        {skill.roles.slice(0, 3).map((r) => (
          <span
            key={r}
            className="mono"
            style={{ fontSize: 9, color: "var(--text-dim)", padding: "1px 6px", border: "1px solid var(--border)", borderRadius: 3 }}
          >
            {r}
          </span>
        ))}
        {skill.roles.length > 3 && (
          <span className="mono" style={{ fontSize: 9, color: "var(--text-dim)" }}>
            +{skill.roles.length - 3}
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 10 }}>
        <button
          className="btn"
          onClick={() => onToggleAuto(skill.name, !skill.autoLoad)}
          style={{
            fontSize: 10,
            padding: "2px 8px",
            color: skill.autoLoad ? "var(--green)" : "var(--text-dim)",
            border: `1px solid ${skill.autoLoad ? "var(--green-dim)" : "var(--border)"}`,
            borderRadius: 4,
            cursor: "pointer",
            background: skill.autoLoad ? "var(--green-soft)" : "transparent",
            fontFamily: "var(--font-mono)",
          }}
        >
          auto {skill.autoLoad ? "✓" : "○"}
        </button>
        <button
          className="btn"
          onClick={() => void onDelete(skill.name)}
          style={{ fontSize: 10, padding: "2px 8px", color: "var(--red)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", background: "transparent" }}
        >
          Delete
        </button>
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
  const trustColors: Record<string, string> = {
    official: "var(--green)",
    community: "var(--yellow)",
    unknown: "var(--text-dim)",
  };
  const trustLabels: Record<string, string> = {
    official: "Official",
    community: "Community",
    unknown: "Unknown",
  };

  const sourceConfig: Record<string, { label: string; icon: string; color: string }> = {
    github: { label: "GitHub", icon: "", color: "var(--cyan)" },
    lobehub: { label: "LobeHub", icon: "", color: "var(--magenta)" },
    clawhub: { label: "ClawHub", icon: "", color: "var(--yellow)" },
    "skills.sh": { label: "skills.sh", icon: "", color: "var(--green)" },
  };

  const src = sourceConfig[skill.source] ?? { label: skill.source ?? "Unknown", icon: "", color: "var(--text-dim)" };

  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        padding: "14px 16px",
        border: "1px dashed var(--border)",
        borderRadius: 8,
        background: "var(--bg-card)",
        minHeight: 100,
        opacity: 0.85,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span className="mono" style={{ fontWeight: 600, fontSize: 13, color: "var(--magenta)" }}>
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
            <span
              className="mono"
              style={{
                fontSize: 9,
                color: src.color,
                padding: "1px 5px",
                border: `1px solid ${src.color}`,
                borderRadius: 3,
                background: `${src.color}11`,
              }}
            >
              {src.icon} {src.label}
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
            color: "var(--magenta)",
            border: "1px solid var(--magenta)",
            borderRadius: 4,
            cursor: installing ? "wait" : "pointer",
            background: "var(--purple-dim)",
          }}
        >
          {installing ? "Installing..." : "Install"}
        </button>
        <span className="muted mono" style={{ fontSize: 10, lineHeight: 2 }}>
          {skill.repo}
        </span>
      </div>
    </div>
  );
}

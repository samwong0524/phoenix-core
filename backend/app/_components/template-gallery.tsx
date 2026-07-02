"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Card, Button, Input } from "@/components/ui";
import { listTemplates, type WorkspaceTemplate } from "@/lib/templates";
import { chatUrl } from "./routes";

type WorkspaceDefaults = {
  workspaceId: string;
  humanAgentId: string;
  assistantAgentId: string;
  defaultGroupId: string;
};

export default function TemplateGallery() {
  const { t } = useI18n();
  const [selected, setSelected] = useState<WorkspaceTemplate | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const templates = listTemplates();

  function handleSelect(template: WorkspaceTemplate) {
    setSelected(template);
    setName(t(template.nameKey));
    setError(null);
  }

  function handleBack() {
    setSelected(null);
    setName("");
    setError(null);
  }

  async function handleCreate() {
    if (!selected) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, templateId: selected.id }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${text}`);
      const data = JSON.parse(text) as WorkspaceDefaults;
      window.location.href = chatUrl({ workspaceId: data.workspaceId });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Detail view (after selection) ──────────────────────────────

  if (selected) {
    return (
      <div>
        <Card padding="20px 24px">
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 32 }}>{selected.icon}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{t(selected.nameKey)}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                {t(selected.descKey)}
              </div>
            </div>
          </div>

          {/* Agent roster */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--text-dim)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 8,
              }}
            >
              {t("templates.agents_count", { count: String(selected.agents.length) })}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {selected.agents.map((agent) => (
                <span
                  key={agent.role}
                  style={{
                    display: "inline-block",
                    padding: "3px 10px",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    color: "var(--cyan)",
                    border: "1px solid var(--cyan-dim)",
                    borderRadius: 12,
                    background: "var(--cyan-soft)",
                  }}
                >
                  {agent.role}
                </span>
              ))}
            </div>
          </div>

          {/* Group count */}
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 20 }}>
            {selected.groups.length} {selected.groups.length === 1 ? "group" : "groups"}
          </div>

          {/* Name input */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "var(--text-dim)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 6,
              }}
            >
              {t("home.new_workspace")}
            </div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              style={{ maxWidth: 320 }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Button variant="primary" onClick={() => void handleCreate()} disabled={busy}>
              {busy ? t("templates.creating") : t("common.create")}
            </Button>
            <Button variant="ghost" onClick={handleBack} disabled={busy}>
              {t("templates.back")}
            </Button>
            {error && (
              <span className="muted" style={{ color: "var(--red-text)", fontSize: 12 }}>
                {error}
              </span>
            )}
          </div>
        </Card>
      </div>
    );
  }

  // ── Gallery grid ───────────────────────────────────────────────

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
        }}
      >
        {templates.map((template) => (
          <Card
            key={template.id}
            hoverable
            padding="16px 18px"
            onClick={() => handleSelect(template)}
          >
            {/* Icon */}
            <div
              style={{
                fontSize: template.id === "blank" ? 28 : 28,
                marginBottom: 8,
                lineHeight: 1,
                color: template.id === "blank" ? "var(--cyan)" : undefined,
                fontWeight: template.id === "blank" ? 300 : undefined,
              }}
            >
              {template.icon}
            </div>

            {/* Name */}
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
              {t(template.nameKey)}
            </div>

            {/* Description */}
            <div
              className="muted"
              style={{
                fontSize: 11,
                lineHeight: 1.4,
                marginBottom: 8,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {t(template.descKey)}
            </div>

            {/* Agent roles (max 3 pills + overflow) */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
              {template.agents.slice(0, 3).map((agent) => (
                <span
                  key={agent.role}
                  style={{
                    fontSize: 9,
                    padding: "1px 6px",
                    borderRadius: 8,
                    fontFamily: "var(--font-mono)",
                    color: "var(--cyan)",
                    background: "var(--cyan-soft)",
                    border: "1px solid var(--cyan-dim)",
                  }}
                >
                  {agent.role}
                </span>
              ))}
              {template.agents.length > 3 && (
                <span style={{ fontSize: 9, color: "var(--text-dim)", padding: "1px 4px" }}>
                  +{template.agents.length - 3}
                </span>
              )}
            </div>

            {/* Agent + group count */}
            <div
              style={{
                fontSize: 10,
                color: "var(--text-dim)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {template.agents.length} agent{template.agents.length !== 1 ? "s" : ""}
              {" · "}
              {template.groups.length} group{template.groups.length !== 1 ? "s" : ""}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

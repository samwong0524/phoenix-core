"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Button, Input } from "@/components/ui";

type WorkspaceDefaults = {
  workspaceId: string;
  humanAgentId: string;
  assistantAgentId: string;
  defaultGroupId: string;
};

export default function CreateWorkspace() {
  const { t } = useI18n();
  const [name, setName] = useState(t("workspace.default_name"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${text}`);
      const data = JSON.parse(text) as WorkspaceDefaults;
      window.location.href = `/im?workspaceId=${encodeURIComponent(data.workspaceId)}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <Input
        placeholder={t("workspace.name_placeholder")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={busy}
        style={{ maxWidth: 320 }}
      />
      <Button variant="primary" type="submit" onClick={() => void onCreate()} disabled={busy}>
        {t("workspace.create")}
      </Button>
      {error ? (
        <span className="muted" style={{ color: "#fecaca", fontSize: 13 }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Button, EmptyState } from "@/components/ui";
import { useConfirm } from "./confirm-dialog";
import { chatUrl } from "./routes";

type Workspace = { id: string; name: string; createdAt: string };

export default function WorkspacesList({ workspaces }: { workspaces: Workspace[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const confirm = useConfirm();

  async function onDelete(id: string, name: string) {
    const ok = await confirm({
      title: t("workspace.delete_tooltip", { name }),
      message: `Workspace "${name}" and all its data (agents, groups, messages, workflows) will be permanently deleted.`,
      confirmLabel: t("common.delete"),
      variant: "danger",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        alert(t("workspace.delete_failed", { error: data.error || data.message }));
        return;
      }
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  if (workspaces.length === 0) {
    return <EmptyState icon="" message={t("workspace.empty")} hint={t("workspace.empty_hint")} />;
  }

  return (
    <div className="card" style={{ maxWidth: 880 }}>
      <div className="card-title">{t("workspace.recent")}</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {workspaces.map((w) => (
          <div
            key={w.id}
            className="row"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <Link
              href={chatUrl({ workspaceId: w.id })}
              style={{ textDecoration: "none", flex: 1, minWidth: 0 }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div style={{ fontWeight: 600 }}>{w.name}</div>
                <div className="muted mono" style={{ fontSize: 12 }}>
                  {new Date(w.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="muted mono" style={{ fontSize: 12, marginTop: 6 }}>
                {w.id}
              </div>
            </Link>
            <Button
              variant="danger"
              size="sm"
              onClick={() => void onDelete(w.id, w.name)}
              title={t("workspace.delete_tooltip", { name: w.name })}
            >
              {t("common.delete")}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

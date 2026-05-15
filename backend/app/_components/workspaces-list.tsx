"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";

type Workspace = { id: string; name: string; createdAt: string };

export default function WorkspacesList({ workspaces }: { workspaces: Workspace[] }) {
  const router = useRouter();

  async function onDelete(id: string, name: string) {
    if (!confirm(`Delete workspace "${name}"?\n\nAll data (agents, groups, messages, workflows) will be permanently removed.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`Failed: ${data.error || data.message}`);
        return;
      }
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  if (workspaces.length === 0) {
    return <div className="muted">No workspaces yet. Open IM to create one.</div>;
  }

  return (
    <div className="card" style={{ maxWidth: 880 }}>
      <div className="card-title">Recent</div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {workspaces.map((w) => (
          <div
            key={w.id}
            className="row"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
          >
            <Link
              href={`/im?workspaceId=${encodeURIComponent(w.id)}`}
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
            <button
              className="btn"
              onClick={() => void onDelete(w.id, w.name)}
              style={{
                marginLeft: 12,
                flexShrink: 0,
                background: "transparent",
                border: "1px solid #666",
                color: "#f87171",
                cursor: "pointer",
                padding: "4px 10px",
                fontSize: 13,
                borderRadius: 4,
              }}
              title={`Delete workspace "${w.name}"`}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

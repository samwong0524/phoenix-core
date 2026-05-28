import Link from "next/link";

import { store } from "@/lib/storage";

import SystemStatus from "./_components/system-status";
import WorkspacesList from "./_components/workspaces-list";
import CreateWorkspace from "./_components/create-workspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  let workspaces:
    | Array<{ id: string; name: string; createdAt: string }>
    | null = null;

  try {
    workspaces = await store.listWorkspaces();
  } catch {
    // DB not ready
  }

  return (
    <div style={{ height: "100vh", overflowY: "auto", padding: "24px 24px 48px" }}>
      <div style={{ maxWidth: 960, margin: "0 auto" }}>
        {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 18, fontFamily: "var(--font-display)", color: "var(--cyan)" }}>
          PHOENIX CORE
        </h1>
        <span className="muted mono" style={{ fontSize: 11 }}>
          Agent Wechat
        </span>
      </div>

      {/* System Status */}
      <SystemStatus />

      {/* Navigation Cards */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--cyan)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontFamily: "var(--font-display)",
          marginBottom: 12,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--cyan)",
            boxShadow: "0 0 6px var(--cyan)",
          }}
        />
        快速导航
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        <NavCard
          href="/im"
          title="IM 聊天"
          desc="与 Agent 实时对话，创建群组工作流"
        />
        <NavCard
          href="/graph"
          title="图谱"
          desc="查看 Agent 关系网络"
        />
        <NavCard
          href="/skills"
          title="技能管理"
          desc="管理本地技能，搜索安装远程技能"
        />
        <NavCard
          href="http://localhost:5173"
          title="模型管理"
          desc="FreeLLMAPI — 配置 API Key，管理模型"
          external
        />
      </div>

      {/* Workspaces */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
          工作区
        </div>
        <p className="muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 13 }}>
          点击工作区打开 IM 对话，或使用右侧删除键删除。
        </p>
        <WorkspacesList workspaces={workspaces ?? []} />
      </div>

      {/* Create Workspace */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
          新建工作区
        </div>
        <CreateWorkspace />
      </div>
      </div>
    </div>
  );
}

function NavCard({
  href,
  title,
  desc,
  external,
}: {
  href: string;
  title: string;
  desc: string;
  external?: boolean;
}) {
  return (
    <Link
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener" : undefined}
      className="card"
      style={{
        display: "block",
        padding: "16px 20px",
        border: "1px solid var(--border)",
        borderRadius: 8,
        textDecoration: "none",
        color: "inherit",
        transition: "border-color 0.15s ease",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{title}</div>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>
        {desc}
      </div>
    </Link>
  );
}

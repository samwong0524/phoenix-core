import { store } from "@/lib/storage";

export default async function SystemStatus() {
  let agentCount = 0;
  let workspaceCount = 0;
  let groupCount = 0;

  try {
    const workspaces = await store.listWorkspaces();
    workspaceCount = workspaces.length;
  } catch {
    // DB not ready
  }

  try {
    const db = (await import("@/db")).getDb();
    const { sql } = await import("drizzle-orm");

    const agentRows = await db.execute(sql`SELECT COUNT(*) as cnt FROM agents`);
    agentCount = Number(((agentRows as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 0));

    const groupRows = await db.execute(sql`SELECT COUNT(*) as cnt FROM groups`);
    groupCount = Number(((groupRows as unknown as Array<{ cnt: number }>)[0]?.cnt ?? 0));
  } catch {
    // DB not ready
  }

  const provider = process.env.LLM_PROVIDER || "glm";
  const skillsDir = process.env.AGENT_SKILLS_DIR;
  let skillCount = 0;

  try {
    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    const { existsSync } = await import("node:fs");

    const candidates = [
      skillsDir ? path.resolve(skillsDir) : null,
      path.resolve(process.cwd(), "skills"),
      path.resolve(process.cwd(), "backend", "skills"),
    ].filter((v): v is string => Boolean(v));
    const dir = candidates.find((d) => existsSync(d));
    if (dir) {
      const entries = await fs.readdir(dir);
      skillCount = entries.filter((e) =>
        existsSync(path.join(dir, e, "SKILL.md"))
      ).length;
    }
  } catch {
    // Skills dir not found
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: 12,
        marginBottom: 20,
      }}
    >
      <StatCard label="Provider" value={provider} color="var(--cyan)" />
      <StatCard label="Agents" value={String(agentCount)} color="var(--green)" />
      <StatCard label="Skills" value={String(skillCount)} color="var(--magenta)" />
      <StatCard label="Groups" value={String(groupCount)} color="var(--purple)" />
      <StatCard label="Workspaces" value={String(workspaceCount)} color="var(--yellow)" />
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      className="card"
      style={{
        padding: "12px 16px",
        borderLeft: `3px solid ${color}`,
        background: "var(--bg-card)",
      }}
    >
      <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>
        {label}
      </div>
      <div
        className="mono"
        style={{ fontSize: 20, fontWeight: 700, color }}
      >
        {value}
      </div>
    </div>
  );
}

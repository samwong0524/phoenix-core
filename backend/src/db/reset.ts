// Reset database: drop all tables, then re-create schema
import { getSql } from "./client";

async function resetDatabase() {
  const sql = getSql();

  console.log("Dropping all tables...");

  // Drop in reverse dependency order
  const tables = [
    "agent_assignments",
    "task_logs",
    "tasks",
    "workflows",
    "skill_usage",
    "session_archive",
    "agent_forum",
    "agent_diary",
    "memories",
    "backups",
    "messages",
    "group_members",
    "groups",
    "agents",
    "workspaces",
  ];

  for (const table of tables) {
    await sql.unsafe(`DROP TABLE IF EXISTS "${table}" CASCADE`);
    console.log(`  Dropped ${table}`);
  }

  console.log("Re-creating schema...");
  const { ensureSchema } = await import("./init");
  await ensureSchema();
  console.log("Schema created.");
  console.log("Database reset complete.");

  process.exit(0);
}

resetDatabase().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});

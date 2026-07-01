import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export async function GET(): Promise<NextResponse> {
  const db = getDb();

  try {
    const totals = await db.execute(
      sql`SELECT
        COUNT(*) as all_time,
        COUNT(*) FILTER (WHERE used_at > NOW() - INTERVAL '7 days') as last_7_days,
        COUNT(*) FILTER (WHERE used_at > NOW() - INTERVAL '24 hours') as last_24_hours
      FROM skill_usage
      WHERE status = 'active'`
    );
    const t = (totals as Array<Record<string, unknown>>)[0] ?? {};

    const perSkillRows = await db.execute(
      sql`SELECT
        skill_name,
        COUNT(*) as total_calls,
        ROUND(100.0 * COUNT(*) FILTER (WHERE success = true) / NULLIF(COUNT(*), 0), 2) as success_rate,
        MAX(used_at) as last_used,
        COUNT(DISTINCT agent_id) as agent_count
      FROM skill_usage
      WHERE status = 'active'
      GROUP BY skill_name
      ORDER BY total_calls DESC`
    );

    const perSkill = (perSkillRows as Array<Record<string, unknown>>).map((r) => ({
      skillName: r.skill_name as string,
      totalCalls: Number(r.total_calls ?? 0),
      successRate: Number(r.success_rate ?? 0),
      lastUsed: r.last_used as string,
      agentCount: Number(r.agent_count ?? 0),
    }));

    const topRows = await db.execute(
      sql`SELECT skill_name, COUNT(*) as total_calls
      FROM skill_usage
      WHERE status = 'active'
      GROUP BY skill_name
      ORDER BY total_calls DESC
      LIMIT 10`
    );

    const topSkills = (topRows as Array<Record<string, unknown>>).map((r) => ({
      skillName: r.skill_name as string,
      totalCalls: Number(r.total_calls ?? 0),
    }));

    return NextResponse.json({
      totalInvocations: {
        allTime: Number(t.all_time ?? 0),
        last7Days: Number(t.last_7_days ?? 0),
        last24Hours: Number(t.last_24_hours ?? 0),
      },
      perSkill,
      topSkills,
    });
  } catch (error) {
    console.error("Failed to fetch skill stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch skill statistics" },
      { status: 500 }
    );
  }
}

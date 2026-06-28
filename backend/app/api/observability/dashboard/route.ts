// app/api/observability/dashboard/route.ts
// Observability Dashboard API — 聚合查询 metrics_hourly, alert_events, cost_daily

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const db = getDb();
  const hours = Number(req.nextUrl.searchParams.get("hours") || 24);
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400 * 1000).toISOString().split("T")[0];

  try {
    const [metrics, alerts, dailyCost, summaryRows] = await Promise.all([
      // Hourly metrics
      db.execute(sql`
        SELECT hour, SUM(request_count) AS request_count, SUM(success_count) AS success_count,
               SUM(error_count) AS error_count, SUM(timeout_count) AS timeout_count,
               SUM(fallback_count) AS fallback_count,
               AVG(latency_p50) AS latency_p50, AVG(latency_p95) AS latency_p95,
               AVG(latency_avg) AS latency_avg, AVG(ttft_p50) AS ttft_p50,
               SUM(tokens_total) AS tokens_total, SUM(cost_total_usd) AS cost_total_usd,
               SUM(tool_call_total) AS tool_call_total
        FROM metrics_hourly
        WHERE hour >= ${since}
        GROUP BY hour
        ORDER BY hour ASC
      `),

      // Recent alerts
      db.execute(sql`
        SELECT id, alert_name, severity, metric_name, metric_value, threshold,
               condition_desc, resolved, created_at
        FROM alert_events
        ORDER BY created_at DESC
        LIMIT 20
      `),

      // Daily cost
      db.execute(sql`
        SELECT date, SUM(cost_usd) AS cost, SUM(tokens_total) AS tokens, SUM(request_count) AS requests
        FROM cost_daily
        WHERE date >= ${sevenDaysAgo}::date
        GROUP BY date
        ORDER BY date DESC
      `),

      // Summary (directly from llm_requests for real-time)
      db.execute(sql`
        SELECT
          COUNT(*) AS total_requests,
          COUNT(*) FILTER (WHERE finish_reason IN ('stop', 'tool_calls')) AS success_count,
          AVG(latency_ms) AS avg_latency,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency,
          SUM(cost_usd) AS total_cost,
          SUM(tokens_total) AS total_tokens
        FROM llm_requests
        WHERE created_at >= ${since}
      `),
    ]);

    const summaryRow = summaryRows[0] || {};
    const totalReqs = Number(summaryRow.total_requests || 0);
    const successCount = Number(summaryRow.success_count || 0);

    return NextResponse.json({
      metrics,
      alerts,
      dailyCost: dailyCost,
      summary: {
        totalRequests: totalReqs,
        successRate: totalReqs > 0 ? successCount / totalReqs : 1,
        avgLatency: Number(summaryRow.avg_latency || 0),
        p95Latency: Number(summaryRow.p95_latency || 0),
        totalCost: Number(summaryRow.total_cost || 0),
        totalTokens: Number(summaryRow.total_tokens || 0),
      },
    });
  } catch (err: any) {
    // If observability tables don't exist yet, return empty data
    if (err?.message?.includes("does not exist") || err?.code === "42P01") {
      return NextResponse.json({
        metrics: [],
        alerts: [],
        dailyCost: [],
        summary: { totalRequests: 0, successRate: 1, avgLatency: 0, p95Latency: 0, totalCost: 0, totalTokens: 0 },
        _warning: "Observability tables not initialized. Run observability/db-schema.sql first.",
      });
    }
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

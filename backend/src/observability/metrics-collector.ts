// src/observability/metrics-collector.ts
// Phoenix-Core observability — metrics collection integrated into agent-runtime

import { getDb } from "@/db";
import { sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────

export interface LLMRequestRecord {
  requestId: string;
  agentId: string;
  groupId?: string;
  workspaceId: string;
  provider: string;
  model: string;
  isFallback: boolean;
  tokensPrompt: number;
  tokensCompletion: number;
  tokensTotal: number;
  tokensCached: number;
  latencyMs: number;
  ttftMs?: number;
  queueWaitMs: number;
  finishReason: string;
  toolCallCount: number;
  errorMessage?: string;
  httpStatus?: number;
  costUsd: number;
}

// ─── Cost Estimation ──────────────────────────────────

const MODEL_PRICING: Record<string, { promptPer1k: number; completionPer1k: number }> = {
  "glm-4.7":           { promptPer1k: 0.0007, completionPer1k: 0.0007 },
  "glm-4-flash":       { promptPer1k: 0.0001, completionPer1k: 0.0001 },
  "gpt-4o":            { promptPer1k: 0.0025, completionPer1k: 0.0100 },
  "gpt-4o-mini":       { promptPer1k: 0.00015, completionPer1k: 0.0006 },
  "claude-sonnet-4-20250514": { promptPer1k: 0.003, completionPer1k: 0.015 },
  "qwen3:8b":          { promptPer1k: 0, completionPer1k: 0 },
  "default":           { promptPer1k: 0.002, completionPer1k: 0.008 },
};

export function estimateCost(model: string, tokensPrompt: number, tokensCompletion: number): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING["default"];
  return (tokensPrompt / 1000) * pricing.promptPer1k +
         (tokensCompletion / 1000) * pricing.completionPer1k;
}

// ─── Metrics Collector ────────────────────────────────

let _instance: MetricsCollector | null = null;

export function getMetricsCollector(): MetricsCollector {
  if (!_instance) _instance = new MetricsCollector();
  return _instance;
}

export class MetricsCollector {
  private metricTimers: ReturnType<typeof setInterval>[] = [];

  async recordLLMRequest(record: LLMRequestRecord): Promise<void> {
    try {
      const db = getDb();
      await db.execute(sql`
        INSERT INTO llm_requests (
          request_id, agent_id, group_id, workspace_id,
          provider, model, is_fallback,
          tokens_prompt, tokens_completion, tokens_total, tokens_cached,
          latency_ms, ttft_ms, queue_wait_ms,
          finish_reason, tool_call_count, error_message, http_status,
          cost_usd
        ) VALUES (
          ${record.requestId}, ${record.agentId}, ${record.groupId || null}, ${record.workspaceId},
          ${record.provider}, ${record.model}, ${record.isFallback},
          ${record.tokensPrompt}, ${record.tokensCompletion}, ${record.tokensTotal}, ${record.tokensCached},
          ${record.latencyMs}, ${record.ttftMs || null}, ${record.queueWaitMs},
          ${record.finishReason}, ${record.toolCallCount}, ${record.errorMessage || null}, ${record.httpStatus || null},
          ${record.costUsd}
        )
      `);
    } catch (err) {
      console.error("[metrics] Failed to record LLM request:", err);
    }
  }

  // ── Hourly Rollup ──

  async runHourlyRollup(hourStart?: Date): Promise<void> {
    const hour = hourStart ?? new Date(Date.now() - 3600_000);
    // Align to hour boundary
    const aligned = new Date(hour);
    aligned.setMinutes(0, 0, 0);
    const hourEnd = new Date(aligned.getTime() + 3600_000);

    try {
      const db = getDb();
      await db.execute(sql`
        INSERT INTO metrics_hourly (
          hour, workspace_id, agent_id, provider,
          request_count, success_count, error_count, timeout_count, fallback_count,
          latency_p50, latency_p90, latency_p95, latency_p99, latency_avg,
          ttft_p50, ttft_p95,
          tokens_prompt_total, tokens_completion_total, tokens_total,
          cost_total_usd, tool_call_total, tool_error_total
        )
        SELECT
          ${aligned.toISOString()}, workspace_id, agent_id, provider,
          COUNT(*)::INTEGER,
          (COUNT(*) FILTER (WHERE finish_reason IN ('stop', 'tool_calls')))::INTEGER,
          (COUNT(*) FILTER (WHERE finish_reason = 'error'))::INTEGER,
          (COUNT(*) FILTER (WHERE finish_reason = 'timeout'))::INTEGER,
          (COUNT(*) FILTER (WHERE is_fallback = true))::INTEGER,
          (PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms))::INTEGER,
          (PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY latency_ms))::INTEGER,
          (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms))::INTEGER,
          (PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms))::INTEGER,
          AVG(latency_ms)::INTEGER,
          (PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ttft_ms) FILTER (WHERE ttft_ms IS NOT NULL))::INTEGER,
          (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ttft_ms) FILTER (WHERE ttft_ms IS NOT NULL))::INTEGER,
          SUM(tokens_prompt), SUM(tokens_completion), SUM(tokens_total),
          SUM(cost_usd),
          (SUM(tool_call_count))::INTEGER,
          (COUNT(*) FILTER (WHERE finish_reason = 'error' AND tool_call_count > 0))::INTEGER
        FROM llm_requests
        WHERE created_at >= ${aligned.toISOString()}
          AND created_at < ${hourEnd.toISOString()}
        GROUP BY workspace_id, agent_id, provider
        ON CONFLICT (hour, workspace_id, agent_id, provider) DO UPDATE SET
          request_count = EXCLUDED.request_count,
          success_count = EXCLUDED.success_count,
          error_count = EXCLUDED.error_count,
          timeout_count = EXCLUDED.timeout_count,
          fallback_count = EXCLUDED.fallback_count,
          latency_p50 = EXCLUDED.latency_p50,
          latency_p90 = EXCLUDED.latency_p90,
          latency_p95 = EXCLUDED.latency_p95,
          latency_p99 = EXCLUDED.latency_p99,
          latency_avg = EXCLUDED.latency_avg,
          ttft_p50 = EXCLUDED.ttft_p50,
          ttft_p95 = EXCLUDED.ttft_p95,
          tokens_prompt_total = EXCLUDED.tokens_prompt_total,
          tokens_completion_total = EXCLUDED.tokens_completion_total,
          tokens_total = EXCLUDED.tokens_total,
          cost_total_usd = EXCLUDED.cost_total_usd,
          tool_call_total = EXCLUDED.tool_call_total,
          tool_error_total = EXCLUDED.tool_error_total
      `);
    } catch (err) {
      console.error("[metrics] Hourly rollup failed:", err);
    }
  }

  // ── Daily Cost Rollup ──

  async runDailyCostRollup(date?: Date): Promise<void> {
    const d = date ?? new Date();
    const dateStr = d.toISOString().split("T")[0];

    try {
      const db = getDb();
      await db.execute(sql`
        INSERT INTO cost_daily (date, workspace_id, provider, model, request_count, tokens_total, cost_usd)
        SELECT
          ${dateStr}::date, workspace_id, provider, model,
          COUNT(*)::INTEGER, SUM(tokens_total), SUM(cost_usd)
        FROM llm_requests
        WHERE created_at::date = ${dateStr}::date
        GROUP BY workspace_id, provider, model
        ON CONFLICT (date, workspace_id, provider, model) DO UPDATE SET
          request_count = EXCLUDED.request_count,
          tokens_total = EXCLUDED.tokens_total,
          cost_usd = EXCLUDED.cost_usd
      `);
    } catch (err) {
      console.error("[metrics] Daily cost rollup failed:", err);
    }
  }

  // ── Alert Evaluation ──

  async evaluateAlerts(): Promise<void> {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    try {
      const db = getDb();
      const stats = await db.execute(sql`
        SELECT
          COUNT(*)::INTEGER AS total,
          (COUNT(*) FILTER (WHERE finish_reason IN ('stop', 'tool_calls')))::INTEGER AS success,
          (COUNT(*) FILTER (WHERE finish_reason = 'error'))::INTEGER AS errors,
          (COUNT(*) FILTER (WHERE finish_reason = 'timeout'))::INTEGER AS timeouts,
          AVG(latency_ms) AS avg_latency,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency,
          SUM(cost_usd) AS total_cost,
          SUM(tokens_total) AS total_tokens
        FROM llm_requests
        WHERE created_at >= ${fiveMinAgo.toISOString()}
      `);

      const row = stats[0] as Record<string, unknown>;
      if (!row || Number(row.total) === 0) return;

      const successRate = Number(row.success) / Number(row.total);
      const p95 = Number(row.p95_latency);
      const timeoutRate = Number(row.timeouts) / Number(row.total);

      if (successRate < 0.95 && Number(row.total) >= 10) {
        await this.emitAlert({
          alertName: "Agent 成功率下降",
          severity: "critical",
          metricName: "agent_success_rate",
          metricValue: successRate * 100,
          threshold: 95,
          conditionDesc: `成功率 ${(successRate * 100).toFixed(1)}% < 95% (5分钟窗口, ${row.total} 次请求)`,
        });
      }

      if (p95 > 15000) {
        await this.emitAlert({
          alertName: "Agent P95 延迟过高",
          severity: "critical",
          metricName: "agent_latency_p95",
          metricValue: p95,
          threshold: 15000,
          conditionDesc: `P95 延迟 ${p95.toFixed(0)}ms > 15000ms`,
        });
      }

      if (timeoutRate > 0.05 && Number(row.total) >= 10) {
        await this.emitAlert({
          alertName: "Agent 超时率上升",
          severity: "warning",
          metricName: "agent_timeout_rate",
          metricValue: timeoutRate * 100,
          threshold: 5,
          conditionDesc: `超时率 ${(timeoutRate * 100).toFixed(1)}% > 5%`,
        });
      }
    } catch (err) {
      console.error("[metrics] Alert evaluation failed:", err);
    }
  }

  private async emitAlert(alert: {
    alertName: string; severity: string; metricName: string;
    metricValue: number; threshold: number; conditionDesc: string;
    context?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const db = getDb();
      await db.execute(sql`
        INSERT INTO alert_events (alert_name, severity, metric_name, metric_value, threshold, condition_desc, context)
        VALUES (${alert.alertName}, ${alert.severity}, ${alert.metricName},
                ${alert.metricValue}, ${alert.threshold}, ${alert.conditionDesc},
                ${JSON.stringify(alert.context || {})})
      `);
    } catch (err) {
      console.error("[metrics] Failed to record alert:", err);
    }
  }

  // ── Periodic Timers ──

  startTimers(): void {
    if (this.metricTimers.length > 0) return; // already started

    // Hourly rollup — every hour
    const hourlyTimer = setInterval(() => {
      void this.runHourlyRollup();
    }, 3_600_000);
    hourlyTimer.unref();
    this.metricTimers.push(hourlyTimer);

    // Daily cost rollup — every 24 hours
    const dailyTimer = setInterval(() => {
      void this.runDailyCostRollup();
    }, 86_400_000);
    dailyTimer.unref();
    this.metricTimers.push(dailyTimer);

    // Alert evaluation — every 5 minutes
    const alertTimer = setInterval(() => {
      void this.evaluateAlerts();
    }, 300_000);
    alertTimer.unref();
    this.metricTimers.push(alertTimer);
  }
}

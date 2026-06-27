// observability/metrics-collector.ts
// Phoenix-Core 可观测性 — 指标采集器
//
// 职责：
//   1. 拦截 LLM 调用事件，记录延迟/Token/成本到 llm_requests 表
//   2. 从 UI Bus 事件中提取追踪 span 数据
//   3. 定时 rollup 小时级聚合指标
//   4. 检测告警条件并触发
//
// 集成方式：在 agent-runtime.ts 的 LLM 调用链路中注入 hooks

import { eq, sql, and, gte, lte } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────

export interface LLMRequestRecord {
  requestId: string;
  agentId: string;
  groupId?: string;
  workspaceId: string;
  provider: string;
  model: string;
  promptVersion?: string;
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

export interface TraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  agentId?: string;
  operation: "input_validation" | "llm_call" | "tool_exec" | "output_format" | "message_routing";
  spanName: string;
  status: "ok" | "error" | "timeout";
  durationMs: number;
  attributes: Record<string, unknown>;
  events?: Array<{ timestamp: string; name: string; attributes?: Record<string, unknown> }>;
}

export interface AlertEvent {
  alertName: string;
  severity: "critical" | "warning" | "info";
  metricName: string;
  metricValue: number;
  threshold: number;
  conditionDesc: string;
  context?: Record<string, unknown>;
}

// ─── Cost Estimation ──────────────────────────────────

const MODEL_PRICING: Record<string, { promptPer1k: number; completionPer1k: number }> = {
  // 价格单位: USD per 1K tokens (可随模型更新调整)
  "glm-4.7":           { promptPer1k: 0.0007, completionPer1k: 0.0007 },
  "glm-4-flash":       { promptPer1k: 0.0001, completionPer1k: 0.0001 },
  "gpt-4o":            { promptPer1k: 0.0025, completionPer1k: 0.0100 },
  "gpt-4o-mini":       { promptPer1k: 0.00015, completionPer1k: 0.0006 },
  "claude-sonnet-4-20250514": { promptPer1k: 0.003, completionPer1k: 0.015 },
  "qwen3:8b":          { promptPer1k: 0, completionPer1k: 0 },  // 本地模型
  "default":           { promptPer1k: 0.002, completionPer1k: 0.008 },
};

export function estimateCost(model: string, tokensPrompt: number, tokensCompletion: number): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING["default"];
  return (tokensPrompt / 1000) * pricing.promptPer1k +
         (tokensCompletion / 1000) * pricing.completionPer1k;
}

// ─── Metrics Collector ────────────────────────────────

export class MetricsCollector {
  private db: any; // Drizzle ORM instance
  private alertCallbacks: Array<(alert: AlertEvent) => void> = [];
  private pendingSpans: TraceSpan[] = [];

  constructor(db: any) {
    this.db = db;
  }

  // ── LLM Request Recording ──

  async recordLLMRequest(record: LLMRequestRecord): Promise<void> {
    try {
      await this.db.execute(sql`
        INSERT INTO llm_requests (
          request_id, agent_id, group_id, workspace_id,
          provider, model, prompt_version, is_fallback,
          tokens_prompt, tokens_completion, tokens_total, tokens_cached,
          latency_ms, ttft_ms, queue_wait_ms,
          finish_reason, tool_call_count, error_message, http_status,
          cost_usd
        ) VALUES (
          ${record.requestId}, ${record.agentId}, ${record.groupId || null}, ${record.workspaceId},
          ${record.provider}, ${record.model}, ${record.promptVersion || null}, ${record.isFallback},
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

  // ── Trace Span Recording ──

  async recordSpan(span: TraceSpan): Promise<void> {
    try {
      await this.db.execute(sql`
        INSERT INTO trace_spans (
          trace_id, span_id, parent_span_id, agent_id,
          operation, span_name, status, duration_ms,
          attributes, events
        ) VALUES (
          ${span.traceId}, ${span.spanId}, ${span.parentSpanId || null}, ${span.agentId || null},
          ${span.operation}, ${span.spanName}, ${span.status}, ${span.durationMs},
          ${JSON.stringify(span.attributes)}, ${JSON.stringify(span.events || [])}
        )
      `);
    } catch (err) {
      console.error("[metrics] Failed to record span:", err);
    }
  }

  // ── Hourly Rollup ──
  // 每小时执行一次，从 llm_requests 聚合到 metrics_hourly

  async runHourlyRollup(hourStart: Date): Promise<void> {
    const hourEnd = new Date(hourStart.getTime() + 3600 * 1000);

    try {
      await this.db.execute(sql`
        INSERT INTO metrics_hourly (
          hour, workspace_id, agent_id, provider,
          request_count, success_count, error_count, timeout_count, fallback_count,
          latency_p50, latency_p90, latency_p95, latency_p99, latency_avg,
          ttft_p50, ttft_p95,
          tokens_prompt_total, tokens_completion_total, tokens_total,
          cost_total_usd, tool_call_total, tool_error_total
        )
        SELECT
          ${hourStart.toISOString()}, workspace_id, agent_id, provider,
          COUNT(*) AS request_count,
          COUNT(*) FILTER (WHERE finish_reason IN ('stop', 'tool_calls')) AS success_count,
          COUNT(*) FILTER (WHERE finish_reason = 'error') AS error_count,
          COUNT(*) FILTER (WHERE finish_reason = 'timeout') AS timeout_count,
          COUNT(*) FILTER (WHERE is_fallback = true) AS fallback_count,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms),
          PERCENTILE_CONT(0.90) WITHIN GROUP (ORDER BY latency_ms),
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms),
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms),
          AVG(latency_ms)::INTEGER,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY ttft_ms) FILTER (WHERE ttft_ms IS NOT NULL),
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY ttft_ms) FILTER (WHERE ttft_ms IS NOT NULL),
          SUM(tokens_prompt), SUM(tokens_completion), SUM(tokens_total),
          SUM(cost_usd),
          SUM(tool_call_count),
          COUNT(*) FILTER (WHERE finish_reason = 'error' AND tool_call_count > 0)
        FROM llm_requests
        WHERE created_at >= ${hourStart.toISOString()}
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

  async runDailyCostRollup(date: Date): Promise<void> {
    const dateStr = date.toISOString().split("T")[0];

    try {
      await this.db.execute(sql`
        INSERT INTO cost_daily (date, workspace_id, provider, model, request_count, tokens_total, cost_usd)
        SELECT
          ${dateStr}, workspace_id, provider, model,
          COUNT(*), SUM(tokens_total), SUM(cost_usd)
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
  // 每 5 分钟运行一次，检查最近 5 分钟的指标是否触发告警

  onAlert(callback: (alert: AlertEvent) => void): void {
    this.alertCallbacks.push(callback);
  }

  private emitAlert(alert: AlertEvent): void {
    // 记录到 DB
    this.db.execute(sql`
      INSERT INTO alert_events (alert_name, severity, metric_name, metric_value, threshold, condition_desc, context)
      VALUES (${alert.alertName}, ${alert.severity}, ${alert.metricName},
              ${alert.metricValue}, ${alert.threshold}, ${alert.conditionDesc},
              ${JSON.stringify(alert.context || {})})
    `).catch((err: unknown) => console.error("[metrics] Failed to record alert:", err));

    // 通知回调
    for (const cb of this.alertCallbacks) {
      try { cb(alert); } catch { /* ignore */ }
    }
  }

  async evaluateAlerts(): Promise<void> {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    try {
      const stats = await this.db.execute(sql`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE finish_reason IN ('stop', 'tool_calls')) AS success,
          COUNT(*) FILTER (WHERE finish_reason = 'error') AS errors,
          COUNT(*) FILTER (WHERE finish_reason = 'timeout') AS timeouts,
          AVG(latency_ms) AS avg_latency,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95_latency,
          SUM(cost_usd) AS total_cost,
          SUM(tokens_total) AS total_tokens
        FROM llm_requests
        WHERE created_at >= ${fiveMinAgo.toISOString()}
      `);

      const row = stats[0];
      if (!row || row.total === 0) return;

      const successRate = Number(row.success) / Number(row.total);
      const p95 = Number(row.p95_latency);
      const timeoutRate = Number(row.timeouts) / Number(row.total);

      // 成功率告警
      if (successRate < 0.95 && Number(row.total) >= 10) {
        this.emitAlert({
          alertName: "Agent 成功率下降",
          severity: "critical",
          metricName: "agent_success_rate",
          metricValue: successRate * 100,
          threshold: 95,
          conditionDesc: `成功率 ${(successRate * 100).toFixed(1)}% < 95% (5分钟窗口, ${row.total} 次请求)`,
        });
      }

      // P95 延迟告警
      if (p95 > 15000) {
        this.emitAlert({
          alertName: "Agent P95 延迟过高",
          severity: "critical",
          metricName: "agent_latency_p95",
          metricValue: p95,
          threshold: 15000,
          conditionDesc: `P95 延迟 ${p95.toFixed(0)}ms > 15000ms`,
        });
      }

      // 超时率告警
      if (timeoutRate > 0.05 && Number(row.total) >= 10) {
        this.emitAlert({
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

  // ── Query Helpers (供 Dashboard API 使用) ──

  async getRecentMetrics(hours: number = 24) {
    const since = new Date(Date.now() - hours * 3600 * 1000);
    return this.db.execute(sql`
      SELECT * FROM metrics_hourly
      WHERE hour >= ${since.toISOString()}
      ORDER BY hour DESC
    `);
  }

  async getRecentAlerts(limit: number = 20) {
    return this.db.execute(sql`
      SELECT * FROM alert_events
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
  }

  async getDailyCost(days: number = 30) {
    const since = new Date(Date.now() - days * 86400 * 1000);
    return this.db.execute(sql`
      SELECT date, SUM(cost_usd) AS cost, SUM(tokens_total) AS tokens, SUM(request_count) AS requests
      FROM cost_daily
      WHERE date >= ${since.toISOString().split("T")[0]}::date
      GROUP BY date
      ORDER BY date DESC
    `);
  }

  async getTraceSpans(traceId: string) {
    return this.db.execute(sql`
      SELECT * FROM trace_spans
      WHERE trace_id = ${traceId}
      ORDER BY started_at ASC
    `);
  }
}

// ─── Integration Hook ─────────────────────────────────
// 在 agent-runtime.ts 中调用：
//
//   import { MetricsCollector, estimateCost } from "@/observability/metrics-collector";
//
//   const metrics = new MetricsCollector(db);
//
//   // 在 LLM 调用前后：
//   const startTime = Date.now();
//   const ttftStart = Date.now(); // 收到第一个 token 时记录
//   ...LLM call...
//   metrics.recordLLMRequest({
//     requestId, agentId, groupId, workspaceId,
//     provider, model, promptVersion,
//     isFallback: usedFallback,
//     tokensPrompt: usage.promptTokens,
//     tokensCompletion: usage.completionTokens,
//     tokensTotal: usage.totalTokens,
//     tokensCached: usage.cachedTokens || 0,
//     latencyMs: Date.now() - startTime,
//     ttftMs: Date.now() - ttftStart,
//     queueWaitMs: queueWaitTime,
//     finishReason,
//     toolCallCount: toolCalls.length,
//     costUsd: estimateCost(model, usage.promptTokens, usage.completionTokens),
//   });
//
//   // 定时任务（用 node-cron 或 setInterval）：
//   setInterval(() => metrics.runHourlyRollup(new Date(/* aligned hour */)), 3600_000);
//   setInterval(() => metrics.runDailyCostRollup(new Date()), 86400_000);
//   setInterval(() => metrics.evaluateAlerts(), 300_000);  // 每 5 分钟

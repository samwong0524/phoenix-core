# Phoenix-Core 可观测性设计规格

## 架构概览

Phoenix-Core 的可观测性建立在三个支柱之上，利用现有的 PostgreSQL + Redis 基础设施，不引入额外依赖。

```
┌─────────────────────────────────────────────────────────────────┐
│                    Phoenix-Core Next.js App                       │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │ Agent Runtime│  │  Event Bus   │  │  Existing File Logs     │ │
│  │  (LLM calls) │→ │  (UI Bus)    │  │  .agent_logs/           │ │
│  │              │  │              │  │  .agent_stream_logs/     │ │
│  └──────┬───────┘  └──────┬───────┘  │  .agent_llm_requests/   │ │
│         │                 │          └─────────────────────────┘ │
│         ▼                 ▼                                       │
│  ┌──────────────────────────────────┐                            │
│  │    MetricsCollector              │                            │
│  │  - recordLLMRequest()            │                            │
│  │  - recordSpan()                  │                            │
│  │  - runHourlyRollup()             │                            │
│  │  - evaluateAlerts()              │                            │
│  └──────────────┬───────────────────┘                            │
│                 ▼                                                 │
│  ┌──────────────────────────────────┐                            │
│  │        PostgreSQL                │                            │
│  │  llm_requests  (逐条 LLM 调用)   │                            │
│  │  trace_spans   (追踪树)          │                            │
│  │  metrics_hourly (小时聚合)       │                            │
│  │  alert_events  (告警记录)        │                            │
│  │  cost_daily    (日成本汇总)      │                            │
│  └──────────────┬───────────────────┘                            │
│                 ▼                                                 │
│  ┌──────────────────────────────────┐                            │
│  │  /api/observability/dashboard    │                            │
│  │  /observability (React 看板)     │                            │
│  └──────────────────────────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

## 文件清单

| 文件 | 用途 |
|------|------|
| `observability/db-schema.sql` | 5 张新表的 DDL（llm_requests, trace_spans, metrics_hourly, alert_events, cost_daily） |
| `observability/metrics-collector.ts` | 指标采集器：LLM 记录、追踪 span、小时 rollup、告警评估、成本估算 |
| `observability/alerts.yaml` | 告警规则：4 组 12 条规则覆盖可用性/性能/质量/成本 |
| `observability/checklist.md` | 上线检查清单 |
| `backend/app/observability/page.tsx` | React 看板组件：6 个统计卡片 + 请求量图 + 成本表 + 告警列表 |
| `backend/app/api/observability/dashboard/route.ts` | 看板 API：聚合查询 metrics_hourly + alert_events + cost_daily |

## 现有基础（已收集，无需新增）

| 数据源 | 位置 | 用途 |
|--------|------|------|
| Agent History 快照 | `.agent_logs/agent-{id}.jsonl` | 调试/审计：每轮完整上下文 |
| Stream 追踪 | `.agent_stream_logs/` | 行为调试：reasoning/content/tool_calls |
| LLM 请求体 | `.agent_llm_requests/` | 请求重放：完整 API 请求（key 已脱敏） |
| 事件流 | Event Bus + UI Bus | 实时推送：agent.stream/done/error |
| 决策审计 | `agent_decisions` 表 | 决策记录：含 confidence 和 human_feedback |
| Skill 调用 | `skill_usage` 表 | Skill 使用追踪 |
| Pipeline 执行 | `pipeline_executions` 表 | 多步编排：stage 级别 start/end/status |

## 核心缺口（本次设计覆盖）

| 缺口 | 解决方案 |
|------|---------|
| LLM 延迟没持久化 | llm_requests.latency_ms + ttft_ms |
| Token 消耗只存最新值不累计 | llm_requests 逐条记录 + metrics_hourly 聚合 |
| 无成本估算 | MODEL_PRICING 表 + cost_usd 字段 + cost_daily |
| 无追踪 | trace_spans 表（树状结构，parent_span_id） |
| 无告警 | alerts.yaml 规则 + evaluateAlerts() + alert_events 表 |
| 无看板 | /observability React 页面 + dashboard API |
| 无结构化日志 | LLMRequestRecord schema + JSON 格式写入 DB |

## 集成方式

### 1. 初始化数据库

```bash
cd backend
psql $DATABASE_URL -f ../observability/db-schema.sql
```

### 2. 集成 MetricsCollector

在 `agent-runtime.ts` 的 LLM 调用链路中添加 hooks：

```typescript
import { MetricsCollector, estimateCost } from "@/observability/metrics-collector";

const metrics = new MetricsCollector(db);

// 在每次 LLM 调用完成后：
const startTime = performance.now();
// ... LLM call ...
const elapsed = performance.now() - startTime;

await metrics.recordLLMRequest({
  requestId: crypto.randomUUID(),
  agentId, groupId, workspaceId,
  provider, model,
  isFallback: usedFallback,
  tokensPrompt: usage.promptTokens,
  tokensCompletion: usage.completionTokens,
  tokensTotal: usage.totalTokens,
  tokensCached: 0,
  latencyMs: Math.round(elapsed),
  ttftMs: ttftTime,
  queueWaitMs: waitTime,
  finishReason,
  toolCallCount: toolCalls.length,
  costUsd: estimateCost(model, usage.promptTokens, usage.completionTokens),
});
```

### 3. 启动定时任务

```typescript
// 每小时聚合
setInterval(() => {
  const hourStart = new Date();
  hourStart.setMinutes(0, 0, 0);
  metrics.runHourlyRollup(hourStart);
}, 3600_000);

// 每日成本
setInterval(() => metrics.runDailyCostRollup(new Date()), 86400_000);

// 每 5 分钟告警检查
setInterval(() => metrics.evaluateAlerts(), 300_000);
```

### 4. 访问看板

启动服务后访问 `http://localhost:3100/observability`

## 采样策略

| 数据类型 | 采样率 | 理由 |
|----------|--------|------|
| ERROR 级 LLM 请求 | 100% | 失败必须全量记录 |
| WARN 级 LLM 请求 | 100% | 异常恢复场景需要完整链路 |
| INFO 级 LLM 请求 | 100% | >1000 次/天仍可控（~83/h），PostgreSQL 可承受 |
| Trace Spans | 100% | 与请求 1:1 对应 |
| metrics_hourly | 全量聚合 | 小时级，数据量极小 |
| 文件日志 | 全量写入 | 现有机制不变 |

## 日志保留策略

| 数据 | 保留期 | 清理方式 |
|------|--------|---------|
| llm_requests | 90 天 | 定时 DELETE WHERE created_at < now() - interval '90 days' |
| trace_spans | 30 天 | 定时 DELETE WHERE created_at < now() - interval '30 days' |
| metrics_hourly | 365 天 | 定时 DELETE WHERE hour < now() - interval '365 days' |
| alert_events | 180 天 | 定时 DELETE WHERE created_at < now() - interval '180 days' |
| cost_daily | 永久 | 不删除，数据量极小 |
| .agent_logs/ | 30 天 | 现有机制或 cron 清理 |

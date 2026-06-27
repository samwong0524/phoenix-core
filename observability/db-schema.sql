-- Phoenix-Core Observability Database Schema
-- 追加到现有 PostgreSQL schema，不覆盖现有表

-- ─── 1. LLM 请求日志（每次 LLM 调用一行） ────────────
CREATE TABLE IF NOT EXISTS llm_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id      TEXT NOT NULL,                    -- 串联同一轮对话的所有请求
  agent_id        UUID NOT NULL REFERENCES agents(id),
  group_id        UUID REFERENCES groups(id),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id),

  -- 请求元数据
  provider        TEXT NOT NULL,                    -- glm / openrouter / anthropic / ollama / freellmapi
  model           TEXT NOT NULL,                    -- 实际使用的模型名
  prompt_version  TEXT,                             -- soul.md 的 git commit hash
  is_fallback     BOOLEAN DEFAULT FALSE,            -- 是否走了 fallback 链路

  -- Token 用量
  tokens_prompt   INTEGER NOT NULL DEFAULT 0,
  tokens_completion INTEGER NOT NULL DEFAULT 0,
  tokens_total    INTEGER NOT NULL DEFAULT 0,
  tokens_cached   INTEGER DEFAULT 0,                -- prompt cache 命中量（如 provider 支持）

  -- 延迟
  latency_ms      INTEGER NOT NULL,                 -- 总耗时（ms）
  ttft_ms         INTEGER,                          -- Time to First Token（首 token 延迟）
  queue_wait_ms   INTEGER DEFAULT 0,                -- 调度器排队等待时间

  -- 结果
  finish_reason   TEXT NOT NULL,                    -- stop / length / tool_calls / error / timeout
  tool_call_count INTEGER DEFAULT 0,                -- 本轮工具调用次数
  error_message   TEXT,                             -- 出错时的错误信息
  http_status     INTEGER,                          -- HTTP 响应码

  -- 成本估算
  cost_usd        DECIMAL(10, 6) DEFAULT 0,         -- 本次调用估算费用 (USD)

  -- 时间
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 索引
  CONSTRAINT llm_requests_created_idx CHECK (created_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_llm_requests_agent ON llm_requests(agent_id);
CREATE INDEX IF NOT EXISTS idx_llm_requests_workspace ON llm_requests(workspace_id);
CREATE INDEX IF NOT EXISTS idx_llm_requests_created ON llm_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_requests_request_id ON llm_requests(request_id);
CREATE INDEX IF NOT EXISTS idx_llm_requests_provider ON llm_requests(provider);

-- ─── 2. 请求级追踪 Spans ──────────────────────────────────
CREATE TABLE IF NOT EXISTS trace_spans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id        TEXT NOT NULL,                    -- 一次完整请求的 trace ID (= request_id)
  span_id         TEXT NOT NULL,                    -- 当前 span 的唯一 ID
  parent_span_id  TEXT,                             -- 父 span（构成树状结构）
  agent_id        UUID REFERENCES agents(id),

  -- Span 信息
  operation       TEXT NOT NULL,                    -- input_validation / llm_call / tool_exec / output_format
  span_name       TEXT NOT NULL,                    -- 人类可读名称
  status          TEXT NOT NULL DEFAULT 'ok',       -- ok / error / timeout

  -- 时间
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms     INTEGER NOT NULL,                 -- 耗时

  -- 属性 (JSONB，灵活存储各 span 特有数据)
  attributes      JSONB DEFAULT '{}',
  -- 示例 attributes:
  -- LLM call: {model, tokens_prompt, tokens_completion, finish_reason, prompt_version}
  -- Tool exec: {tool_name, tool_params, result_summary}
  -- Validation: {input_length, validation_result}

  -- 事件日志 (span 内的子事件)
  events          JSONB DEFAULT '[]',
  -- 示例: [{timestamp, name, attributes}]

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trace_spans_trace ON trace_spans(trace_id);
CREATE INDEX IF NOT EXISTS idx_trace_spans_agent ON trace_spans(agent_id);
CREATE INDEX IF NOT EXISTS idx_trace_spans_created ON trace_spans(created_at DESC);

-- ─── 3. 指标聚合（定时 rollup，不逐条写入） ────────────────
CREATE TABLE IF NOT EXISTS metrics_hourly (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hour            TIMESTAMPTZ NOT NULL,             -- 对齐到小时
  workspace_id    UUID REFERENCES workspaces(id),
  agent_id        UUID REFERENCES agents(id),       -- NULL = 全部 Agent 汇总
  provider        TEXT,                             -- NULL = 全部 Provider 汇总

  -- 请求统计
  request_count   INTEGER NOT NULL DEFAULT 0,
  success_count   INTEGER NOT NULL DEFAULT 0,
  error_count     INTEGER NOT NULL DEFAULT 0,
  timeout_count   INTEGER NOT NULL DEFAULT 0,
  fallback_count  INTEGER NOT NULL DEFAULT 0,

  -- 延迟分布 (毫秒)
  latency_p50     INTEGER,
  latency_p90     INTEGER,
  latency_p95     INTEGER,
  latency_p99     INTEGER,
  latency_avg     INTEGER,
  ttft_p50        INTEGER,
  ttft_p95        INTEGER,

  -- Token 统计
  tokens_prompt_total    BIGINT DEFAULT 0,
  tokens_completion_total BIGINT DEFAULT 0,
  tokens_total           BIGINT DEFAULT 0,

  -- 成本
  cost_total_usd  DECIMAL(12, 6) DEFAULT 0,

  -- 工具调用
  tool_call_total  INTEGER DEFAULT 0,
  tool_error_total INTEGER DEFAULT 0,

  -- 唯一约束
  UNIQUE(hour, workspace_id, agent_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_metrics_hourly_hour ON metrics_hourly(hour DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_hourly_ws ON metrics_hourly(workspace_id, hour DESC);

-- ─── 4. 告警事件记录 ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_name      TEXT NOT NULL,
  severity        TEXT NOT NULL,                    -- critical / warning / info
  metric_name     TEXT NOT NULL,
  metric_value    DECIMAL(12, 4),
  threshold       DECIMAL(12, 4),
  condition_desc  TEXT,                             -- 人类可读的触发条件
  context         JSONB DEFAULT '{}',               -- 附加上下文
  resolved        BOOLEAN DEFAULT FALSE,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_events_created ON alert_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_events_severity ON alert_events(severity);

-- ─── 5. 日度成本汇总（用于预算监控） ──────────────────────
CREATE TABLE IF NOT EXISTS cost_daily (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date            DATE NOT NULL,
  workspace_id    UUID REFERENCES workspaces(id),
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,

  request_count   INTEGER NOT NULL DEFAULT 0,
  tokens_total    BIGINT NOT NULL DEFAULT 0,
  cost_usd        DECIMAL(12, 6) NOT NULL DEFAULT 0,

  UNIQUE(date, workspace_id, provider, model)
);

CREATE INDEX IF NOT EXISTS idx_cost_daily_date ON cost_daily(date DESC);

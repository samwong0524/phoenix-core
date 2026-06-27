# 可观测性上线检查清单 — Phoenix-Core

## 日志（Logs）

- [ ] 结构化日志 Schema 已定义（见 observability/metrics-collector.ts LLMRequestRecord）
- [ ] LLM 调用记录写入 llm_requests 表（含 request_id, latency, tokens, cost）
- [ ] 现有 .agent_logs/ JSONL 文件保留作为详细审计（含完整 history）
- [ ] 现有 .agent_stream_logs/ 保留作为行为调试追踪
- [ ] 现有 .agent_llm_requests/ 保留作为请求重放
- [ ] 日志包含 request_id 可串联同一轮对话
- [ ] 日志包含 prompt_version（soul.md 的 git commit hash）
- [ ] 敏感信息已脱敏（API Key 已 REDACTED）
- [ ] 日志采样策略已设定：ERROR 100%、WARN 100%、INFO 100%（>1000 次/天可接受）
- [ ] 日志保留策略已配置（建议 llm_requests 保留 90 天，metrics_hourly 保留 365 天）

## 指标（Metrics）

- [ ] 核心指标已定义并采集到 llm_requests 表：
  - [ ] 请求成功率 (success / total)
  - [ ] 延迟分布 (P50/P90/P95/P99)
  - [ ] TTFT (Time to First Token)
  - [ ] Token 消耗 (prompt + completion + total)
  - [ ] 成本估算 (cost_usd)
  - [ ] 工具调用成功率
  - [ ] Provider fallback 比例
- [ ] 小时级聚合已配置 (metrics_hourly，每小时 rollup)
- [ ] 日度成本汇总已配置 (cost_daily，每天 rollup)
- [ ] 告警规则已配置（见 observability/alerts.yaml）：
  - [ ] agent_success_rate < 95% → Critical
  - [ ] agent_latency_p95 > 15s → Critical
  - [ ] agent_timeout_rate > 5% → Warning
  - [ ] daily_cost > budget 80% → Warning
  - [ ] daily_cost > budget 100% → Critical
- [ ] 告警通知渠道已验证（IM webhook）
- [ ] 成本预算已设定（在 alerts.yaml 中配置 budget 变量）

## 追踪（Tracing）

- [ ] 多步骤调用已接入追踪（trace_spans 表）
- [ ] 追踪结构覆盖完整请求链路：
  - [ ] input_preprocessing span
  - [ ] llm_call span（含 model, tokens, finish_reason）
  - [ ] tool_exec span（含 tool_name, params, result）
  - [ ] output_postprocessing span
  - [ ] message_routing span
- [ ] trace_id 与 request_id 一致，可跨表关联
- [ ] 追踪数据可通过 /api/observability/trace/{traceId} 查询

## 看板（Dashboard）

- [ ] 实时运营看板已上线（/observability 页面）：
  - [ ] 系统健康状态指示
  - [ ] 请求量趋势图
  - [ ] 成功率 / 错误率
  - [ ] 延迟分布
  - [ ] Token 消耗趋势
  - [ ] 成本统计
- [ ] 告警事件列表可查
- [ ] 日度成本表可查
- [ ] 看板自动刷新（30 秒间隔）
- [ ] 团队成员已知晓看板位置

## 数据库就绪

- [ ] observability/db-schema.sql 已在 PostgreSQL 中执行
- [ ] 表已创建：llm_requests, trace_spans, metrics_hourly, alert_events, cost_daily
- [ ] 索引已创建
- [ ] MetricsCollector 已集成到 agent-runtime.ts

## 应急准备

- [ ] 常见故障处理手册：
  - [ ] 成功率下降 → 检查 LLM Provider 状态 + circuit breaker
  - [ ] 延迟飙升 → 检查 scheduler 排队 + API Key 限流
  - [ ] 成本超支 → 检查是否有 Agent 循环调用
  - [ ] 工具调用失败 → 检查 MCP 服务 + 工具配置
- [ ] Prompt 版本回滚流程已验证（git revert soul.md）
- [ ] LLM Provider 切换流程已验证（修改 .env 中的 LLM_PROVIDER）

## 模型定价校准

- [ ] MODEL_PRICING 表已校准（metrics-collector.ts）
- [ ] 覆盖所有在用模型：glm-4.7, glm-4-flash, qwen3:8b 等
- [ ] 本地模型（Ollama）成本设为 0

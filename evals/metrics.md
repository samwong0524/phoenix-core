# Phoenix-Core 评测指标体系

## 评测目标

1. **多智能体协作编排能力**：Agent 创建、分组、消息路由、任务分解与调度的正确性
2. **自主决策与任务执行质量**：工具选择、角色扮演、输出内容的正确性与完整性
3. **竞品对比基线**：建立标准化评测格式，支持与 AutoGen / CrewAI / MetaGPT 等框架横向比较

---

## 核心指标（North Star Metrics）

直接衡量 Agent 系统是否达成核心价值。

| 指标 | 英文标识 | 定义 | 计算方式 | 目标值 |
|------|---------|------|---------|--------|
| 任务完成率 | `task_completion_rate` | Agent 成功完成被分配任务的比例 | 已完成任务数 / 总任务数 | >= 85% |
| 多智能体协作效率 | `collaboration_efficiency` | 多 Agent 协作完成任务的时间相对单 Agent 的提升比例 | (T_single - T_multi) / T_single | >= 20% |
| 决策正确率 | `decision_accuracy` | Agent 选择正确工具、委派正确角色、执行正确动作的比例 | 正确决策数 / 总决策数 | >= 80% |

---

## 驱动指标（Driver Metrics）

影响核心指标的过程质量指标。

| 指标 | 英文标识 | 定义 | 计算方式 |
|------|---------|------|---------|
| 角色一致性 | `role_adherence` | Agent 行为与角色模板定义一致的比例 | 符合角色行为的 Agent 数 / 总 Agent 数 |
| 消息路由准确率 | `message_routing_accuracy` | 消息被正确传递到目标 Agent/Group 的比例 | 正确路由消息数 / 总发送消息数 |
| 工具选择准确率 | `tool_selection_accuracy` | Agent 选择了正确工具完成任务的比例 | 正确工具调用数 / 总工具调用数 |
| 工作流执行成功率 | `workflow_success_rate` | 工作流中所有任务按依赖顺序正确执行的比例 | 成功完成的工作流数 / 总工作流数 |
| 子Agent创建正确率 | `subagent_creation_accuracy` | 子 Agent 被正确创建并分配到合适角色的比例 | 正确创建的子 Agent 数 / 总创建子 Agent 数 |

---

## 健康指标（Health Metrics）

基础运行状态，保障上层指标的前提。

| 指标 | 英文标识 | 定义 | 计算方式 |
|------|---------|------|---------|
| P50 响应延迟 | `latency_p50` | Agent 响应时间的中位数 | 日志统计 |
| P95 响应延迟 | `latency_p95` | Agent 响应时间的 95 分位 | 日志统计 |
| API 错误率 | `api_error_rate` | API 调用返回 4xx/5xx 的比例 | 错误请求数 / 总请求数 |
| Token 消耗效率 | `token_efficiency` | 平均每次任务完成的 Token 用量 | 总 Token / 总任务数 |
| 级联故障率 | `cascade_failure_rate` | 单个 Agent 失败导致其他 Agent 连锁失败的比例 | 级联事件数 / 总失败事件数 |
| 熔断器触发率 | `circuit_breaker_rate` | 熔断器被触发的频率 | 触发次数 / 总请求数 |

---

## 竞品对比维度

用于与 AutoGen、CrewAI、MetaGPT 等框架进行横向对比。

| 维度 | 评测项 | 标准化方法 |
|------|--------|-----------|
| 编排能力 | 多 Agent 任务分解与调度成功率 | 相同任务集，统计完成率 |
| 自主性 | 无需人工干预完成任务的比例 | 相同任务集，统计干预次数 |
| 工具使用 | 工具调用准确率 | 相同工具调用场景，统计正确率 |
| 扩展性 | 10+ Agent 并发稳定性 | 并发压力测试 |
| 容错性 | Agent 失败后系统恢复能力 | 注入故障，观察恢复时间 |

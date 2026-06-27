# Phoenix-Core ASSERT 评测报告

**评测时间**：{{timestamp}}
**Run ID**：{{run_id}}
**Agent 版本**：{{agent_version}}
**评测数据集**：Golden {{golden_count}} + Edge {{edge_count}} + Adversarial {{adv_count}} = {{total_count}} 条
**对比基线**：{{baseline_version}}

---

## 核心指标 (North Star Metrics)

直接衡量 Agent 系统是否达成核心价值。

| 指标 | 本次结果 | 基线 | 变化 | 目标 | 达标 |
|------|---------|------|------|------|------|
| 任务完成率 | {{task_completion_rate}} | {{baseline_task_completion}} | {{delta_task}} | >= 85% | {{task_pass}} |
| 多智能体协作效率 | {{collaboration_score}} | {{baseline_collaboration}} | {{delta_collab}} | >= 20% | {{collab_pass}} |
| 决策正确率 | {{decision_accuracy}} | {{baseline_decision}} | {{delta_decision}} | >= 80% | {{decision_pass}} |

## 驱动指标 (Driver Metrics)

影响核心指标的过程质量。

| 指标 | 本次结果 | 基线 | 备注 |
|------|---------|------|------|
| 角色一致性 | {{role_adherence}} | {{baseline_role}} | {{role_note}} |
| 消息路由准确率 | {{routing_accuracy}} | {{baseline_routing}} | {{routing_note}} |
| 工具选择准确率 | {{tool_accuracy}} | {{baseline_tool}} | {{tool_note}} |
| 工作流执行成功率 | {{workflow_success}} | {{baseline_workflow}} | {{workflow_note}} |
| 子Agent创建正确率 | {{subagent_accuracy}} | {{baseline_subagent}} | {{subagent_note}} |

## 健康指标 (Health Metrics)

基础运行状态。

| 指标 | 本次结果 | 基线 | 状态 |
|------|---------|------|------|
| P50 延迟 | {{latency_p50}} | {{baseline_p50}} | {{p50_status}} |
| P95 延迟 | {{latency_p95}} | {{baseline_p95}} | {{p95_status}} |
| API 错误率 | {{error_rate}} | {{baseline_error}} | {{error_status}} |
| Token 消耗 | {{token_usage}} | {{baseline_token}} | {{token_status}} |

## 数据集分布分析

| 数据类型 | 用例数 | 通过率 | 主要失败原因 |
|---------|--------|--------|------------|
| 标准测试 (Golden) | {{golden_count}} | {{golden_pass_rate}} | {{golden_failures}} |
| 边界测试 (Edge) | {{edge_count}} | {{edge_pass_rate}} | {{edge_failures}} |
| 对抗测试 (Adversarial) | {{adv_count}} | {{adv_pass_rate}} | {{adv_failures}} |

## 关键发现

{{key_findings}}

## 行动建议

| 优先级 | 建议 | 关联指标 | 负责方 |
|--------|------|---------|--------|
| {{priority_1}} | {{action_1}} | {{metric_1}} | {{owner_1}} |
| {{priority_2}} | {{action_2}} | {{metric_2}} | {{owner_2}} |
| {{priority_3}} | {{action_3}} | {{metric_3}} | {{owner_3}} |

## 评分明细

### 自动评分分布

| 评分器 | 适用用例 | 通过率 | 平均分 |
|--------|---------|--------|--------|
{{auto_score_table}}

### 人工评分分布（如适用）

| Rubric | 抽样数 | 平均分 | 分布 (0/1/2/3) |
|--------|--------|--------|----------------|
{{human_score_table}}

---

*本报告由 ASSERT 评测流水线自动生成*

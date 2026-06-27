---
name: multi-agent-orchestration
description: 多 agent 项目搭建——从创建 agent 到建立群组、分配工作流的完整流程
metadata:
  roles: [coordinator]
---

# 多 Agent 编排

## 标准流程

搭建多 agent 项目的推荐步骤：

```
1. 明确项目目标 → 确定需要哪些角色
2. 调用 create 为每个角色创建 agent（带上清晰的 guidance）
3. 调用 create_group 建立群组（必须包含 human）
4. 调用 create_workflow 定义 DAG 任务
5. 调用 assign_agent 分配任务到对应 agent
6. 调用 send_group_message 向人类汇报项目结构和计划
```

## 角色设计指南

| 角色 | 职责 | 适合场景 |
|------|------|---------|
| coordinator | 任务分解、分配、审核、全局协调 | 任何有多步骤的项目 |
| worker | 执行明确的任务，完成后汇报 | 编码、写作、数据录入 |
| researcher | 调研、收集信息、分析 | 需要探索和总结的工作 |
| reviewer | 审查、验证、QA | 代码审查、内容审核 |
| specialist | 领域专家（前端/后端/设计等） | 需要特定技能的工作 |
| creator | 内容创作 | 写作、设计、视频制作 |
| editor | 修改优化 | 润色、编辑、后期 |

## Guidance 写作原则

创建子 agent 时，guidance 应该包含：
- **角色定位**：一句话说明这个 agent 的身份职责
- **工作范围**：明确什么做、什么不做
- **协作方式**：如何与其他 agent 和人类沟通
- **交付标准**：什么样的输出算完成

不要写：
- 具体的执行步骤（让子 agent 自己决定怎么做）
- 与角色无关的系统指令
- 重复 soul.md 已经有的内容

## 群组策略

- **项目群组**（含 human + 所有参与 agent）：用于项目同步和进展汇报
- **P2P 群组**（两个 agent 之间）：用于任务委派和结果返回
- 人类不需要看到 agent 之间的所有中间讨论，只看到关键进展

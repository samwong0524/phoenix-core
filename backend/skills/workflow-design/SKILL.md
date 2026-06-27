---
name: workflow-design
description: DAG 工作流设计最佳实践——任务分解、依赖管理、审核周期
metadata:
  roles: [coordinator]
---

# 工作流设计

## DAG 基本原则

- **一个任务一个职责**。如果任务描述出现"和"、"同时"，拆分为多个任务
- **依赖表达顺序**。`dependsOn` 定义前置条件，没有依赖的任务可以并行执行
- **明确 assigneeRole**。每个任务指定一个角色，不要留空
- **设置合理的 maxRevisions**。简单任务 1-2，复杂任务 3-5

## 典型工作流模式

### 线性流水线
```
Research → Design → Implement → Review → Deploy
```
每个任务依赖前一个，适合步骤之间有严格顺序的工作。

### 扇出/扇入
```
         → Worker A
Plan →   → Worker B   → Merge → Review
         → Worker C
```
Plan 完成后多个 worker 并行工作，全部完成后 merge。适合可并行分解的工作。

### 迭代优化
```
Draft → Review → Revise → Review → ...
```
Review 不通过时 Revise 重新进入 Review，直到通过或达到 maxRevisions。

## 任务状态流转

```
in_progress → review → approved → done
                    → rejected → in_progress (重做)
                    → blocked (超 revision 上限)
                    → failed (错误终止)
```

## 错误处理规范

每个工作流应该考虑：
- 某个任务失败了怎么办？（其他任务继续还是整体终止？）
- 任务达到 maxRevisions 了怎么办？（标记 blocked，由 coordinator 决定）
- 中间结果不符合预期怎么办？（用 review/rejected 循环修正）

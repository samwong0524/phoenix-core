---
name: agent-creation-guide
description: 子 agent 创建最佳实践——角色设计、guidance 撰写、生命周期管理
---

# Agent 创建指南

## 什么时候创建子 agent

- 任务需要**多个不同领域 expertise** 协作完成
- 工作可以**并行执行**（每个子 agent 负责一部分）
- 需要**持续运行**的监控或服务角色

不需要创建子 agent 的场景：
- 简单查询或单步操作（自己完成更快）
- 任务可以一次完成（子 agent 的上下文开销不值得）

## Guidance 模板

```
你是 [角色名]，负责 [职责范围]。

工作方式：
- [用什么工具、怎么协作]
- [与其他 agent 的关系]

交付标准：
- [什么样的输出算完成]
- [质量要求]
```

## 生命周期管理

- **使用 role 名称**标记 agent，不要用 UUID。方便其他 agent 通过 role 引用
- 只删除你**自己创建的子 agent**（parent 是你）
- 删除前先确认子 agent 已经没有自己的子 agent
- 用 `memory_add` 记录重要 agent 的职责和位置，方便其他 agent 查找

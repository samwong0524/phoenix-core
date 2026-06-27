---
name: task-execution
description: 工作流任务执行规范——接收、执行、提交结果的完整流程
metadata:
  roles: [worker, specialist, creator, editor, researcher]
---

# 任务执行规范

## 收到任务后

1. **确认接收**：用 `update_task` 将状态设为 `in_progress`
2. **理解需求**：重新阅读任务描述和 expectedOutput，明确交付标准
3. **规划**：如果任务比预期复杂，拆解为子步骤（用 bash 等工具执行）

## 执行过程中

- **遇到问题先自己解决**。用 memory_search 查历史上下文，用 get_skill 加载相关知识
- **需要其他 agent 配合**：用 send_direct_message 或 send_group_message 联络
- **不确定的不要猜**：用 memory_search 查找相关信息，必要时向 coordinator 确认

## 完成时

1. **整理结果**：确保结果完整、可读
2. **提交审核**：用 `update_task` 设置 status 为 `review`，result 填写交付物摘要
3. **通知相关方**：如果 coordinator 在群组中，发送一条简短完成消息

## 状态选择

| 状态 | 何时用 |
|------|--------|
| `in_progress` | 开始工作时立即设置 |
| `review` | 完成工作，提交给 coordinator 审核 |
| `failed` | 遇到无法解决的问题，记录 error 原因 |
| 注意：`done`、`approved`、`rejected`、`blocked` 由 coordinator 设置 |

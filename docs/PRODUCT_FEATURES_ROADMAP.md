# Phoenix-Core 产品功能开发计划

> **Remaining Product Features** · 基于 phoenix-product-review.md 的补齐方案
> 2026-07-02

---

## 执行摘要

技术基座（设计系统 v2-v4）已就绪，下一步补齐产品线。本计划将方案中 7 个体验缺口 + 2 个架构简化 + 1 个契约标准化分为 **3 个产品 Sprint（P6-P8）**，每个 Sprint 2 周，聚焦用户可感知的功能交付。

**优先级排序**：
- **P0 阻断级**：缺口 1 (LLM 引导)、缺口 6 (错误可见性)
- **P1 高影响**：缺口 3 (欢迎引导)、缺口 4 (协作时间线)、缺口 7 (重试机制)
- **P2 架构简化**：Workflow+Pipeline 统一入口、Command Palette
- **P3 体验打磨**：动效收敛、状态动画、API 标准化

---

## Sprint P6 · W11-12：首次使用体验闭环

**目标**：新用户从注册到第一次收到 Agent 回复，全程无阻断。

### 产品交付

#### 1. LLM 配置引导流程（缺口 1）

**当前问题**：`/models` 页面假设用户知道什么是 API Key、Base URL、Provider。新用户注册后不知道下一步做什么。

**方案**：
- 首次登录（workspace 无 model 配置时）自动弹出引导 Modal
- 预置 3 个常用服务商的 Base URL：
  - OpenAI: `https://api.openai.com/v1`
  - DeepSeek: `https://api.deepseek.com/v1`
  - 智谱 GLM: `https://open.bigmodel.cn/api/paas/v4`
- 用户只需填 API Key，点击"测试连接"
- 测试通过后自动关闭 Modal，进入主界面

**文件**：
- `app/_components/model-setup-wizard.tsx`（新组件，Modal + 表单 + 测试逻辑）
- `app/page.tsx`（首次登录检测并触发 Wizard）
- `app/api/models/test-connection/route.ts`（已有，复用）

**验收标准**：
- 新 workspace 首次进入首页，Wizard 自动弹出
- 选择 Provider 后 Base URL 自动填充
- 测试连接成功 → 写入 DB → 关闭 Wizard
- 测试失败 → 显示错误信息 + 保留表单

---

#### 2. 模板卡片增强（缺口 2）

**当前问题**：模板卡片只展示名称和 icon，用户不知道适用场景和包含哪些 Agent。

**方案**：
- 模板数据结构扩展：`{ name, icon, description, agentCount, agentRoles: string[] }`
- 卡片 UI：名称 + 一句话场景描述 + "N 个 Agent" 标签
- 悬停展开 Agent 角色列表（Tooltip 或 Popover）

**文件**：
- `app/_components/workspace-template-card.tsx`（增强 UI）
- `app/api/workspaces/templates/route.ts`（数据结构扩展）
- `src/lib/i18n/zh.json` + `en.json`（模板描述 i18n）

**验收标准**：
- 模板卡片展示描述文本
- 显示 Agent 数量标签
- 悬停显示 Agent 角色列表

---

#### 3. 欢迎消息引导（缺口 3）

**当前问题**：Agent 发送欢迎消息后，用户不知道下一步该做什么。

**方案**：
- 欢迎消息后追加一个"建议列表"消息（contentType: "suggestions"）
- 格式：3-4 个可点击的建议按钮，如"让我帮你写需求文档"、"分析这段代码"
- 点击后自动填入输入框并发送

**文件**：
- `app/im/MessageBubble.tsx`（新增 suggestions 渲染逻辑）
- `app/im/page.tsx`（Agent 创建时发送 suggestions 消息）
- `backend/src/agent-runtime.ts`（welcome message 后追加 suggestions）

**验收标准**：
- Agent 欢迎消息后显示 3-4 个建议按钮
- 点击按钮 → 填入输入框 → 自动发送
- 建议内容可配置（workspace template 级别）

---

### 技术支撑

#### API 响应标准化（Contract 3）

趁 P6 新功能开发，同步标准化 API 响应格式：

- 单资源：直接返回对象（不包装）
- 列表：直接返回数组（<100 条）或 `{ items, total, offset, limit }`
- 错误：`{ error: { code: "SCREAMING_SNAKE_CASE", message: "..." } }`
- 时间：ISO-8601

**文件**：
- `backend/src/lib/api-response.ts`（新工具函数）
- 逐个改造 `app/api/*/route.ts`（优先改造 P6 涉及的端点）

---

## Sprint P7 · W13-14：排障体验 + 协作可见性 ✅ COMPLETED

**目标**：Agent 出错时用户能快速定位原因；多 Agent 协作时用户能看到全局进度。

**交付状态**：✅ 全部完成 (2026-07-02)
- ToolCallError 可折叠错误组件 + 聊天区渲染
- 重试按钮（失败 tool_call 重执行）
- 协作时间线（SSE 事件 + 组件 + 面板集成）
- SSE 事件规范化（Contract 2 验证）
- tsc + vitest (634 tests) + next build 验收通过

### 产品交付

#### 1. 错误详情展开（缺口 6）

**当前问题**：tool_call 失败时消息区只显示"工具执行失败"，没有具体错误信息。

**方案**：
- 消息气泡检测 `tool_call.error` 时渲染可折叠错误面板
- 展开后显示：错误类型、错误消息、stderr/stdout（如有）
- 用 CodeBlock 组件渲染（已有，支持 diff 高亮）

**文件**：
- `app/im/MessageBubble.tsx`（新增 error 渲染逻辑）
- `app/im/components/ToolCallError.tsx`（新组件，折叠面板 + CodeBlock）

**验收标准**：
- tool_call.error 消息显示红色错误摘要
- 点击展开 → 显示完整错误信息（CodeBlock 渲染）
- stderr/stdout 分开展示

---

#### 2. 重试按钮（缺口 7）

**当前问题**：Agent 出错后用户只能手动重发消息，无法重试失败的 tool_call。

**方案**：
- 在错误面板底部增加"重试此工具调用"按钮
- 点击后重新发送该 tool_call 的输入参数给 Agent
- Agent 从失败点继续执行（非从头开始）

**文件**：
- `app/im/components/ToolCallError.tsx`（增加重试按钮）
- `app/im/page.tsx`（重试逻辑：提取 tool_call 参数 → 发送消息）
- `backend/src/agent-runtime.ts`（支持从 tool_call 断点恢复）

**验收标准**：
- 错误面板底部显示"重试"按钮
- 点击 → 重新执行该 tool_call
- Agent 从断点继续（不重跑已成功的步骤）

---

#### 3. 协作时间线（缺口 4）

**当前问题**：多 Agent 协作时，用户看不到 Coordinator 分配了哪些任务、各 Agent 的进度。

**方案**：
- 右侧面板新增"协作时间线" Tab（与 TaskMonitor/Artifacts 并列）
- 按时间顺序展示：Coordinator 的任务分配事件 + 各 Agent 的状态变化
- 数据来源：SSE 事件 `ui.agent.working.start/done` + `llm.tool_call.done`

**文件**：
- `app/im/components/CollaborationTimeline.tsx`（新组件）
- `app/im/page.tsx`（右侧面板增加 Tab）
- `backend/src/lib/sse-events.ts`（确保事件包含 coordinator/assignee 信息）

**验收标准**：
- 右侧面板显示"协作" Tab（仅 Team Group 可见）
- 时间线展示任务分配 + 状态变化
- 每个 Agent 用颜色编码区分

---

### 技术支撑

#### SSE 事件规范化（Contract 2）

趁 P7 新功能开发，验证并规范化 SSE 事件：

- 命名空间：`ui.{资源}.` / `pipeline.` / `agent.` / `llm.`
- 动作：`created` / `start` / `done` / `deleted`（禁止 begin/end/finish）
- Payload：必须包含 `workspaceId` + 资源 ID
- 时间戳：ISO-8601

**文件**：
- `backend/src/lib/sse-events.ts`（审查并规范化现有事件）
- `app/im/page.tsx`（useUiStream hook 适配新事件格式）

---

## Sprint P8 · W15-16：编排统一 + 效率工具 ✅ COMPLETED

**目标**：降低编排概念的认知负荷；提升 Agent 切换效率。

**交付状态**：✅ 全部完成 (2026-07-03)
- 统一编排入口 `/orchestrate`（Workflow + Pipeline 仪表盘）
- Command Palette Ctrl+K（已存在，含 Agent/Group/Skill 搜索）
- 动效收敛 + 状态 morph 过渡动画（400ms ease-in-out）
- tsc + vitest (634 tests) + next build 验收通过

### 产品交付

#### 1. Workflow + Pipeline 统一入口

**当前问题**：Workflow（DAG）、Pipeline（顺序流水线）、Topology（通信拓扑）三个概念让用户困惑。

**方案**：
- 侧边栏新增"编排"入口（合并原 Workflow + Pipeline）
- 进入后显示"任务编排"页面，内部根据复杂度自动选择模式：
  - 简单线性步骤 → 用 Pipeline 引擎
  - 复杂 DAG → 用 Workflow 引擎
- 用户无需理解底层区别，只需描述任务流程

**文件**：
- `app/orchestrate/page.tsx`（新页面，统一入口）
- `app/orchestrate/components/SmartEditor.tsx`（新组件，自动选择引擎）
- `app/_components/global-sidebar.tsx`（侧边栏增加"编排"入口）
- `backend/src/lib/orchestrate-engine.ts`（新模块，路由到 Pipeline 或 Workflow）

**验收标准**：
- 侧边栏显示"编排"入口（替代原 Workflow + Pipeline）
- 进入后显示统一编辑器
- 简单任务自动用 Pipeline，复杂任务自动用 Workflow
- 原有 Workflow/Pipeline 数据兼容（不丢失历史）

---

#### 2. Command Palette（缺口 5）

**当前问题**：切换 Agent 需要点击左侧树，Agent 数量多时（>5）效率低。

**方案**：
- 全局快捷键 `Ctrl+K`（macOS `Cmd+K`）打开 Command Palette
- 支持搜索：Agent 名称 / 页面路径 / 常用命令
- 键盘导航（↑↓ 选择，Enter 执行）

**文件**：
- `app/_components/command-palette.tsx`（新组件，Modal + 搜索 + 列表）
- `app/_components/global-sidebar.tsx`（注册全局快捷键）
- `app/_components/routes.ts`（页面列表数据源）

**验收标准**：
- `Ctrl+K` 打开 Palette
- 输入关键词 → 过滤 Agent / 页面 / 命令
- Enter → 跳转或执行
- Esc → 关闭

---

#### 3. 动效收敛 + 状态动画（Sprint 5 遗留）

**当前问题**：存在过度装饰的动效（grid-scroll/glitch/badgePulse）；Agent 状态转换没有视觉反馈。

**方案**：
- 移除过度动效：grid-scroll、glitch、badgePulse（保留功能性动画）
- Agent 状态转换增加 icon morph 动画（如 idle→working 时状态点从绿色 morph 为琥珀色脉冲）

**文件**：
- `app/globals.css`（移除 grid-scroll/glitch/badgePulse keyframes）
- `app/im/AgentSidebar.tsx`（状态点增加 morph 动画）
- `backend/src/components/ui/status-badge.tsx`（增强 pulse 过渡）

**验收标准**：
- 移除的动效不再出现
- Agent 状态转换有平滑的 icon morph 动画
- 动画时长 ≤400ms，位移 ≤20px（符合 corporate dashboard 规范）

---

### 技术支撑

#### Vitest 覆盖率提升

方案要求覆盖率目标 60%，当前 29%。P8 新功能开发时同步补充单测：

- 新增组件必须有对应单测
- 核心模块（agent-runtime/cognitive-pipeline）补充边界测试
- 目标：P8 结束时覆盖率 ≥50%（60% 作为长期目标）

**文件**：
- `tests/core/orchestrate-engine.test.ts`（新测试）
- `tests/core/command-palette.test.ts`（新测试）
- 补充现有测试的边界用例

---

## 交付时间线

| Sprint | 周期 | 交付物 | 用户可见价值 |
|--------|------|--------|--------------|
| **P6** ✅ | W11-12 | LLM 引导 + 模板卡片 + 欢迎引导 + API 标准化 | 新用户首次使用无阻断 |
| **P7** ✅ | W13-14 | 错误详情 + 重试按钮 + 协作时间线 + SSE 规范化 | 排障效率 + 协作可见性 |
| **P8** ✅ | W15-16 | 统一编排入口 + Command Palette + 动效收敛 + 覆盖率 | 认知简化 + 效率提升 |
| **P9** ✅ | W17-18 | ToolCall 断点恢复 + 重试机制增强 | 真正的 tool_call 级别重试 |

**总计**：8 周（4 个 Sprint × 2 周），补齐方案中所有产品功能 + 技术债务。**全部完成 🎉**

---

## Sprint P9 · W17-18：技术债务补齐

**目标**：补齐 P7 重试机制的断点恢复能力，实现真正的 tool_call 级别重试。

**交付状态**：✅ 全部完成 (2026-07-03)
- AgentRunner.resetGuardrails() 公开方法（清除 blockedTools/agentPaused/失败计数器）
- POST /api/agents/{agentId}/retry-tool-call 断点恢复 API
- llmHistory 回滚：移除失败 tool_result + 后续系统消息
- 前端重试按钮改为调用断点恢复 API（不再仅发送文本消息）
- wakeup reason 扩展支持 retry_tool_call
- tsc + vitest (634 tests) + next build 验收通过

### 产品交付

#### 1. ToolCall 断点恢复（P7 重试机制增强）

**当前问题**：P7 实现的重试按钮仅发送一条文本消息 "请重试工具调用: toolName"，Agent 收到后由 LLM 自行决定是否重试，无法保证精确重执行失败的 tool_call。

**方案**：
- 新建 `POST /api/agents/{agentId}/retry-tool-call` API 端点
- 接收 `{ toolCallId, groupId }` 参数
- 解析 agent 的 llmHistory JSON 数组
- 找到 `tool_call_id` 匹配的 `role: "tool"` 消息并移除
- 清除后续引用该失败的 system 消息
- 调用 `AgentRunner.resetGuardrails()` 清除 blockedTools/agentPaused/失败计数器
- 保存修改后的 llmHistory 到数据库
- 唤醒 agent 重新处理（从断点继续，不重跑已成功的步骤）

**文件**：
- `app/api/agents/[agentId]/retry-tool-call/route.ts`（新 API 端点）
- `src/runtime/agent-runtime.ts`（AgentRunner.resetGuardrails + getRunner + wakeup reason 扩展）
- `app/im/page.tsx`（重试按钮改为调用断点恢复 API）

**验收标准**：
- 点击重试 → 调用 retry-tool-call API → llmHistory 回滚 → agent 从断点继续
- 被 blocked 的工具在重试后解除封锁
- 被 paused 的 agent 在重试后恢复运行
- 前端显示 "🔄 重试工具调用: toolName" 通知消息

---

## 风险与依赖

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Workflow + Pipeline 合并复杂度高 | P8 延期 | P7 结束时提前 spike，评估可行性；必要时降级为"并列入口 + 智能推荐" |
| 重试机制需要 Agent 断点恢复能力 | P7 延期 | 先实现"重新发送消息"（简单版），后续迭代支持真正的断点恢复 |
| 覆盖率提升速度慢 | P8 目标未达成 | 优先覆盖 P6-P8 新组件，历史代码渐进补充 |
| API 标准化影响现有前端 | P6 回归测试 | 灰度发布，先标准化新端点，老端点渐进迁移 |

---

## 验收清单（Pre-Flight）

每个 Sprint 结束前执行：

- [ ] Lighthouse 无障碍 ≥95%
- [ ] Vitest 单测全绿
- [ ] Playwright E2E 全绿
- [ ] 新功能符合 phoenix-product-review.md 验收标准
- [ ] 无 console.error（生产环境）
- [ ] 暗色/亮色模式视觉一致
- [ ] 移动端 TabBar 导航正常
- [ ] 中文排版无挤压/溢出

---

## 与现有代码的关系

本计划的所有技术交付都建立在设计系统 v2-v4 的基础上：

- **Tailwind v4**：新组件直接用 Tailwind，不再写 inline style
- **统一状态枚举**：StatusBadge 已在 P6 之前就绪，新功能直接消费
- **中文字体栈**：新组件自动继承
- **E2E 测试基础设施**：P6-P8 新功能同步补充 E2E 用例
- **Lighthouse 基线**：每个 Sprint 验证无障碍不退步

---

**分支策略**：每个产品 Sprint 开独立分支（`feat/product-sprint-p6` / `p7` / `p8`），完成后合并到 `main`。

**Commit 规范**：`feat(product): 功能描述` / `fix(product): 修复描述` / `test(product): 测试描述`

# PRD — Phoenix-Core / 多端适配改版 + 高优先级 Blocker 修复

- **生成时间**：2026-06-30T22:00:00+08:00
- **数据源**：brief / journey / stories / sitemap / flow-web / edge / check / audit（8 个上游 Skill）
- **完整度**：strong（8 段均有强支撑，无 thin section）

---

## Section 1 — Summary

Phoenix-Core 是一次面向 AI 研发工程师的多 Agent 蜂群系统前端改版，核心解决当前系统在移动端完全不可用（4 个核心页面固定宽度无响应式）、新用户首次进入面对 15+ 信息区域无任何引导（pain_level=5 为全旅程最高）、以及 7 个 Blocker 级 UX 问题（无撤销、无确认、无重连）三个系统性体验缺陷。改版面向日常创建和监控多 Agent 协作任务的工程师陈昊，成功标准是：移动端核心页面可用率从 0% 提升至 80% 以上，新用户 5 分钟内完成首次 Agent 交互，Blocker 级问题全部清零。

---

## Section 2 — Background & Problem

**问题**：陈昊从会议室出来，掏出手机想查看 Agent 群组的最新执行状态，却发现三栏布局在手机上完全挤成一团——侧栏、聊天区、任务面板全部平铺渲染，没有汉堡菜单、没有响应式断点、没有触摸手势。他只能无奈地回到工位用电脑看。更糟的是，当他第一次登录系统时，面对 Agent 侧栏 + 聊天区 + 拓扑可视化 + 任务监控四块信息区域，完全不知道该从哪里开始——没有引导、没有空状态说明、@skill 语法需要偶然发现。

**当前 workaround**：陈昊只能在工位用桌面浏览器操作，移动端场景（会议室、路上、沙发上）完全放弃使用。Workflow 节点误删后只能手动重建（没有撤销），遇到 SSE 断连只能手动刷新页面（没有自动重连），操作失败的反馈有时是 alert() 弹窗有时是静默吞掉。

**为什么是现在**：系统已完成 4 阶段商用化（TSC 0 errors、570 tests、81% 覆盖率），功能基本完整但体验层积了大量技术债——48 个启发评估问题（7 blocker / 41 major），其中 4 个核心页面的响应式缺失是系统性架构问题，拖延越久改造成本越高。同时多 Agent 协作领域竞品（AutoGen、CrewAI）加速迭代，移动端可用性是差异化竞争力。

**不解决什么**：后端 Agent 运行时架构不改（AgentRuntime / AgentRunner / Event Bus 保持不变），数据库 schema 不变，OAuth 认证流程不改，i18n 方案（React Context + Cookie）不变。

---

## Section 3 — Personas & User Segments

**Primary Persona — 陈昊**

- 姓名：陈昊
- 身份：28 岁 AI 研发工程师
- 情境：日常创建/监控多 Agent 协作任务，经常在工位和会议室之间切换
- JTBD：当陈昊需要编排多个 Agent 协同完成复杂开发任务时，陈昊想快速搭建工作流并实时监控执行状态，从而高效获得结果——无论他在工位还是在路上
- 当前 workaround：只在工位用桌面浏览器，移动端场景放弃
- 痛点：三栏布局手机不可用、无首次引导、节点误删不可恢复、错误反馈不一致

**Secondary Persona — 工作流开发者**

构建和调试 Workflow/Pipeline DAG 的开发者，关注编辑器的撤销/重做、节点配置校验、执行状态可视化。当前 Workflow 编辑器无 undo 栈，删除操作不可逆。

**运维人员**

实时观测 Agent 运行状态和系统指标，关注 SSE 连接稳定性、Observability 图表交互、Pipeline 事件流可读性。当前 SSE 断连无自动重连，事件流 dump 原始 JSON。

**这个产品不为谁做**：不为非技术用户做消费级体验——所有用户都具备基础开发背景，能理解 Agent、Workflow、Pipeline 等概念。

---

## Section 4 — Goals & Success Metrics

**产品目标**：让陈昊在任意设备上 5 分钟内完成首次 Agent 交互，Blocker 级 UX 问题清零。

**成功度量表**：

| 指标 | 度量什么用户行为 | 目标值 | 时间窗 |
| --- | --- | --- | --- |
| 移动端可用率 | 核心页面（IM/Workflow/Pipeline/Skills）在 375-768px 可正常使用 | > 80% | 30 天 |
| 首次交互时间 | 新用户从登录到成功发送第一条 Agent 消息 | ≤ 5 分钟 | 60 天 |
| Blocker 清零数 | 启发评估中 blocker 级问题修复数 | 7/7 | 30 天 |
| 错误反馈统一度 | 所有页面使用统一 toast 组件的比例 | 100% | 60 天 |
| 触摸目标合规率 | 移动端交互元素 ≥ 44px 的比例 | ≥ 95% | 30 天 |

**Anti-metrics（反指标）**：

- 不优化桌面端信息密度——不为了移动端简洁而砍掉桌面端的高级功能（拓扑可视化、TaskMonitor 多 section）
- 不追求动画帧数最大化——framer-motion 动画保持 250-300ms 的克制时长，不做过度动效

**关键假设**：陈昊确实会在移动端（手机/平板）查看和操作 Agent 任务——如果他实际上只在桌面端工作，响应式改版的 ROI 将大幅下降。验证方式：改版上线后追踪移动端 UA 占比和操作频次。

---

## Section 5 — Value Proposition

**对陈昊**：

> 陈昊终于可以在会议室掏出手机查看 Agent 执行状态、在平板上调整 Workflow 配置，而不必每次跑回工位用电脑——因为 Phoenix-Core 的三栏布局在手机和平板上自动降级为抽屉侧栏 + 底部 Sheet，所有核心操作都可在触摸设备上完成。

**对团队负责人（buyer）**：

> 团队负责人可以放心让工程师在任意场景使用多 Agent 协作——因为首次使用引导确保新成员 5 分钟内上手，撤销/恢复机制防止配置数据误删，统一的错误反馈降低沟通成本。

**竞争差异化**：AutoGen 和 CrewAI 均为命令行/Jupyter 优先的工具，缺乏面向日常使用的 Web 界面，更无移动端适配。Phoenix-Core 通过多端响应式布局 + 可视化 Workflow 编辑器 + 实时拓扑图，把多 Agent 编排从"开发者工具"提升为"工作台产品"。首次使用引导和撤销/恢复是竞品完全缺失的体验层。

---

## Section 6 — Solution & Feature Scope

### Story 1：陈昊在手机上也能顺畅查看 Agent 聊天进度 ⭐

**Persona**：陈昊
**Job**：从会议室出来，掏出手机查看 Agent 群组最新执行状态
**优先级**：P0
**关键假设标记**：⭐ 测试"移动端是否真的有使用场景"的核心假设

**功能描述**：IM 页面在 375px 宽度的手机上自动切换为单栏布局——侧栏折叠为抽屉（通过汉堡菜单触发），聊天区占满全宽，右侧任务面板变为底部 Sheet。所有触摸目标不小于 44px，聊天记录可触摸滚动，不需要横向滚动。

**In Scope**：
- 三档响应式断点：mobile (<768px) / tablet (768-1023px) / desktop (≥1024px)
- 移动端：汉堡菜单 + 85vw 抽屉侧栏 + 全宽聊天区 + 底部 Sheet 任务面板
- 平板端：汉堡菜单 + 280px 抽屉侧栏 + 全宽聊天区 + 48px icon strip
- 桌面端：220px 固定侧栏 + 聊天区 + 280px 任务面板（保持不变）
- 触摸目标 ≥ 44px（平板）/ ≥ 48px（手机）

**Out of Scope**：
- 不实现移动端拓扑可视化面板的完整交互（仅保留缩放只读概览）
- 不实现移动端文件上传的完整流程（保留基础能力但不优化）

**验收标准（Given / When / Then）**：
- Given 375px 宽手机，When 打开 IM 页面，Then 看到完整聊天记录，无横向滚动
- Given 手机上的汉堡菜单，When 点击，Then 0.3 秒内展开侧栏抽屉
- Given 手机上的聊天消息列表，When 触摸滚动，Then 所有触摸目标 ≥ 48px
- Given 移动端侧栏抽屉已打开，When 点击群组项，Then 抽屉自动关闭并切换群组
- 边缘情况：网络断开时底部固定条提示"当前离线"，输入框可打字但消息缓存
- 空状态：无群组时显示空状态插画 + "点击菜单创建群组"引导

**设计触点**：
- 涉及屏：screen:im/page（Desktop / Tablet / Mobile 三态）
- 涉及组件：hamburger-menu, drawer, chat-bubble, bottom-sheet-trigger
- 涉及状态：loading, normal, empty, drawer-closed, drawer-open, switching, offline-no-network, offline-poor-connection

**关联 Sitemap 页面**：
- page-im: /im — IM 工作台

**已生成的设计资产**：
- `spark-output/flow-web/flow-1/im-responsive.tsx` — 4 屏响应式 IM 组件（Desktop/Tablet/Mobile/BottomSheet）
- `spark-output/flow-web/shared/types.ts` — 共享类型定义
- `spark-output/flow-web/shared/mock-data.ts` — 模拟数据

**异常态设计**（来自 edge.json）：
- loading-initial：三栏 Skeleton 占位（侧栏 5 群组 + 聊天 6 消息 + 面板 4 任务）
- empty-collection：无群组中央空状态 + CTA
- error-network：SSE 断开顶部 banner + 自动重连 + 手动重试
- offline-no-network（手机）：底部固定条，输入框可打字但消息缓存
- offline-poor-connection（手机）：底部微妙提示条

**待澄清问题**：
- 抽屉侧栏是否需要边缘滑动（swipe-from-edge）手势支持？当前仅有汉堡菜单触发

---

### Story 2：陈昊的三栏布局在平板上自动折叠为侧栏抽屉

**Persona**：陈昊
**Job**：用 iPad 在沙发上查看和调整 Agent 配置
**优先级**：P0

**功能描述**：768px 宽的平板上，侧栏默认隐藏，聊天区占满可用宽度。用户可从左边缘向右滑动展开侧栏，或点击汉堡菜单。点击侧栏中的群组后侧栏自动收回。

**In Scope**：
- 平板端 280px 抽屉侧栏（overlay 模式，不 push 主内容）
- 左边缘滑动手势展开侧栏
- 点击群组后侧栏自动收回
- 右侧面板折叠为 48px icon strip（非底部 Sheet）

**Out of Scope**：
- 不实现平板端分屏/多窗口适配

**验收标准**：
- Given 768px 平板，When 打开 IM 页面，Then 侧栏默认隐藏，聊天区占满宽度
- Given 侧栏关闭，When 从左边缘向右滑动，Then 侧栏展开
- Given 侧栏展开且点击群组，When 选择完成，Then 侧栏自动收回
- Given 平板端，When 任意操作，Then 所有触摸目标 ≥ 44px

**设计触点**：
- 涉及屏：screen:im/page（Tablet 态）
- 涉及组件：drawer, touch-gesture, group-list, overlay
- 涉及状态：drawer-closed, drawer-open, switching

**关联 Sitemap 页面**：
- page-im: /im — IM 工作台

**已生成的设计资产**：
- `spark-output/flow-web/flow-1/im-responsive.tsx` — TabletLayout 屏

---

### Story 3：陈昊在手机上编辑 Workflow 时不再丢失节点

**Persona**：陈昊
**Job**：收到同事消息说 Workflow 节点参数不对，掏出手机快速修正
**优先级**：P0

**功能描述**：手机上看到 Workflow 画布自动缩放为只读概览。点击节点后底部弹出配置 Sheet（不超过屏幕 60% 高度），能在 Sheet 表单中修改参数并保存，保存后有明确成功反馈。双指缩放手势能放大/缩小画布。

**In Scope**：
- 手机端画布只读概览模式（自动缩放适配视口）
- 底部 Sheet 弹出节点配置表单（max-height: 60vh）
- Sheet 内表单编辑 + 保存 + 成功 toast
- 双指缩放画布（pinch-to-zoom）

**Out of Scope**：
- 不实现手机端完整的节点拖拽创建（桌面端专有操作）
- 不实现手机端 Workflow 调色板（NodePalette 折叠为 FAB 入口但本期不做）

**验收标准**：
- Given 手机上打开 Workflow，When 页面加载完成，Then 看到画布只读概览
- Given 画布只读模式，When 点击一个节点，Then 底部弹出配置 Sheet
- Given Sheet 已打开，When 修改参数并点击保存，Then 看到成功 toast 且 Sheet 可关闭
- Given Sheet 已打开，When 向下拖动 drag handle，Then Sheet 关闭
- 边缘情况：节点配置必填字段为空时，字段红色边框 + inline 错误提示
- 空状态：无 Workflow 时显示"还没有工作流" + CTA

**设计触点**：
- 涉及屏：screen:workflow/page, screen:WorkflowCanvas
- 涉及组件：canvas-zoom, bottom-sheet, form
- 涉及状态：readonly-overview, node-selected, editing, saving, save-success

**关联 Sitemap 页面**：
- page-workflow: /workflow — Workflow 编辑器

**已生成的设计资产**：
- `backend/src/components/ui/bottom-sheet.tsx` — 可复用 BottomSheet 组件（framer-motion + drag-to-dismiss）
- `backend/app/test/page.tsx` — BottomSheet 演示页

**异常态设计**（来自 edge.json）：
- error-validation：节点必填字段为空时红色虚线边框 + 角标感叹号
- loading-submit：保存按钮 disabled + "保存中..."
- error-not-found：访问已删除 Workflow 显示 404 卡片

---

### Story 4：陈昊误删 Agent 节点后能一键撤销

**Persona**：陈昊
**Job**：拖拽节点时手滑按到 Delete 键，精心配置的节点消失
**优先级**：P0

**功能描述**：删除节点后 3 秒内看到 toast "节点已删除 · 撤销"，点击"撤销"后节点原样恢复（含所有配置数据）。按 Ctrl+Z 也能触发撤销。连续撤销最多回退 20 步操作。

**In Scope**：
- Zustand + Immer temporal middleware 实现 undo/redo 栈（最多 20 步）
- 删除后 toast 显示 3 秒，含"撤销"按钮
- Ctrl+Z / Ctrl+Shift+Z 快捷键
- 撤销/恢复覆盖：节点增删改、连线增删改、节点位置变更

**Out of Scope**：
- 不实现跨 session 的撤销（仅当前编辑 session 内有效）
- 不实现协作场景下的冲突合并（OT/CRDT）

**验收标准**：
- Given 节点被删除，When 3 秒内，Then 看到 toast "节点已删除 · 撤销"
- Given toast 可见，When 点击"撤销"，Then 节点原样恢复（含配置数据）
- Given 任何编辑操作，When 按 Ctrl+Z，Then 上一步操作被撤销
- Given 已撤销操作，When 按 Ctrl+Shift+Z，Then 操作被恢复
- Given 连续 20 次操作，When 继续撤销，Then 最早的操作被弹出栈

**设计触点**：
- 涉及屏：screen:workflow/page, screen:WorkflowCanvas
- 涉及组件：toast-with-action, undo-stack
- 涉及状态：normal, node-deleted, undoing, undo-success

**关联 Sitemap 页面**：
- page-workflow: /workflow — Workflow 编辑器

**已生成的设计资产**：
- 待生成（需工程实现 Zustand temporal middleware）

---

### Story 5：陈昊第一次打开系统就知道各面板是干嘛的

**Persona**：陈昊
**Job**：OAuth 登录成功后第一次进入 IM 页面
**优先级**：P1

**功能描述**：首次登录后看到 3-4 步引导覆盖三个主面板（侧栏群组列表、聊天区域、右侧任务面板、@skill 输入提示）。可以点"跳过"直接关闭引导。引导结束后 30 秒内输入框看到 @skill 提示。可以在设置里选择"重新播放引导"。

**In Scope**：
- 3-4 步 coachmark 引导（react-joyride 或自实现）
- 每步高亮目标区域 + 说明气泡
- "跳过"按钮 + "下一步"/"完成"按钮
- 引导状态持久化（localStorage 或 cookie）
- Settings 页"重新播放引导"按钮

**Out of Scope**：
- 不实现交互式引导（需要用户操作才推进的那种）
- 不实现按角色差异化的引导路径

**验收标准**：
- Given 首次登录，When 进入 IM 页面，Then 看到引导覆盖三个主面板
- Given 引导进行中，When 点击"跳过"，Then 引导立即关闭
- Given 引导完成，When 30 秒内，Then 输入框区域看到 @skill 使用提示
- Given Settings 页面，When 点击"重新播放引导"，Then 下次进入 IM 时引导重新显示

**设计触点**：
- 涉及屏：screen:im/page, screen:IMShell, screen:login-redirect
- 涉及组件：onboarding-tour, coachmark, skip-button
- 涉及状态：first-visit, tour-in-progress, tour-completed, tour-skipped

**关联 Sitemap 页面**：
- page-login: /login — 登录
- page-im: /im — IM 工作台
- page-settings: /settings — 设置

**已生成的设计资产**：
- 待生成（需工程实现引导组件）

---

### Story 6：陈昊看到一条统一的错误提示而不是 5 种不同反馈

**Persona**：陈昊
**Job**：在多个页面遇到操作失败
**优先级**：P1

**功能描述**：IM/Workflow/Pipeline/Skills/Models/Settings 6 个页面使用同样风格的 toast 错误提示。每条 toast 有关闭按钮(X)和自动消失(5 秒)。可重试错误显示"重试"按钮。不再出现 alert()/console.error 静默/inline text 混杂模式。

**In Scope**：
- 全局 Toast 组件（success/error/warning/info 4 种 variant）
- 自动消失（5 秒）+ 手动关闭(X) + 堆叠机制
- 可重试错误显示"重试"按钮
- 逐页替换现有 5 种错误模式（alert()/console.error/inline/空 catch/原生 toast）
- 全局 Error Boundary 兜底

**Out of Scope**：
- 不实现错误上报/监控系统（Sentry 等）
- 不实现错误日志持久化

**验收标准**：
- Given 任意页面操作失败，When 错误发生，Then 看到统一风格 toast 提示
- Given toast 可见，When 点击 X 或等待 5 秒，Then toast 消失
- Given 可重试错误，When toast 显示，Then 看到"重试"按钮
- Given 全局未捕获错误，When React Error Boundary 触发，Then 看到全屏错误页 + "刷新页面"按钮
- Given 所有 6 个页面，When 检查错误处理代码，Then 不存在 alert()/console.error/空 catch

**设计触点**：
- 涉及屏：screen:all-pages
- 涉及组件：unified-toast, error-boundary, retry-button
- 涉及状态：success, error-retryable, error-permanent, disconnected

**关联 Sitemap 页面**：
- 全部 6 个页面（IM/Workflow/Pipeline/Skills/Models/Settings）

**已生成的设计资产**：
- 待生成（需工程实现全局 Toast + Error Boundary）

**异常态设计**（来自 edge.json）：
- 全局 Error Boundary：全屏"出了点问题" + 刷新按钮
- 全局 404：居中 404 卡片 + 返回工作台按钮
- 未登录重定向：/login?redirect=/原路径，登录后回跳

---

### 未列入本版的 Stories（Phase 2 备选）

以下方向在本版不实现，留待 Phase 2 评估：

- Pipeline 事件流结构化（当前 dump 原始 JSON，改为分类渲染 + 可展开 Details）
- Pipeline 事件流暂停/过滤/搜索 + 虚拟化（200 条无 react-window）
- Observability 图表交互 tooltip + 堆叠柱状图
- Graph 拓扑图节点点击交互（当前仅 hover）
- Workflow 快捷键系统（Ctrl+A/D/0）+ 拖拽 ghost preview
- Workflow 节点执行状态可视化（脉冲边框 / 绿色光晕 / 红色）

---

## Section 7 — Constraints & Risks

**技术约束**：
- Next.js 16 + React 19 + Tailwind v4 技术栈不变
- Zustand + Immer 状态管理架构保留
- 后端 SSE / REST API 接口不变
- framer-motion 11 动画库延续
- 8 周完成改版
- 组件模式："use client" + inline React.CSSProperties + CSS 变量（非 Tailwind utility-first）

**设计约束**：
- 断点切换无布局崩坏（必须 3 档断点平滑过渡）
- 触摸目标 ≥ 44px（平板）/ ≥ 48px（手机）不可妥协
- 所有动画必须尊重 prefers-reduced-motion
- 暗色主题为主（color-scheme: dark），亮色模式为 @media 覆盖

**数据 & 隐私**：
- 本改版不涉及用户数据采集变更
- OAuth 认证流程不变，无新的个人信息处理
- 引导状态持久化使用 localStorage 或 cookie，仅存布尔标志，不含个人数据

**关键风险表**：

| 风险 | 可能性 | 影响 | 缓解措施 |
| --- | --- | --- | --- |
| 移动端无实际使用场景（关键假设错） | Medium | High | 先发 Story 1（移动端 IM），上线后追踪移动端 UA 占比和操作频次。若 < 5% 则 Phase 2 降级响应式优先级 |
| IM 页面 1060 行复杂组件重构导致回归 bug | High | High | 渐进式改造：先加 useMediaQuery + 布局分支，不重写逻辑。Playwright E2E 覆盖核心路径。每阶段 verify（tsc + vitest + build）后再推进 |
| Workflow temporal middleware 与现有 Zustand store 不兼容 | Medium | Medium | Zustand temporal middleware 是官方插件，先做 spike POC 验证兼容性。不兼容则退回到自建 undo 栈 |
| 8 周工期不够覆盖 6 个 Story | Medium | High | P0 的 4 个 Story（移动端 IM + 平板抽屉 + Workflow 手机编辑 + 撤销）为 MVP 硬线。P1 的 2 个（引导 + 统一 toast）可顺延到 Phase 2 |

**已识别但未修复的设计问题**（来自 check.json blocker 项）：

- F-001：应用无 media query → 本版 Story 1/2 解决
- F-002：body overflow:hidden 小屏溢出 → 改版中修正
- F-003：4 套不兼容样式系统 → 本版 Story 6 统一为 CSS 变量 + inline style
- F-004：Observability 无导航出口 → quick-win 修复
- F-005：无 :focus-visible 样式 → 全局 CSS 添加

---

## Section 8 — Release Approach

**推荐顺序**：

1. **Story 6 — 统一错误反馈（基础设施先行）**：全局 Toast + Error Boundary 是所有页面的基础设施，先完成后其他 Story 直接使用。预计 1 周。
2. **Story 1 — 移动端 IM（关键假设测试）**：直接测试"移动端是否有使用场景"的核心假设。预计 2 周（IM 页面 1060 行改造量最大）。
3. **Story 2 — 平板抽屉**：复用 Story 1 的 useMediaQuery + drawer 基础设施。预计 1 周。
4. **Story 4 — 撤销/恢复**：Zustand temporal middleware + 通用 toast-with-action。预计 1 周。
5. **Story 3 — Workflow 手机编辑**：依赖 Story 4 的 BottomSheet 组件 + Story 1 的响应式策略。预计 1.5 周。
6. **Story 5 — 首次使用引导**：react-joyride 接入 + 4 步文案。预计 0.5 周。

**MVP 定义**：Story 6 + Story 1 + Story 2 + Story 4 = 最小可发布版本。覆盖：统一错误反馈基础设施 + 移动端/平板 IM 响应式 + Workflow 撤销恢复。能验证核心假设（移动端使用场景），同时清零 4 个 Blocker。

**Phase 2**：Story 3（Workflow 手机编辑）+ Story 5（首次使用引导）+ 未列入本版 Stories（Pipeline 事件流/图表交互/拓扑图交互）。

**上线考虑**：
- 上线前通知：内部开发团队（最先使用）、文档站更新响应式功能说明
- Soft launch：先灰度 10% 用户（按 workspace ID），观察 1 周无回归后全量
- 上线后头 2 周监测：移动端 UA 占比和操作频次、SSE 重连成功率、Toast 触发频次分布、撤销操作使用率、首次引导完成率和跳过率

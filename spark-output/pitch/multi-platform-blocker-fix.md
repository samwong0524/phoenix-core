# Pitch — Phoenix-Core / 多端适配改版 + 高优先级 Blocker 修复

- **生成时间**：2026-06-30T22:30:00+08:00
- **听众**：Mixed（Design Lead + PM + Tech Lead）
- **格式**：Doc（async 分享 + 会议讨论基础）
- **数据源**：11 个上游 Skill（audit / brief / journey / stories / sitemap / flow-web / edge / check / prd / motion-plan / motion-apply）
- **完整度**：strong

---

## 一句话押注 (The Bet)

我们押**全局响应式降级 + 4 项 Blocker 修复**来实现多 Agent 蜂群系统的移动端可用性，成功标准是核心页面移动端可用率从 0% 提升至 80%、新用户 5 分钟内完成首次 Agent 交互，8 周内交付。

---

## 为什么是现在 (Why Now)

**技术债临界点**：系统已完成 4 阶段商用化（TSC 0 errors、570 tests、81% 覆盖率），功能层基本完整。但启发评估发现 48 个体验问题（7 blocker / 41 major），其中 4 个核心页面在移动端完全不可用——这是系统性架构问题，不是局部修补。功能越加越多，响应式改造的迁移成本只会越来越高。

**用户行为变化**：陈昊（核心用户）的工作模式是"工位创建任务 → 会议室/路上监控进度"。当前只能在工位用桌面浏览器，移动端场景完全放弃。随着团队扩大，新成员首次进入面对 15+ 信息区域无任何引导（Journey 分析 pain_level=5，全旅程最高），Onboarding 成为最大流失风险。

**竞争窗口**：AutoGen 和 CrewAI 均为命令行/Jupyter 优先的工具，缺乏面向日常使用的 Web 界面。Phoenix-Core 的多端响应式 + 可视化 Workflow + 实时拓扑图是明确的差异化竞争力——但如果竞品也做 Web UI，窗口将关闭。

**现在不做的代价**：移动端场景持续不可用，新用户 Onboarding 流失率居高不下（无引导），破坏性操作（误删节点、Stop All）导致数据丢失无恢复路径——这些不是"体验瑕疵"，是阻塞产品从"能用"到"好用"的系统性障碍。

---

## 我们为谁设计 (User & JTBD)

**陈昊**，28 岁 AI 研发工程师，日常创建/监控多 Agent 协作任务，经常在工位和会议室之间切换。

JTBD：当陈昊需要编排多个 Agent 协同完成复杂开发任务时，陈昊想快速搭建工作流并实时监控执行状态，从而高效获得结果——无论他在工位还是在路上。

**为什么不为其他人做**：不为非技术用户做消费级体验——所有用户都具备基础开发背景，能理解 Agent、Workflow、Pipeline 等概念。

---

## 方向 + 备选 (Direction & Alternatives)

### 我们押的方向：全局响应式降级 + Blocker 修复

**用户价值**：陈昊可以在任意设备（手机/平板/桌面）上使用系统核心功能，不再被桌面绑定。首次使用有引导，误操作可撤销，错误反馈统一可理解。

**业务价值**：移动端可用性是竞品完全缺失的能力，直接构成差异化竞争力。Blocker 修复（撤销/确认/重连/引导）将产品从"能用"提升到"可靠"。

### 考虑过的其他方向

**方向 B：纯桌面端体验深度优化**（Workflow 编辑器升级 + 拓扑图交互增强 + Observability 图表交互）
→ 不押：桌面端体验已经基本可用，当前最大的系统性问题是移动端完全不可用。只做桌面端优化会忽略 50%+ 的使用场景（会议室/路上/沙发），且竞品也在追桌面端功能。

**方向 C：Native Mobile App**（React Native 独立移动端应用）
→ 不押：维护成本翻倍（两套代码库），且用户场景是"查看 + 轻量操作"而非"重度编辑"，响应式 Web 足以覆盖。8 周工期也不够做 Native App。

### 我们最不确定的事

**关键假设**：陈昊确实会在移动端（手机/平板）查看和操作 Agent 任务——如果他实际上只在桌面端工作，响应式改版的 ROI 将大幅下降。

**如何测试**：先发 Story 1（移动端 IM），上线后追踪移动端 UA 占比和操作频次。若 < 5%，Phase 2 降级响应式优先级，转向桌面端深度优化。

---

## 设计决策 (Design Decisions)

### 决策 1：三档断点策略（mobile / tablet / desktop）

**为什么这么决定**：IM 页面 1060 行复杂组件不可能做成"一套布局适应所有屏"。三档断点允许每个断点有独立的布局策略——桌面三栏固定、平板抽屉 overlay、手机单栏 + 底部 Sheet——而不是用 media query 做渐进折叠。

**证据**：flow-web 已生成 4 屏响应式原型验证可行性（Desktop/Tablet/Mobile/BottomSheet）。audit-2/5/6 三个 blocker 级响应式问题均指向固定宽度布局。

**关联屏**：IM Page（三态）、Workflow Canvas（手机只读）

### 决策 2：侧栏→抽屉 + 右面板→底部 Sheet 降级模式

**为什么这么决定**：侧栏（群组列表）是导航型内容，低频访问，适合折叠为抽屉。右侧面板（TaskMonitor）是监控型内容，高频查看但不常操作，适合折叠为底部 Sheet（60vh）可上滑查看。

**证据**：stories-1 验收标准要求"汉堡菜单 0.3 秒内展开侧栏"。edge.json 为 Bottom Sheet 设计了 loading/empty/error 完整状态矩阵。

**关联屏**：IM Mobile Layout、Mobile Bottom Sheet

### 决策 3：Zustand temporal middleware 做撤销/恢复（非自建 undo 栈）

**为什么这么决定**：项目已使用 Zustand + Immer，temporal middleware 是官方生态插件，与现有 store 零侵入集成。自建 undo 栈需额外维护、测试、与 Immer 补丁兼容——投入产出比不合理。

**证据**：audit-3（blocker）指出 Workflow 无撤销，stories-4 验收标准要求"连续撤销最多 20 步"。Zustand temporal middleware 原生支持 maxAge 配置。

**关联屏**：Workflow Editor

### 决策 4：全局 Toast + Error Boundary 先行（基础设施优先）

**为什么这么决定**：当前 5 种错误模式（toast/alert/console.error/inline/空 catch）分布在 6 个页面。不先统一基础设施，后续每个 Story 的错误处理都会产生不一致。先做 Toast 组件，后续 Story 直接消费。

**证据**：check.json 中 F-011/F-012/F-013/F-014/F-018/F-035 共 6 个 major 级反馈问题均指向错误处理不一致。audit-18/23/37/45 也确认同一问题。

**关联屏**：Global（All Pages）

### 决策 5：Workflow 手机端先做只读概览（P0），编辑放 P1

**为什么这么决定**：Workflow Canvas 三面板最小宽度 780px，手机上完整编辑不现实。先做只读概览（自动缩放 + 双指缩放）覆盖"查看"场景，编辑功能（底部 Sheet 表单）作为增强放 P1。

**证据**：stories-3 risk 字段明确建议"先做只读(P0)编辑放 P1"。edge.json 为手机端画布设计了 readonly-overview + node-selected 状态。

**关联屏**：Workflow Canvas (Mobile Read-only)

---

## 需要决定的事 (Asks) ⭐

### Ask 1：是否同意以"移动端可用率 > 80%"作为改版核心验证指标？

- **为什么需要决定**：这是 critical assumption 的量化锚点。如果团队认为"桌面端深度优化"比"移动端可用性"更优先，整个改版方向需要调整
- **决定时间**：改版启动前（本周内）
- **如果不决定的影响**：工程师无法确定 Story 优先级排序，P0/P1 边界模糊，可能导致资源分散在桌面端优化和移动端适配之间

### Ask 2：v1 MVP 是否包含 Story 5（首次使用引导）和 Story 6（统一 Toast）？

- **为什么需要决定**：MVP 硬线是 Story 6 + 1 + 2 + 4（统一 Toast + 移动端 IM + 平板抽屉 + 撤销），共 4 个 Story。Story 5（引导）是 P1 可顺延。但引导直接影响 Journey 中 Onboarding 阶段（pain_level=5）的体验，不做则新用户流失风险不降
- **决定时间**：Sprint 0 规划前（下周初）
- **如果不决定的影响**：引导组件（react-joyride 集成）需要 0.5 周工期，如果不明确纳入则无法排入 sprint

### Ask 3：Workflow 手机端编辑（Story 3）是否纳入 v1 还是延后到 Phase 2？

- **为什么需要决定**：Story 3 依赖 BottomSheet 组件（已有）+ 画布只读模式 + 节点配置表单，预计 1.5 周。如果纳入 v1 则 8 周工期偏紧；延后则 v1 手机端只能查看不能编辑
- **决定时间**：Sprint 1 开始前（第 2 周）
- **如果不决定的影响**：工程师无法规划 Workflow 模块的改造范围，可能预留过多或过少 buffer

### Ask 4：是否同意 8 周工期 + 渐进式改造策略？

- **为什么需要决定**：IM 页面 1060 行，全量重写风险高。渐进式策略（先加 useMediaQuery + 布局分支，不重写逻辑）降低回归风险但可能不如全量重写"干净"
- **决定时间**：改版启动前（本周内）
- **如果不决定的影响**：如果倾向全量重写，工期可能延长到 10-12 周，需要额外资源

### Ask 5：CI workflow（GitHub Actions）是否需要 PAT `workflow` scope 才能推送？

- **为什么需要决定**：`.github/workflows/ci.yml` 已编写完成（typecheck → build → E2E 三 job 流水线），但当前 PAT 缺少 `workflow` scope 无法推送。需要决定是更新 PAT 还是用其他方式部署 CI
- **决定时间**：本周内
- **如果不决定的影响**：CI 流水线无法启用，改版期间的自动化测试保障缺失

---

> **相关文档**：
> - 完整 PRD：`spark-output/prd/multi-platform-blocker-fix.md`
> - 用户旅程图：`spark-output/journey/phoenix-core.html`
> - 异常态矩阵：`spark-output/edge/phoenix-core.md`
> - 链路面板：`spark-output/dashboard.html`

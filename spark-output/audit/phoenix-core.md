# Audit — Phoenix-Core

- **生成时间**：2026-06-30T16:45:00+08:00
- **走查对象**：代码 `F:\swarm-ide\backend\app\`
- **走查页面数**：19
- **走查模式**：自动（代码扫描）

## 总览

| 严重度 | 数量 |
| --- | --- |
| Blocker | 7 |
| Major | 41 |
| Minor | 0 |

**按维度分布**：

| 维度 | findings 数 |
| --- | --- |
| visibility | 7 |
| real-world-match | 2 |
| user-control | 5 |
| consistency | 5 |
| error-prevention | 5 |
| recognition | 3 |
| flexibility | 4 |
| aesthetic | 3 |
| error-recovery | 5 |
| help-docs | 2 |
| responsive | 5 |
| performance | 2 |

## 改版机会点（按优先级排序）

### 高优先级

**机会点 1：首次使用引导体系（Onboarding）**
- 关联 findings：4 个 → audit-1, audit-16, audit-19, audit-33
- 优先级理由：多 Agent 聊天是全新范式，用户需引导发现 Agent 群组、@技能语法、目录浏览器、拓扑可视化等核心概念。当前无任何引导，新用户体验为"面对 15+ 信息区域完全不知所措"。
- 影响范围：IM 页、Settings 页、全局空状态

**机会点 2：全站响应式适配**
- 关联 findings：5 个 → audit-2, audit-5, audit-6, audit-44, audit-20
- 优先级理由：5 个核心页面中 4 个在移动端完全不可用（IM 三栏、Pipeline 三栏、Workflow 三面板、Graph 固定侧栏）。系统性架构问题，需全局响应式策略。
- 影响范围：IM、Workflow、Pipeline、Graph 页

**机会点 3：撤销/恢复与破坏性操作防护**
- 关联 findings：6 个 → audit-3, audit-4, audit-7, audit-11, audit-24, audit-28
- 优先级理由：Workflow 编辑器无 undo/redo 是 blocker 级问题。节点删除、Stop All、技能删除、Pipeline Review 等破坏性操作均无确认。需全局统一"操作确认 + 撤销"模式。
- 影响范围：Workflow 编辑器、IM、Skills、Pipeline

**机会点 4：错误反馈标准化**
- 关联 findings：6 个 → audit-18, audit-23, audit-37, audit-45, audit-8, audit-26
- 优先级理由：当前错误反馈有 5 种模式——原生 toast（无关闭）、console.error（静默）、alert()（阻塞）、inline text、空 catch。需建立统一的 ErrorFeedback 系统。
- 影响范围：全站所有页面

### 中优先级

**机会点 5：视觉与交互一致性统一**
- 关联 findings：5 个 → audit-13, audit-14, audit-46, audit-47, audit-32
- 优先级理由：按钮 5 种样式模式、3 种 CSS 方案混用、5 种导航模式、Card API 不一致。影响可维护性和用户心智模型一致性。
- 影响范围：全站

**机会点 6：信息架构与密度优化**
- 关联 findings：3 个 → audit-17, audit-29, audit-48
- 优先级理由：IM 页 15+ 信息区同时可见、Pipeline 事件流 dump 原始 JSON、TaskMonitor 假按钮。需要渐进式展示策略和更好的数据可视化。
- 影响范围：IM、Pipeline、TaskMonitor

**机会点 7：Workflow/Pipeline 编辑器体验升级**
- 关联 findings：6 个 → audit-21, audit-22, audit-25, audit-34, audit-35, audit-36
- 优先级理由：Workflow 编辑器缺少保存状态指示、加载骨架、运行前保存检查、拖拽预览、执行状态可视化、快捷键系统。核心创作工具，体验直接影响效率。
- 影响范围：Workflow 编辑器

**机会点 8：监控与可观测性增强**
- 关联 findings：7 个 → audit-27, audit-30, audit-31, audit-40, audit-41, audit-42, audit-43
- 优先级理由：SSE 无重连、事件流无暂停/过滤/虚拟化、图表无交互 tooltip、成功率显示歧义、时间范围全页刷新、拓扑图无节点交互。监控工具需要更强的实时交互能力。
- 影响范围：Pipeline、Observability、Graph

## 完整 Findings 清单

### 维度 1：visibility（系统状态可见性）

1. **[major]** IM 文件上传无进度指示，uploading 状态仅为布尔切换，无进度条/百分比/文件名
   - 出现位置：im/page.tsx:952-954 — 上传按钮显示 uploading 文字但无进度组件
   - 修复建议：添加线性进度条或上传按钮 spinner overlay，显示正在上传的文件名
   - 修复成本：medium

2. **[major]** IM 初始加载无骨架屏或连接状态指示，bootstrap 期间用户看到空白聊天面板
   - 出现位置：im/page.tsx:477 — chat div 直接渲染，session 为 null 时无加载态
   - 修复建议：session 为 null 时显示骨架加载器或居中 spinner "Connecting to workspace..."
   - 修复成本：quick-win

3. **[major]** Workflow 保存状态模糊且无自动消失，无 dirty/unsaved 指示器
   - 出现位置：workflow/page.tsx:408-419 — message span 无 auto-dismiss，修改画布后无 unsaved 标记
   - 修复建议：添加 isDirty flag，显示 "Unsaved changes" pill，成功消息 3 秒后自动消失
   - 修复成本：medium

4. **[major]** Workflow 加载现有 DSL 无 loading 指示器，用户先看到默认节点再被替换
   - 出现位置：workflow/page.tsx:199-215 — useEffect 加载 DSL 无 loading state
   - 修复建议：添加 loadingWorkflow 状态，加载中显示骨架或 overlay
   - 修复成本：quick-win

5. **[major]** Pipeline SSE 连接状态指示器过于隐蔽（8px 圆点），断连无 banner/重试
   - 出现位置：pipeline/page.tsx:314-318 — 顶部小圆点指示连接状态，断连无显眼提示
   - 修复建议：断连时显示顶部 banner "Connection lost — Reconnecting..." + 手动重试按钮
   - 修复成本：medium

6. **[major]** Pipeline SSE 无自动重连逻辑，onerror 仅设置 isConnected=false，断连后数据永久过期
   - 出现位置：pipeline/page.tsx:136-154 — EventSource onerror 无指数退避重连
   - 修复建议：实现指数退避重连（1s/2s/4s/8s/max 30s），显示重连倒计时，添加手动重连按钮
   - 修复成本：medium

7. **[major]** Settings toast 未包裹 AnimatePresence，exit 动画永远不会触发
   - 出现位置：settings/page.tsx:83-111 — motion.div 有 exit props 但无 AnimatePresence 包裹
   - 修复建议：用 `<AnimatePresence>` 包裹 toast
   - 修复成本：quick-win

### 维度 2：real-world-match（系统与现实世界匹配）

8. **[major]** Agent 活动状态使用硬编码中文，未走 i18n："深度思考…"、"执行中"、"生成中…"
   - 出现位置：im/page.tsx:493-494 — 硬编码中文字符串
   - 修复建议：提取为 i18n keys: t('im.activity.thinking'), t('im.activity.executing'), t('im.activity.generating')
   - 修复成本：quick-win

9. **[major]** Observability "Success vs Error" 图表仅显示 success_count，图例含 error/timeout 但无对应柱状图
   - 出现位置：observability/page.tsx:292-303 — 图例 3 色但仅渲染 success_count
   - 修复建议：实现堆叠/分组柱状图显示三个系列，或移除误导性图例
   - 修复成本：medium

### 维度 3：user-control（用户控制与自由）

10. **[blocker]** Workflow 编辑器无撤销/重做，删除节点不可恢复，Delete 键直接移除无确认
    - 出现位置：WorkflowCanvas.tsx:200-212 — Delete/Backspace 直接调用 store.removeNode()，store 无 undo 栈
    - 修复建议：Zustand store 添加 undo/redo 栈（immer temporal middleware），Ctrl+Z/Ctrl+Shift+Z 快捷键，删除后 3 秒 snackbar 提供撤销
    - 修复成本：medium

11. **[major]** "Stop All Agents" 无确认对话框，danger 按钮直接中断所有 Agent 循环，操作不可逆
    - 出现位置：im/page.tsx:459-462 — onClick 直接调用 onInterruptAllAgents()
    - 修复建议：添加轻量确认（"再次点击确认" 模式或 popover 确认）
    - 修复成本：quick-win

12. **[major]** 文件上传无取消机制，选择文件后立即上传，无法中止
    - 出现位置：im/page.tsx:180-185 — handleFileSelect 直接调用 uploadFile，无 abort 路径
    - 修复建议：上传中显示取消按钮或进度指示器带 abort 能力
    - 修复成本：medium

13. **[major]** Workflow 运行中无取消/停止按钮，Run 按钮变为 disabled + "Running..." 但无法中止
    - 出现位置：workflow/page.tsx:349-371 — handleRun POST activate 后无 stop/cancel 机制
    - 修复建议：添加 Stop 按钮调用 cancel endpoint，Run 按钮运行中切换为 Stop（toggle 模式）
    - 修复成本：medium

14. **[major]** Pipeline Review 批准/拒绝无确认，操作不可逆
    - 出现位置：pipeline/page.tsx:300-307 — handleReview 直接改变 stage 状态
    - 修复建议：添加确认步骤
    - 修复成本：quick-win

### 维度 4：consistency（一致性与标准）

15. **[major]** IM 组件混合 CSS class、inline style、CSS 变量三种样式方案，TaskMonitor 全 inline，FileCard 全 inline
    - 出现位置：im/page.tsx:480-495 (12 个 inline 属性) vs TaskMonitor.tsx (sectionStyle/headerStyle 对象) vs FileCard.tsx
    - 修复建议：统一为 CSS modules 或 Tailwind classes，至少右面板（TaskMonitor）应使用同一套样式系统
    - 修复成本：major-rework

16. **[major]** IM 按钮样式不统一：viz 控件用 "btn"、停止用 "btn-action danger"、发送用 "send-btn"、模型用 "chat-model"
    - 出现位置：im/page.tsx:615-643, 459-462, 1031, 1009-1030 — 5 种不同按钮模式
    - 修复建议：定义按钮变体系统（primary/secondary/danger/ghost/icon）并统一应用
    - 修复成本：medium

17. **[major]** 跨页面导航模式不统一：Workflow 自定义顶栏、Pipeline 侧栏底部链接、Settings PageLayout、模板库自定义头部
    - 出现位置：5 个页面 5 种导航模式，无共享导航组件
    - 修复建议：统一导航模式——全部使用 PageLayout 或创建共享导航组件
    - 修复成本：medium

18. **[major]** 跨页面样式方案混乱：inline style / CSS class / Tailwind 三种混用，Card 组件 API 不一致
    - 出现位置：observability 混用 Tailwind+inline, skills 用 Card padding={16}, models 用 padding="16px 20px"
    - 修复建议：统一样式策略，标准化 Card 组件 API
    - 修复成本：medium

19. **[major]** Settings toast 未包裹 AnimatePresence，exit 动画永远不会触发
    - 出现位置：settings/page.tsx:83-111 — motion.div 有 exit props 但无 AnimatePresence 包裹
    - 修复建议：用 `<AnimatePresence>` 包裹 toast
    - 修复成本：quick-win

### 维度 5：error-prevention（错误预防）

20. **[blocker]** Workflow 节点删除无二次确认，复杂 Agent 节点配置数据一键丢失
    - 出现位置：WorkflowCanvas.tsx:200-212 — 按下 Delete 立即移除，无任何确认对话框
    - 修复建议：删除后显示 toast "Node deleted — Undo?" 持续 3 秒，或对含数据的节点弹确认框
    - 修复成本：quick-win

21. **[blocker]** Skills 页面删除技能无确认，handleDelete 直接发 DELETE 请求，误操作永久移除技能
    - 出现位置：skills/page.tsx:143-160 — handleDelete 无确认直接调用 fetch DELETE
    - 修复建议：移植 skills-list.tsx 的 useConfirm() 模式到 skills/page.tsx
    - 修复成本：quick-win

22. **[major]** Workflow Run 按钮不检查未保存更改，可能运行过期版本
    - 出现位置：workflow/page.tsx:351-352 — handleRun 仅检查 workflowId 存在，不检查 isDirty
    - 修复建议：isDirty 时弹提示："有未保存更改。保存并运行，还是运行上次保存的版本？"
    - 修复成本：quick-win

23. **[major]** Models 页面 API Key 保存前无格式校验，可保存空字符串或错误格式
    - 出现位置：models/page.tsx:55-77 — save() 直接 post apiKey 无格式检查
    - 修复建议：按 provider 添加轻量客户端校验（最小长度、前缀检查）
    - 修复成本：quick-win

24. **[major]** Observability 成功率阈值假设 0-1 比例，显示时乘 100，API 返回百分比时逻辑错误
    - 出现位置：observability/page.tsx:209-210 vs 257 — >=0.99 阈值 vs *100 显示，无归一化
    - 修复建议：添加归一化步骤：rate > 1 时除以 100
    - 修复成本：quick-win

### 维度 6：recognition（识别优于回忆）

25. **[major]** Ctrl+Enter 发送消息的快捷键未在 UI 中任何位置提示
    - 出现位置：im/page.tsx:982-985 — Ctrl+Enter 调用 onSend()，但发送按钮仅显示 SEND 文字
    - 修复建议：发送按钮内或下方添加 "Ctrl+Enter" 提示，或作为 tooltip
    - 修复成本：quick-win

26. **[major]** 三栏布局无新手引导，用户面对 Agent 侧栏 + 聊天 + 可视化 + 任务监控无任何解释
    - 出现位置：IMShell.tsx 全文 19 行裸布局，零引导
    - 修复建议：首次使用添加 tooltip tour 或 "?" 帮助图标解释各面板功能
    - 修复成本：medium

27. **[major]** Settings 仅 4 个配置项（语言/主题/LLM/关于），用户期望更多设置但无 Coming Soon 提示
    - 出现位置：settings/page.tsx:119-173 — 仅 Language/Theme/LLM Config/About
    - 修复建议：为计划中的设置添加占位区或 "Coming Soon" 标识
    - 修复成本：quick-win

### 维度 7：flexibility（使用的灵活性与效率）

28. **[major]** Pipeline 事件流无暂停/过滤/搜索，实时滚动中无法冻结查看
    - 出现位置：pipeline/page.tsx:412-444 — 纯滚动列表，无 pause/filter/search
    - 修复建议：添加 Pause toggle 停止自动滚动，文本过滤输入框，严重度过滤 chips
    - 修复成本：medium

29. **[major]** Workflow Canvas 仅有 Delete 键快捷方式，无 Ctrl+A/D/Z/Ctrl+0 等常用画布快捷键
    - 出现位置：WorkflowCanvas.tsx:199-212 — 仅处理 Delete/Backspace
    - 修复建议：添加常见画布快捷键，通过 "?" 键显示快捷键参考 overlay
    - 修复成本：medium

30. **[major]** Observability 切换时间范围触发全页刷新（window.location.href），破坏组件状态
    - 出现位置：observability/page.tsx:227 — onChange 直接设置 window.location.href
    - 修复建议：用组件 state 管理 hours + router.push 客户端更新
    - 修复成本：medium

31. **[major]** Graph 拓扑图节点无点击交互，hover 仅显示 ID 和 role，无法查看 Agent 详情
    - 出现位置：graph/page.tsx:184-226 — 仅 onMouseEnter/Leave，无 onClick
    - 修复建议：添加 onClick 在侧栏显示 Agent 详情面板（ID/role/消息量/最后活动）
    - 修复成本：medium

### 维度 8：aesthetic（美学与极简设计）

32. **[major]** IM 页面信息密度极高：同时显示 15+ 独立信息区域（sidebar/chat/viz/monitor）
    - 出现位置：im/page.tsx 全文 — 左栏(logo+workspace+dir+agentTree) + 中栏(header+activity+reasoning+messages+skillSuggestions+input+modelSelect+attach) + 右栏(5 section monitor) + viz(zoom+edges+beams+nodes)
    - 修复建议：渐进式展示——默认隐藏 viz 面板让用户切换，TaskMonitor 折叠为摘要 chip 点击展开
    - 修复成本：major-rework

33. **[major]** Pipeline 事件流直接 dump 原始 JSON（截断到 180 字符），认知负荷极高
    - 出现位置：pipeline/page.tsx:421-440 — JSON.stringify(evt.data).slice(0,180) 作为事件内容
    - 修复建议：解析已知事件类型渲染结构化摘要，原始 JSON 放入可展开 "Details" disclosure
    - 修复成本：medium

34. **[major]** TaskMonitor Awareness 区域 Memory/Calendar 按钮外观可点击但无功能（无 onClick/role/tabIndex）
    - 出现位置：TaskMonitor.tsx:170-178 — div cursor:pointer 但无交互处理
    - 修复建议：实现功能、添加 onClick、或标记 "Coming soon" + aria-disabled
    - 修复成本：quick-win

### 维度 9：error-recovery（帮助用户识别/诊断/修复错误）

35. **[major]** IM 错误 toast 无关闭按钮、无重试机制，错误消失依赖外部状态清除
    - 出现位置：im/page.tsx:864 — toast div 无 close button，bootstrap/message/model 失败均无恢复路径
    - 修复建议：添加关闭按钮 (X) + 自动超时消失 + 上下文重试按钮
    - 修复成本：medium

36. **[major]** Workflow/Pipeline 多处 API 调用错误被静默吞掉，用户无任何反馈
    - 出现位置：workflow/page.tsx:184-196,199-215,275-276 — 多个 .catch(() => {})，用户不知操作失败
    - 修复建议：关键数据加载失败显示 toast/banner，区分瞬态错误(重试)和永久错误(提示)
    - 修复成本：quick-win

37. **[major]** Models 页面保存失败被静默吞掉，用户无反馈
    - 出现位置：models/page.tsx:72-73 — catch 块仅 console.error，无用户侧反馈
    - 修复建议：catch 块添加红色 toast 错误提示
    - 修复成本：quick-win

38. **[major]** Skills-list 使用原生 alert() 做错误反馈（阻塞、无样式），与 toast 系统不一致
    - 出现位置：skills-list.tsx:102,132,139 — alert() 调用，硬编码中文 "安装失败"
    - 修复建议：替换所有 alert() 为 toast 组件，修复硬编码中文
    - 修复成本：quick-win

39. **[major]** Workflow Canvas 节点无执行状态可视化（运行中无脉冲边框、完成无绿色光晕、失败无红色）
    - 出现位置：WorkflowCanvas.tsx — 自定义节点不读取 executionStatus，PropertiesPanel 仅文字显示
    - 修复建议：节点读取 data.executionStatus 渲染视觉状态：running=脉冲边框, completed=绿色光晕, failed=红色
    - 修复成本：medium

### 维度 10：help-docs（帮助与文档）

40. **[blocker]** IM 多 Agent 聊天无首次使用引导，用户需自行发现 Agent 群组、@技能、目录浏览器、拓扑可视化等独特概念
    - 出现位置：IMShell.tsx 仅 19 行裸三栏布局，无任何 tooltip / tour / empty-state 引导
    - 修复建议：实现首次使用引导（react-joyride 或模态标注截图），至少为每个面板添加空状态说明
    - 修复成本：major-rework

41. **[major]** @skill 语法无内联提示，用户必须偶然发现输入 @ 触发技能自动完成
    - 出现位置：im/page.tsx:956-987 — placeholder 仅提示 Ctrl+Enter 发送，未提及 @ 语法
    - 修复建议：首次聚焦输入框时显示提示："Tip: 输入 @ 附加技能"
    - 修复成本：quick-win

### 维度 11：responsive（响应式适配）

42. **[blocker]** 三栏布局（sidebar + chat + monitor）在移动端完全不可用，无媒体查询、无汉堡菜单、无响应式断点
    - 出现位置：IMShell.tsx:13 — 三面板平铺渲染，无 flex-wrap / media query
    - 修复建议：实现响应式策略：移动端侧栏改为滑出抽屉，右侧面板改为底部 sheet，加 media query
    - 修复成本：major-rework

43. **[blocker]** Pipeline 监控三栏固定宽度（300px + flex + 420px），最小可用宽度 ~1020px，无响应式断点
    - 出现位置：pipeline/page.tsx:310-474 — display:flex 硬编码像素宽度
    - 修复建议：实现 CSS Grid minmax 布局，移动端垂直堆叠，事件流折叠为可展开面板
    - 修复成本：major-rework

44. **[blocker]** Workflow Canvas 三面板（NodePalette 200px + canvas flex + Properties 280px）最小宽度 ~780px，无折叠机制
    - 出现位置：WorkflowCanvas.tsx:243 — display:flex height:100vh，NodePalette/PropertiesPanel 固定宽度
    - 修复建议：窄屏：NodePalette 折叠为浮动 FAB + 底部 sheet，PropertiesPanel 改为滑出抽屉，Canvas 占满视口
    - 修复成本：major-rework

45. **[major]** IM 可视化面板仅支持鼠标平移（onMouseDown/onMove/Up），无触摸事件处理
    - 出现位置：im/page.tsx:575-593 — viz canvas 平移仅处理 mouse 事件，无 touch handler
    - 修复建议：添加 touch 事件处理器用于移动端 viz 画布平移
    - 修复成本：medium

46. **[major]** Graph 侧栏固定 280px 宽度，无折叠/响应式行为
    - 出现位置：graph/page.tsx:376 — width:280, flexShrink:0
    - 修复建议：窄屏折叠侧栏，移动端改为底部 sheet 或 toggle overlay
    - 修复成本：medium

### 维度 12：performance（性能感知）

47. **[major]** Pipeline 事件列表 200 条无虚拟化，每次更新对所有事件执行 JSON.stringify
    - 出现位置：pipeline/page.tsx:147 — 200 条事件全部渲染为 DOM 节点，无 react-window
    - 修复建议：使用 react-window 或 react-virtuoso 虚拟化列表，插入时预 stringify
    - 修复成本：medium

48. **[major]** Workflow Canvas 从调色板拖拽节点无视觉反馈（无 ghost preview、无 drop zone 高亮）
    - 出现位置：NodePalette.tsx:60-85,115-143 — cursor:grab + hover 效果，但拖拽中无自定义 dragImage
    - 修复建议：设置自定义 dragImage，拖拽到画布时高亮 drop 区域
    - 修复成本：medium

## 下一步建议

- **改版方向**：基于机会点 1-4（高优先级），建议下一步走 Brief 把改版方向沉淀为一页纸
- **修复优先**：7 个 Blocker 项建议在改版工程启动前先修（尤其是 undo/redo、破坏性操作确认、响应式适配）

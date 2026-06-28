# 设计走查报告

**走查目标**：Phoenix-Core 全前端（app/ pages + components + CSS + src/lib/motion.ts）
**走查时间**：2026-06-27T18:43:41Z
**走查模式**：Mode A — 自动走查（Read 代码文件静态检查）
**走查范围**：7 个页面 + 6 个共享组件 + 1 个设计系统 CSS + 1 个动效模块

## 总览

| 严重度 | 数量 |
| --- | --- |
| 🔴 Blocker | 5 |
| 🟠 Major | 35 |
| 🟡 Minor | 16 |
| ✅ Pass（默认通过未列） | — |

> 未读到 Brief，未做类别 10（与 Brief 一致性）检查。

---

## 🔴 Blocker（5 项）

### 1. [responsive] 整个应用无响应式设计
- **描述**：无任何 media query（除 prefers-reduced-motion），三栏布局使用固定宽度（260px sidebar + flex + auto），在 <900px 屏幕上完全不可用
- **出现位置**：`app/globals.css` (line 158 `.app` grid-template-columns)
- **修复建议**：添加 mobile/tablet/desktop 三档断点：≤768px 单栏（sidebar 折叠为抽屉）、769-1024px 双栏、>1024px 三栏

### 2. [responsive] body overflow:hidden 阻断小屏滚动
- **描述**：body 设置 `overflow: hidden`，小屏上溢出内容被裁切且无法滚动访问
- **出现位置**：`app/globals.css` (line 65)
- **修复建议**：移除 body overflow:hidden，改为在 `.app` 容器上处理滚动，或在各面板内部设置 overflow-y:auto

### 3. [components] 四套不兼容的样式系统
- **描述**：① globals.css 共享类 ② Tailwind utility（仅 observability 页）③ inline style + 硬编码 hex（skills/pipeline 页）④ inline style + CSS var（models 页）。页面间视觉不一致
- **出现位置**：`skills/page.tsx`, `pipeline/page.tsx`, `observability/page.tsx`, `models/page.tsx`
- **修复建议**：统一采用 globals.css 设计系统，所有页面使用同一套 token

### 4. [flow-continuity] Observability 页面无导航出口
- **描述**：无任何返回首页、面包屑或导航链接，形成死胡同页面
- **出现位置**：`app/observability/page.tsx`
- **修复建议**：添加 `<Link href="/">← 返回首页</Link>` 导航

### 5. [accessibility] 所有交互元素无 :focus-visible 样式
- **描述**：按钮、输入框、链接无焦点指示。input 和 chat-input-field 设置 `outline: none` 移除了原生焦点环，键盘用户无法看到当前焦点位置
- **出现位置**：`app/globals.css` (lines 259, 1243, 1309)
- **修复建议**：为所有交互元素添加 `:focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px }`

---

## 🟠 Major（35 项）

### 6. [visual-hierarchy] 标题层级扁平且缺失
- **描述**：page.tsx 只有 `<h1>`，所有分区标题用 `<div>` 实现；observability 页 h1→h3 跳级
- **出现位置**：`app/page.tsx` (line 28), `app/observability/page.tsx` (line 207→267)
- **修复建议**：使用语义化标题层级 h1>h2>h3

### 7. [visual-hierarchy] 多处字号过小
- **描述**：.stat-label 7px、.ws-id 9px、.sys-tag 7.5px，低于 WCAG 建议的最小 11px
- **出现位置**：`app/globals.css` (lines 1690, 841, 1590)
- **修复建议**：最小字号设为 11px

### 8. [edge-states] IMMessageList 无空状态
- **描述**：消息列表为空时不渲染任何内容，用户看到空白聊天区域
- **出现位置**：`app/im/IMMessageList.tsx` (line 116)
- **修复建议**：添加空状态占位 + 引导文案

### 9. [edge-states] Graph 和 Pipeline 页面无 loading 状态
- **描述**：异步数据加载期间页面渲染空白
- **出现位置**：`app/graph/page.tsx` (lines 42-53), `app/pipeline/page.tsx` (lines 107-129)
- **修复建议**：添加 skeleton 或 spinner

### 10. [edge-states] Home 页面 catch{} 静默吞错
- **描述**：空 catch 块，数据库错误无任何反馈
- **出现位置**：`app/page.tsx` (lines 19-20)
- **修复建议**：添加错误状态 UI + 重试按钮

### 11. [feedback] Stop All Agents 无二次确认
- **描述**：破坏性操作单击即执行
- **出现位置**：`app/im/page.tsx` (line 1024)
- **修复建议**：添加 confirm 对话框

### 12. [feedback] Skills 删除无确认
- **描述**：单击「删除」立即移除技能
- **出现位置**：`app/skills/page.tsx` (lines 140-157)
- **修复建议**：添加确认对话框

### 13. [feedback] 模型选择器无反馈
- **描述**：切换后 fetch 静默执行，无成功/失败提示
- **出现位置**：`app/im/page.tsx` (lines 2291-2296)
- **修复建议**：添加 toast 提示

### 14. [feedback] 文件上传用 alert()
- **描述**：与设计系统 toast 不一致，阻塞主线程
- **出现位置**：`app/im/page.tsx` (line 1143), `app/_components/skills-list.tsx`
- **修复建议**：替换为统一 toast 组件

### 15. [components] 按钮 border-radius 不统一
- **描述**：.btn=10px, .btn-action=5px, .send-btn=7px, Models=6px, Skills=6px/4px
- **出现位置**：`app/globals.css` (lines 226, 1069, 1253, 1277)
- **修复建议**：定义 --radius-sm/md token 统一使用

### 16. [components] Home 页面全部 inline style
- **描述**：完全绕过设计系统，无法主题化
- **出现位置**：`app/page.tsx` (lines 24-115)
- **修复建议**：迁移到 CSS 类或共享组件

### 17. [components] Skills/Pipeline 硬编码色值
- **描述**：使用 #0F172A, #0a0a0f 等，与 --bg-void: #050a14 不一致
- **出现位置**：`app/skills/page.tsx`, `app/pipeline/page.tsx` (line 307)
- **修复建议**：替换为 CSS 变量

### 18. [components] Pipeline 使用 system-ui 字体
- **描述**：与全局 --font-body: Exo 2 不一致
- **出现位置**：`app/pipeline/page.tsx` (line 307)
- **修复建议**：替换为 `font-family: var(--font-body)`

### 19. [copy] 中英文混用无 i18n 策略
- **描述**：Skills/Pipeline 全中文，Graph/Models/Observability 全英文，IM 混合
- **出现位置**：跨页面
- **修复建议**：确定主语言，统一所有页面文案

### 20. [accessibility] --text-dim 对比度不足
- **描述**：rgba(120,150,190,0.5) 在 #050a14 上约 2.8:1，不满足 WCAG AA 4.5:1
- **出现位置**：`app/globals.css` (line 27)
- **修复建议**：提升亮度至对比度 ≥4.5:1

### 21. [accessibility] 无 ARIA landmarks
- **描述**：布局全部使用 `<div>`，无 `<main>`, `<nav>`, `<aside>`
- **出现位置**：`app/im/IMShell.tsx`, `app/page.tsx`
- **修复建议**：添加语义标签

### 22. [accessibility] Agent 树不可键盘导航
- **描述**：div + onClick，不可聚焦
- **出现位置**：`app/im/page.tsx` (line 1779)
- **修复建议**：改用 `<button>` 或添加 role + tabIndex + onKeyDown

### 23. [accessibility] 表单 input 无 label 关联
- **描述**：所有 `<input>` 无 `<label htmlFor>`
- **出现位置**：`app/models/page.tsx` (line 286), `app/_components/create-workspace.tsx`
- **修复建议**：添加关联 label 或 aria-label

### 24. [flow-continuity] 页面导航模式不一致
- **描述**：各页面返回目标不同（Home/IM/无），无统一模式
- **出现位置**：跨页面
- **修复建议**：创建共享 PageHeader 组件

### 25. [responsive] 仅 1/6 页面有响应式处理
- **描述**：Observability 用 Tailwind 响应式类，其余 5 页全部固定宽度
- **出现位置**：`app/observability/page.tsx`（唯一有响应式的页面）
- **修复建议**：为所有页面添加断点适配

### 26. [responsive] Graph 页面 grid 窄屏溢出
- **描述**：`repeat(2, minmax(0, 320px))` 在窄屏溢出
- **出现位置**：`app/graph/page.tsx` (line 96)
- **修复建议**：改为 `repeat(auto-fit, minmax(280px, 1fr))`

### 27. [responsive] Pipeline 页面窄屏溢出
- **描述**：三栏固定宽度（300px + flex + 420px）在 <1020px 溢出
- **出现位置**：`app/pipeline/page.tsx` (line 307)
- **修复建议**：添加响应式断点

### 28. [feedback] Pipeline review 为非功能 stub
- **描述**：approve/reject 仅更新本地 state，未调用 API
- **出现位置**：`app/pipeline/page.tsx` (lines 297-304)
- **修复建议**：实现 API 调用或禁用按钮

### 29. [accessibility] 全应用无 aria-label
- **描述**：发送按钮、停止按钮、文件上传、模型选择器等均缺失
- **出现位置**：跨页面
- **修复建议**：为所有交互元素添加 aria-label

### 30. [edge-states] Home 页面无 loading 状态
- **描述**：数据库慢查询时用户看到空白
- **出现位置**：`app/page.tsx` (lines 17-21)
- **修复建议**：添加 skeleton

### 31. [edge-states] Home 工作区列表无空状态
- **描述**：列表为空时无提示
- **出现位置**：`app/page.tsx` (line 105)
- **修复建议**：添加空状态 UI

### 32. [components] AgentStatusCard 硬编码色值
- **描述**：使用 #1a1a1a, #333 等，与 CSS 变量脱节
- **出现位置**：`app/im/AgentStatusCard.tsx` (lines 7-13)
- **修复建议**：替换为 CSS 变量

### 33. [components] cx()/api() 函数重复定义
- **描述**：在 page.tsx、helpers.ts、IMHistoryList.tsx 中重复定义且行为有差异
- **出现位置**：`app/im/page.tsx`, `app/im/helpers.ts`, `app/im/IMHistoryList.tsx`
- **修复建议**：统一从 helpers.ts 导入

### 34. [components] types.ts 与 page.tsx 类型定义重叠不同步
- **描述**：Group 类型字段不一致（creatorId 有/无）
- **出现位置**：`app/im/types.ts`, `app/im/page.tsx` (lines 21-97)
- **修复建议**：统一从 types.ts 导出

### 35. [feedback] Toast 无关闭/自动消失/堆叠
- **描述**：多错误时叠加覆盖
- **出现位置**：`app/im/page.tsx` (line 2253)
- **修复建议**：添加 auto-dismiss + 关闭按钮

### 36. [accessibility] 状态指示器仅靠颜色传达
- **描述**：status-dot 无文字替代
- **出现位置**：`app/im/page.tsx` (line 1799)
- **修复建议**：添加 aria-label

### 37. [accessibility] Viz 动画未做 reduced motion 降级
- **描述**：framer-motion 组件未接入 useReducedMotion
- **出现位置**：`app/im/page.tsx` (lines 2084-2225)
- **修复建议**：接入 useReducedMotion

### 38. [edge-states] Models 页面错误无重试
- **描述**：错误状态仅显示纯文本
- **出现位置**：`app/models/page.tsx` (lines 97-103)
- **修复建议**：添加重试按钮

### 39. [edge-states] Skills 页面 ErrorFallback 无重试
- **描述**：错误后无法恢复
- **出现位置**：`app/skills/page.tsx` (lines 601-610)
- **修复建议**：添加重试按钮

### 40. [flow-continuity] IM 切换 sub-agent 后无返回导航
- **描述**：只能手动点击侧栏返回
- **出现位置**：`app/im/page.tsx` (line 994)
- **修复建议**：添加面包屑或返回链接

---

## 🟡 Minor（16 项）

### 41. [flow-continuity] IM Suspense fallback 视觉不协调
- **出现位置**：`app/im/page.tsx` (line 251)
- **修复建议**：使用品牌化 loading skeleton

### 42. [ia] Agent 树混合层级与会话概念
- **出现位置**：`app/im/page.tsx` (lines 535, 612)
- **修复建议**：统一展示逻辑

### 43. [ia] 右侧面板 7 区块无 Tab 切换
- **出现位置**：`app/im/page.tsx` (right section)
- **修复建议**：改为 Tab 切换

### 44. [ia] 全应用无面包屑
- **出现位置**：跨页面
- **修复建议**：在 PageHeader 中添加

### 45. [copy] 按钮文案大小写不一致
- **出现位置**：`app/im/page.tsx` (lines 1921, 2307)
- **修复建议**：统一 sentence case

### 46. [copy] 错误信息面向开发者
- **出现位置**：`app/im/page.tsx` (lines 989, 1064)
- **修复建议**：改为用户友好描述

### 47. [copy] 空状态文案语言不一致
- **出现位置**：`app/im/page.tsx` (line 1879)
- **修复建议**：统一语言

### 48. [visual-hierarchy] 间距值无系统规范
- **出现位置**：`app/globals.css`
- **修复建议**：定义 4px 基数间距 token

### 49. [visual-hierarchy] NavCard borderRadius 与 .card 冲突
- **出现位置**：`app/page.tsx` (line 141)
- **修复建议**：移除 inline 覆盖

### 50. [components] Test 页面浅色主题矛盾
- **出现位置**：`app/test/page.tsx`
- **修复建议**：限制 development only 或改暗色

### 51. [components] QuickPick 硬编码色值
- **出现位置**：`app/_components/quickpick.tsx`
- **修复建议**：替换为 CSS 变量

### 52. [components] Observability 用 Tailwind 色值
- **出现位置**：`app/observability/page.tsx`
- **修复建议**：替换为 Phoenix CSS变量

### 53. [feedback] window.prompt() 输入 sub-agent role
- **出现位置**：`app/im/page.tsx` (line 994)
- **修复建议**：替换为自定义 Modal

### 54. [feedback] Viz 缩放无边界禁用
- **出现位置**：`app/im/page.tsx` (lines 2002-2032)
- **修复建议**：边界时 disabled 按钮

### 55. [accessibility] QuickPick 无 ARIA dialog 属性
- **出现位置**：`app/_components/quickpick.tsx`
- **修复建议**：添加 role + focus trap

### 56. [accessibility] Pipeline 连接状态仅颜色传达
- **出现位置**：`app/pipeline/page.tsx` (line 312)
- **修复建议**：添加 aria-label

---

## 修复优先级建议

**必须修复（Blocker，影响可用性/合规性）**：5 项
- 响应式设计（F-001, F-002）→ 添加断点 + 移除 body overflow:hidden
- 样式系统统一（F-003）→ 所有页面迁移到 globals.css 设计系统
- 导航出口补全（F-004）→ Observability 页添加返回链接
- 焦点样式（F-005）→ 全局添加 :focus-visible

**建议修复（Major 中影响主流程的项）**：约 15 项
- 空状态/加载态/错误态补全（F-008~F-010, F-030~F-031, F-038~F-039）
- 破坏性操作确认（F-011, F-012）
- 反馈机制完善（F-013, F-014, F-035）
- 无障碍基础（F-020~F-023, F-029, F-036）
- 语言统一（F-019）

**可延后（Minor + 部分 Major）**：约 31 项
- IA 优化、文案统一、间距 token 化、组件代码整理等

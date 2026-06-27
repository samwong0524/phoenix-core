# SWARM IDE — 前端设计方案 V1

## 1. 品牌身份

### 命名
- **产品名**: SWARM IDE（保持）
- **标语**: Orchestrate Intelligence. 编排智能。
- **设计语言代号**: "Nexus" — 连接点、枢纽、中心的含义

### Logo 概念
- **图形**: 六边形蜂巢网格 + 中心发光节点，代表 "Swarm 群体智能"
- **风格**: 线框 + 发光点，科技感、精确
- **位置**: 左上角侧栏顶端，16px 圆形图标 + 文字标

### 色彩体系

```
/* Dark theme (primary) */
--nexus-bg:         oklch(0.12 0.01 260)     /* 深空底色 #1a1b23 */
--nexus-surface:    oklch(0.16 0.015 260)    /* 卡片面板 #23263b */
--nexus-border:     oklch(0.22 0.02 260)     /* 分割线 #2e3148 */
--nexus-elevated:   oklch(0.20 0.02 260)     /* 悬浮态 #2d3048 */

/* 主色调 — Cyan/Teal（代表 AI/智能流） */
--nexus-accent:     oklch(0.70 0.15 220)     /* #38bdf8 → 改良为更高级的 cyan */
--nexus-accent-dim: oklch(0.55 0.12 220)     /* 低亮度强调 */

/* 语义色 — 更加雅致 */
--nexus-success:    oklch(0.65 0.18 160)     /* 翡翠绿 */
--nexus-warning:    oklch(0.70 0.18 85)      /* 琥珀 */
--nexus-danger:     oklch(0.60 0.22 25)      /* 玫瑰红 */
--nexus-info:       oklch(0.65 0.14 260)     /* 紫蓝 */

/* 文字 */
--nexus-text:       oklch(0.93 0.01 260)     /* 主文字 */
--nexus-muted:      oklch(0.55 0.02 260)     /* 辅助文字 */
--nexus-dim:        oklch(0.35 0.02 260)     /* 极淡文字 */

/* 亮色主题 (light theme 备用) */
--nexus-bg-light:         oklch(0.97 0.005 260)
--nexus-surface-light:    oklch(0.95 0.005 260)
--nexus-border-light:     oklch(0.88 0.01 260)
--nexus-text-light:       oklch(0.15 0.01 260)
--nexus-muted-light:      oklch(0.50 0.02 260)
```

### 字体体系

```css
/* Display — 用于 Logo、大标题 */
--font-display: "Instrument Serif", "Newsreader", Georgia, serif;

/* UI — 正文、按钮、标签 */
--font-ui: "Inter Display", "SF Pro Display", -apple-system, sans-serif;

/* Mono — 代码、数据、指标 */
--font-mono: "JetBrains Mono", "SF Mono", ui-monospace, monospace;
```

| 用途 | 字重 | 字号 |
|------|------|------|
| Logo | 700 | 18px |
| Page title | 600 | 20px |
| Section header | 600 | 13px |
| Body | 400 | 14px |
| Small/meta | 400 | 12px |
| Mono data | 400 | 12px |
| Code | 400 | 13px |

---

## 2. 布局系统

### 全局布局层次

```
┌─────────────────────────────────────────────────┐
│  ┌─────┬─────────────────────────┬─────────────┐ │
│  │     │                         │             │ │
│  │  侧  │     主 内 容 区         │    Agent    │ │
│  │  栏  │  (聊天 / 图谱 / 设置)   │    详情栏   │ │
│  │      │                         │             │ │
│  │ 280px│       1fr              │   360px     │ │
│  └─────┴─────────────────────────┴─────────────┘ │
└─────────────────────────────────────────────────┘
```

### 侧栏 (280px) — 常驻导航

```
┌──────────────────┐
│ Logo + Brand     │ 48px header
├──────────────────┤
│ Workspace 下拉    │ 40px
├──────────────────┤
│ 搜索 / 过滤       │ 36px
├──────────────────┤
│ Agent Tree       │
│ ├─ human         │
│ ├─ assistant     │ flex: 1
│ ├─ ─ coordinator │ scroll
│ ├─ ─ ─ worker-1  │
│ ├─ ─ ─ worker-2  │
│ └─ product       │
├──────────────────┤
│ 底部导航          │
│ [聊天] [图谱]     │ 48px
│ [设置]            │
└──────────────────┘
```

### 主内容区 — 根据页面切换
### 右侧栏 (360px) — Agent 监控面板

可折叠的 panel stack（与当前一致但更好看）：
1. **LLM History** — 可展开/折叠，可拖拽调整大小
2. **Realtime Content** — streaming response
3. **Realtime Reasoning** — CoT stream
4. **Tool Calls** — 工具调用流
5. **Agent Metrics** — token 消耗、延迟、调用次数

---

## 3. 设计语言 — "Nexus" 细则

### 3.1 背景与深度

- **主背景**: 深空蓝黑 `oklch(0.12 0.01 260)`，非纯黑
- **细微纹理**: 用 CSS 生成 subtle grid pattern 或 noise texture，增加质感
- **表面分层**: 通过 3 层背景色区分层级（bg / surface / elevated）
- **光晕效果**: 强调色在关键区域产生径向渐变光晕

### 3.2 圆角与阴影

```
--radius-sm:    6px    /* 标签、小元素 */
--radius-md:    10px   /* 卡片、输入框 */
--radius-lg:    14px   /* 面板、弹窗 */
--radius-xl:    20px   /* 大卡片 */

--shadow-sm:    0 1px 2px rgba(0,0,0,0.3)
--shadow-md:    0 4px 12px rgba(0,0,0,0.4)
--shadow-lg:    0 8px 30px rgba(0,0,0,0.5)
--shadow-glow:  0 0 20px rgba(var(--accent-rgb), 0.15)
```

### 3.3 动画

- **持续时间**: fast 150ms / normal 250ms / slow 400ms
- **缓动函数**:
  - 进入: `cubic-bezier(0.16, 1, 0.3, 1)` — 优雅弹入
  - 退出: `cubic-bezier(0.4, 0, 0.2, 1)` — 平滑淡出
- **关键动画**:
  - Agent 创建: 节点从父节点飞出 + 脉冲光晕
  - 消息发送: 消息气泡从小变大 + 轻微滑动
  - Agent 状态变化: 状态指示器呼吸动画
  - 页面切换: 内容区域交叉淡入淡出

### 3.4 Agent 视觉标识

每个 agent 角色分配独特的颜色 + icon 组合，在侧栏树、聊天和拓扑图中保持一致：

| 角色 | 色标 | 图标 | 标识色 |
|------|------|------|--------|
| human | 白 | User | `#f8fafc` |
| assistant | 青 | Bot | `#38bdf8` |
| coordinator | 紫 | Sitemap | `#a78bfa` |
| coder | 绿 | Code | `#34d399` |
| productmanager | 粉 | Briefcase | `#fb7185` |
| researcher | 橙 | Search | `#fbbf24` |
| editor | 玫红 | Pen | `#f472b6` |
| worker | 灰蓝 | Cpu | `#94a3b8` |
| specialist | 黄绿 | Sparkles | `#a3e635` |

---

## 4. 页面详细设计

### 4.1 Home (`/`) — 工作台 / 仪表盘

**用途**: 登录后首屏，展示 workspace 概览、快速操作

```
┌──────────────────────────────────────────────┐
│  ☰ SWARM IDE                      [+ New WS] │ header
├──────────────────────────────────────────────┤
│                                              │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐        │
│  │ Agents│ │Groups│ │Msgs  │ │Tokens │        │ — 4 统计卡片
│  │  12   │ │  8   │ │1.2k  │ │  45% │        │
│  └──────┘ └──────┘ └──────┘ └──────┘        │
│                                              │
│  最近活跃 Workspaces                          │
│  ┌─────────────────────────────────────┐     │
│  │ Default Workspace        2m ago  ▶  │     │ — workspace 列表
│  │ My Dev WS               15m ago  ▶  │     │   每项显示:
│  │ Test-LLM                2h ago   ▶  │     │   名称 + 时间 + 消息数
│  └─────────────────────────────────────┘     │
│                                              │
│  ⚡ 快速开始                                   │
│  [创建 Agent]  [打开 IM]  [查看拓扑]           │
└──────────────────────────────────────────────┘
```

### 4.2 IM (`/im`) — 核心聊天界面

**用途**: 与 agent 对话、编排多 agent 工作

```
┌──────────────────────────────────────────────────────────┐
│ ┌──────────┬──────────────────────────┬──────────────────┐│
│ │ ☰ SWARM  │  Coordinator-v3          │ Agent Details    ││
│ │          │  [Stop All] [Hire]       │                  ││
│ │ Default  ├──────────────────────────┤ Streaming: asst_2││
│ │          │  ┌─────┐                 │ ┌──────────────┐ ││
│ │ ├ human  │  │嗨，帮我写一个       │  │ ▾ LLM History │ ││
│ │ ├ assistant│ 天气查询工具         │  │ #12 assistant │ ││
│ │ │         │  │                      │  │ — 分析需求... │ ││
│ │ ├─coord  │  └─────┘                 │  │ #11 tool_calls│ ││
│ │ │ └wkr-1 │  ┌─────────────────────┐ │  │ — get_weather│ ││
│ │ │ └wkr-2 │  │好的，我来创建一个   │ │  ├──────────────┤ ││
│ │ │         │  │查询工具。首先...     │ │  │ ▾ Realtime  │ ││
│ │ ├ product│  │                      │ │  │ 正在生成...  │ ││
│ │          │  │                      │ │  ├──────────────┤ ││
│ │          │  └─────────────────────┘ │  │ ▾ Reasoning  │ ││
│ │          │  ────────────────────────│  │ 用户想要一... │ ││
│ │          │  ┌──────────────────────┐ │  ├──────────────┤ ││
│ │          │  │ 图谱可视化区域       │ │  │ ▾ Tool Calls │ ││
│ │          │  │ (agent 节点图)       │ │  └──────────────┘ ││
│ │          │  └──────────────────────┘ │                  ││
│ │          ├──────────────────────────┤                  ││
│ │          │ [Input...        ] [Send]│                  ││
│ └──────────┴──────────────────────────┴──────────────────┘│
└──────────────────────────────────────────────────────────┘
```

**关键交互优化**:
1. 侧栏 agent 树 → 点击切换聊天上下文
2. 中间聊天区支持 markdown / mermaid / code highlight（已有 streamdown）
3. 底部图谱区：拓扑图 + 时间线事件流
4. 右侧监控面板：四个可折叠 panel 垂直排列

### 4.3 图谱 (`/graph`) — Agent 拓扑全景

**用途**: 全局查看 agent 网络结构，拖拽布局

- 全屏 canvas 视图，覆盖整个主内容区
- 左上角悬浮控制面板：缩放 / 搜索 / 布局算法选择
- 点击节点 → 弹出 agent 详情卡
- 边显示消息频率（粗细编码）

### 4.4 Settings (`/settings`) — 配置管理（新增）

**用途**: 管理 workspace、API keys、模型配置、token 限额

- Workspace 列表（CRUD）
- Provider 配置（OpenRouter / Anthropic / GLM / Ollama）
- Token 限额滑块
- Backup 管理列表
- 系统日志查看

### 4.5 Workflows (`/workflows`) — DAG 工作流（新增）

**用途**: 可视化的 DAG 工作流编辑器和管理

- 工作流列表（卡片网格）
- 工作流详情：DAG 图、节点状态、运行历史
- 每个节点可展开查看输入/输出

---

## 5. 组件体系

### 原子组件

| 组件 | 说明 |
|------|------|
| Button | 多 variant: primary / secondary / ghost / danger |
| Input | 文本框 + 多行文本 + 搜索 |
| Badge | 角色标签 / 状态 / 计数 |
| Avatar | Agent 头像（角色首字母 + 色圈） |
| Tooltip | 悬浮提示 |
| Switch | 开关 |
| Select | 下拉选择器 |
| Progress | 进度条 / token bar |
| Skeleton | 加载占位 |

### 分子组件

| 组件 | 说明 |
|------|------|
| ChatBubble | 聊天消息气泡（发件人/收件人） |
| AgentNode | 拓扑图中的 agent 节点 |
| SidebarTree | 带缩进的 agent 树 |
| EventStream | 实时事件列表 |
| StatCard | 统计卡片 |
| PanelStack | 可折叠/拖拽的面板叠层 |
| WorkspaceCard | workspace 卡片 |

### 页面组件

| 组件 | 说明 |
|------|------|
| AppShell | 三栏布局框架 |
| Sidebar | 侧栏（navigation + agent tree） |
| Composer | 消息输入框（支持 /commands） |
| TopologyView | 图谱可视化 |
| RightPanel | Agent 监控面板 |

---

## 6. 实现路线

### Phase 1 — 基础框架（2-3 天）
1. 建立设计 tokens（CSS variables）
2. 重构 AppShell 三栏布局组件
3. 实现 Sidebar 组件（logo + workspace 下拉 + agent tree）
4. 重构 globals.css → 模块化 CSS

### Phase 2 — 核心页面（3-4 天）
1. 重新设计 Home dashboard
2. 重写 IM 页面（chat + graph + right panel）
3. 实现 AgentNode + 拓扑图美化
4. 实现 RightPanel + PanelStack
5. Composer 重设计

### Phase 3 — 新增页面（2-3 天）
1. Settings 页面
2. Workflows 页面
3. Graph 全屏视图

### Phase 4 — 细节与动效（1-2 天）
1. Agent 状态指示器动画
2. 消息发送/接收动画
3. 页面切换过渡
4. 微交互（hover、focus、active）
5. 响应式适配基础

---

## 7. 技术方案

- **框架**: Next.js App Router（已有，不动）
- **样式**: Tailwind CSS + CSS Variables（已有）
- **UI 渲染**: Streamdown + lucide-react + framer-motion（已有）
- **补充工具**:
  - `clsx` → 已用
  - `tailwind-merge` → 推荐加入（简化 className 合并）
  - `vaul` 或 `cmdk` → 可选，用于命令面板
- **字体加载**: 通过 `next/font` 加载 Instrument Serif + Inter Display + JetBrains Mono

---

## 8. 差异化亮点

1. **Agent 角色色系** — 每个角色有专属色 + icon，全平台一致，一眼识别
2. **拓扑图事件流** — 实时 beam 动画 + 同步事件列表，让人"看见" agent 协作
3. **PanelStack** — 可折叠、可拖拽排序、可调整大小的监控面板（类似 VSCode 的 panel）
4. **深空质感** — 非纯黑背景，有层次的深色 + 光晕，区别于普通 dark mode
5. **Agent 树** — 带缩进层次 + 折叠/展开 + 实时状态点 + context token bar

# Sitemap — Phoenix-Core

- **生成时间**：2026-06-30T19:00:00+08:00
- **平台**：Multi（Web 桌面 + Mobile 响应式降级）
- **数据源**：Brief + Stories + Journey + Audit
- **页面总数**：10
- **最大深度**：1 层（扁平结构，所有功能页直达）

## 主导航

- 💬 IM（工作台） — `/im`（message-square）
- 🔀 Workflow — `/workflow`（git-branch）
- 📊 Pipeline — `/pipeline`（activity）
- ⚡ 技能 — `/skills`（zap）
- 🧠 模型 — `/models`（cpu）
- 📈 可观测 — `/observability`（bar-chart-2）
- 🕸️ 拓扑 — `/graph`（network）
- ⚙️ 设置 — `/settings`（settings）

## 站点树

```
/ (工作台首页，重定向到 /im) [auth]
├── /login (登录) [public]
├── /im (IM 工作台 — 三栏：Agent群组/聊天/监控) [auth]
│   ├── 左侧栏：Logo + 工作区 + 目录浏览器 + Agent 树
│   ├── 中栏：聊天头 + 活动状态 + 消息流 + 输入框
│   ├── 右栏：任务监控（Todo/Artifacts/Skills/Awareness）
│   └── 底层：拓扑可视化（zoom/edges/beams/nodes）
├── /workflow (Workflow 编辑器 — 三面板) [auth]
│   ├── 左面板：NodePalette（节点调色板）
│   ├── 中画布：ReactFlow 画布（拖拽/连线/选择）
│   └── 右面板：PropertiesPanel（节点属性编辑）
├── /pipeline (Pipeline 监控 — 三栏) [auth]
│   ├── 左栏：Stage 列表 + 状态
│   ├── 中栏：事件详情
│   └── 右栏：SSE 事件流
├── /skills (技能管理) [auth]
│   ├── 技能列表（安装/卸载/配置）
│   └── 技能详情
├── /models (模型配置) [auth]
│   └── Provider 列表 + API Key 表单
├── /observability (可观测性) [auth]
│   ├── 时间范围选择器
│   └── 指标图表（成功率/响应时间/调用量）
├── /graph (Agent 拓扑) [auth]
│   ├── 力导向图（vis-network）
│   └── 右侧栏：Agent 详情
└── /settings (设置) [auth]
    ├── 语言切换
    ├── 主题选择
    ├── LLM 默认模型
    └── 关于
```

## 页面清单

| ID | Route | Label | Purpose | Access | 关联 Story |
| --- | --- | --- | --- | --- | --- |
| page-login | /login | 登录 | OAuth 认证入口 | public | story-5 |
| page-home | / | 工作台首页 | 重定向到 /im | auth | — |
| page-im | /im | IM 工作台 | 多 Agent 群组聊天 + 拓扑 + 监控 | auth | story-1, story-2, story-5 |
| page-workflow | /workflow | Workflow 编辑器 | DAG 可视化编辑 + 运行 | auth | story-3, story-4 |
| page-pipeline | /pipeline | Pipeline 监控 | 实时执行 + SSE 事件流 + 审批 | auth | story-6 |
| page-skills | /skills | 技能管理 | MCP Skills 安装/配置 | auth | story-6 |
| page-models | /models | 模型配置 | LLM Provider + API Key | auth | story-6 |
| page-observability | /observability | 可观测性 | 指标仪表盘 | auth | — |
| page-graph | /graph | Agent 拓扑 | 关系可视化 | auth | — |
| page-settings | /settings | 设置 | 用户偏好 | auth | — |

## 关键 Flow

### 1. 首次登录引导
`/login` → `/` (redirect) → `/im`（首次使用引导覆盖三面板）

### 2. IM 多 Agent 交互
`/im`（选择群组 → @skill 附加技能 → 发送消息 → 查看 Agent 响应 + 拓扑联动 + 任务监控更新）

### 3. Workflow 创建与运行
`/workflow`（从调色板拖节点 → 连线 → 配置属性 → 保存 → 运行）→ `/pipeline`（监控执行阶段 + SSE 事件流）

### 4. 系统监控与诊断
`/observability`（查看指标异常）→ `/graph`（定位问题 Agent）→ `/im`（介入调整 Agent 配置）

## 响应式降级策略（Multi 端）

| 断点 | 行为 |
| --- | --- |
| ≥ 1280px（桌面） | 全部面板展开，8 项侧栏导航 |
| 1024–1279px（笔记本） | 右侧面板可折叠 |
| 768–1023px（平板） | 侧栏→滑出抽屉，面板→底部 sheet |
| < 768px（手机） | 单栏布局，汉堡菜单，面板按需弹出 |

## 路由表

| Route | 组件 | 说明 |
| --- | --- | --- |
| `/login` | `app/login/page.tsx` | OAuth 登录页 |
| `/` | `app/page.tsx` | 重定向到 /im |
| `/im` | `app/im/page.tsx` | IM 主工作台 |
| `/workflow` | `app/workflow/page.tsx` | Workflow 编辑器 |
| `/pipeline` | `app/pipeline/page.tsx` | Pipeline 监控 |
| `/skills` | `app/skills/page.tsx` | 技能管理 |
| `/models` | `app/models/page.tsx` | 模型配置 |
| `/observability` | `app/observability/page.tsx` | 可观测性 |
| `/graph` | `app/graph/page.tsx` | Agent 拓扑 |
| `/settings` | `app/settings/page.tsx` | 设置 |

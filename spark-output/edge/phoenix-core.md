# Edge States — Phoenix-Core

- **生成时间**：2026-06-30T21:30:00+08:00
- **走查屏数**：15
- **状态总数**：78（must: 56 / should: 14 / nice-to-have: 8）
- **数据源**：flow-web / sitemap / stories

## 总览

| 类别 | 状态数 | 关键缺失 |
| --- | --- | --- |
| 空状态 | 14 | Pipeline 空搜索、Skills 空搜索、Workflow 首次进入 |
| 加载状态 | 22 | 无（已全面覆盖 Skeleton/spinner 模式） |
| 错误状态 | 22 | 全局 404、全局 Error Boundary、Workflow 校验错误 |
| 边界数据 | 8 | 超长文本处理（IM 消息、节点名称） |
| 权限状态 | 3 | 未登录重定向（保留来源 URL）、权限不足页 |
| 离线状态 | 2 | 移动端离线、弱网提示 |

## 关键缺失（必须设计但当前缺位）

### 🔴 Blocker

- **IM Page (All)** · `offline-no-network`：多端适配核心——陈昊在会议室/路上断网时必须看到离线状态，不能白屏或静默失败
- **Workflow Editor** · `error-validation`：节点配置不完整时必须有明确视觉反馈（红色虚线边框 + 错误字段高亮），阻止无效运行
- **Global** · `permission-anonymous`：OAuth 认证是系统入口，未登录重定向必须保留来源 URL 实现登录后回跳
- **Global** · `error-not-found`：404 页面是安全网，当前无全局路由兜底 + Error Boundary

### 🟠 High

- **Pipeline Monitor** · `empty-search`：Pipeline 列表有搜索功能但当前无空搜索结果设计
- **IM Page (Mobile)** · `offline-poor-connection`：移动端弱网场景（电梯/地铁）常见，需要明确的用户提示
- **Models Configuration** · `error-validation`：API Key 配置错误是高频问题，必须有实时 inline 校验反馈
- **Observability Dashboard** · `empty-first-time`：新部署系统首次访问仪表盘必然为空，不能显示空白图表区

## 修复优先级建议

1. **必做（Blocker）**：全局 Error Boundary + 404 页 + OAuth 重定向保留来源 URL + IM 离线状态 + Workflow 校验反馈
2. **应做（High）**：Pipeline/Skills/Models 空搜索 + 移动端弱网提示 + 仪表盘首次空状态
3. **可延后（Should）**：自动刷新指示器、虚拟滚动、null 字段占位文字、rate-limit 倒计时

## 状态矩阵（按屏组织）

### Screen: Login (/login) [public]

#### loading-initial（must）
- **设计描述**：OAuth 跳转中，全屏半透明遮罩 + 中央 spinner + '正在跳转到认证服务...'
- **用户能做什么**：等待，3 秒后若未完成显示'跳转超时，点击重试'
- **视觉提示**：Overlay bg-void 80% opacity, centered spinner 32px
- **文案建议**：正在跳转到认证服务...
- **关联 Story**：story-5

#### loading-submit（must）
- **设计描述**：点击登录按钮后变 disabled + '登录中...' + spinner
- **用户能做什么**：等待跳转或超时
- **视觉提示**：Button disabled, spinner 16px left of text
- **文案建议**：登录中...
- **关联 Story**：story-5

#### error-network（must）
- **设计描述**：网络不通时，顶部 toast '网络连接失败' + 重试按钮
- **用户能做什么**：点击重试或检查网络
- **文案建议**：网络连接失败，请检查网络后重试
- **关联 Story**：story-6

#### error-server（must）
- **设计描述**：OAuth 服务不可用，中央错误卡片
- **文案建议**：认证服务暂时不可用，请稍后再试
- **关联 Story**：story-6

#### error-rate-limit（should）
- **设计描述**：频繁点击登录，按钮 disabled + toast 倒计时
- **文案建议**：操作过于频繁，请 {n} 秒后再试
- **关联 Story**：story-6

---

### Screen: IM Page — Desktop (≥1024px)

#### loading-initial（must）
- **设计描述**：三栏布局 Skeleton 占位——侧栏 5 个群组骨架 + 聊天区 6 条消息骨架 + 任务面板 4 个卡片骨架
- **用户能做什么**：等待加载完成
- **视觉提示**：Skeleton shimmer, bg-card base, 3-column layout preserved
- **关联 Story**：story-1

#### empty-collection（must）
- **设计描述**：新 workspace 无群组，Chat 区中央空状态 + '创建第一个群组' CTA
- **用户能做什么**：点击按钮创建群组
- **文案建议**：还没有任何群组对话。创建一个群组，开始和你的 Agent 团队协作吧。
- **关联 Story**：story-1

#### empty-first-time（must）
- **设计描述**：首次登录 3-4 步引导覆盖三个主面板 + coachmark 高亮
- **用户能做什么**：跳过或跟随引导
- **文案建议**：欢迎使用 Phoenix-Core！让我们花 30 秒了解一下界面。
- **关联 Story**：story-5

#### error-network（must）
- **设计描述**：SSE 断开时，Chat 区顶部固定 banner '连接已断开，正在重连...'
- **用户能做什么**：等待自动重连或手动点击'立即重连'
- **文案建议**：连接已断开，正在重连... ({n}s)
- **关联 Story**：story-6

#### loading-fetch-more（must）
- **设计描述**：向上滚动加载历史消息，顶部 inline spinner
- **文案建议**：加载更早的消息...
- **关联 Story**：story-1

#### loading-submit（must）
- **设计描述**：发送消息后乐观更新 + typing indicator
- **用户能做什么**：等待回复，失败可重试
- **关联 Story**：story-1

#### boundary-long-text（must）
- **设计描述**：超长消息自动换行，代码块内部滚动 + 复制按钮
- **视觉提示**：Message bubble max-w-70%, code block overflow-x-auto
- **关联 Story**：story-1

#### boundary-overflow（should）
- **设计描述**：任务/Agent 数量大时虚拟滚动
- **关联 Story**：null

#### boundary-null（should）
- **设计描述**：Agent 无头像首字母占位，群组无描述灰色占位文字
- **文案建议**：暂无描述
- **关联 Story**：null

---

### Screen: IM Page — Tablet (768-1023px)

#### loading-initial（must）
- **设计描述**：全宽 Skeleton（侧栏默认隐藏），6 条消息 + 输入框骨架

#### empty-collection（must）
- **设计描述**：全宽空状态 + 汉堡菜单引导
- **文案建议**：还没有群组对话。点击左上角菜单创建一个。

#### error-network（must）
- **设计描述**：同 Desktop banner

#### loading-submit（must）
- **设计描述**：同 Desktop 乐观更新

---

### Screen: IM Page — Mobile (<768px)

#### loading-initial（must）
- **设计描述**：全宽 Skeleton，顶部 header + 消息 + 输入框骨架

#### empty-collection（must）
- **设计描述**：空状态 + 箭头指向汉堡菜单
- **文案建议**：还没有群组。点击左上角 ≡ 创建一个。

#### error-network（must）
- **设计描述**：紧凑 banner
- **文案建议**：已断开 · 重连中

#### loading-submit（must）
- **设计描述**：发送按钮变 spinner

#### offline-no-network（must）⭐ CRITICAL
- **设计描述**：完全离线时底部固定条，输入框可打字但消息缓存
- **用户能做什么**：网络恢复后自动同步
- **文案建议**：当前离线 · 消息将在恢复网络后发送
- **关联 Story**：story-1

#### offline-poor-connection（should）
- **设计描述**：弱网时底部微妙提示条
- **文案建议**：网络较慢，请耐心等待
- **关联 Story**：story-1

---

### Screen: Bottom Sheet (Mobile)

#### loading-initial（must）
- **设计描述**：Sheet 弹出后内部 3 个 Skeleton 卡片

#### empty-collection（must）
- **设计描述**：无任务时 '当前没有运行中的任务'
- **文案建议**：当前没有运行中的任务

#### loading-submit（must）
- **设计描述**：Sheet 内操作按钮 disabled + spinner

---

### Screen: Workflow Editor (/workflow)

#### loading-initial（must）
- **设计描述**：三面板 Skeleton（调色板 + 画布 + 属性面板）

#### empty-first-time（must）
- **设计描述**：新建空 Workflow，画布中央提示 + 箭头指向调色板
- **文案建议**：从左侧面板拖入节点，开始构建你的工作流

#### empty-collection（must）
- **设计描述**：Workflow 列表页无数据
- **文案建议**：还没有工作流。创建一个来编排你的 Agent 协作流程。

#### error-server（must）
- **设计描述**：保存失败 toast + 标题旁 * 未保存标记
- **文案建议**：保存失败，请稍后重试

#### error-validation（must）⭐ CRITICAL
- **设计描述**：节点配置不完整，红色虚线边框 + 角标感叹号 + 属性面板高亮错误字段
- **用户能做什么**：填写缺失字段
- **文案建议**：此节点需要配置 {字段名}
- **关联 Story**：story-3

#### error-not-found（must）
- **设计描述**：访问已删除 Workflow，404 风格卡片
- **文案建议**：该工作流不存在或已被删除

#### loading-submit（must）
- **设计描述**：保存/运行按钮 disabled + spinner
- **文案建议**：保存中... / 启动中...

#### boundary-long-text（must）
- **设计描述**：节点名称截断 + tooltip，属性面板换行

#### boundary-null（should）
- **设计描述**：可选字段 '未配置' 灰色占位

---

### Screen: Workflow Canvas — Mobile Read-only

#### loading-initial（must）
- **设计描述**：全宽 Skeleton 缩略图占位

#### error-network（must）
- **设计描述**：加载失败错误卡片 + 重试

---

### Screen: Pipeline Monitor (/pipeline)

#### loading-initial（must）
- **设计描述**：5 行卡片 Skeleton

#### empty-collection（must）
- **设计描述**：无执行记录 + 引导到 Workflow 编辑器
- **文案建议**：还没有 Pipeline 执行记录。先从工作流编辑器启动一个 Pipeline 吧。

#### empty-filter（should）
- **设计描述**：筛选无匹配 + '清除筛选'
- **文案建议**：没有符合条件的执行记录

#### empty-search（must）
- **设计描述**：搜索无结果
- **文案建议**：没有找到匹配的结果，试试其他关键词

#### error-network（must）
- **设计描述**：SSE 断开 banner + 重连指示
- **文案建议**：实时连接已断开，正在重连...

#### loading-refresh（should）
- **设计描述**：手动刷新图标旋转 + 列表淡出重载

---

### Screen: Skills Management (/skills)

#### loading-initial（must）
- **设计描述**：6 行卡片 Skeleton

#### empty-collection（must）
- **设计描述**：无已安装 Skills + 浏览可用技能 CTA
- **文案建议**：还没有安装任何技能。浏览可用技能来增强你的 Agent 能力。

#### empty-search（must）
- **设计描述**：搜索无结果
- **文案建议**：没有找到匹配的技能

#### error-server（must）
- **设计描述**：注册表加载失败 toast + 重试

#### loading-submit（must）
- **设计描述**：安装/卸载按钮 disabled + spinner

---

### Screen: Models Configuration (/models)

#### loading-initial（must）
- **设计描述**：4 行 Provider 卡片 Skeleton

#### empty-first-time（must）
- **设计描述**：无 Provider 配置 + 添加 CTA
- **文案建议**：还没有配置任何模型。添加 LLM Provider 让你的 Agent 能够调用大模型。

#### error-validation（must）
- **设计描述**：API Key 格式错误红色边框 + inline 提示
- **文案建议**：API Key 格式不正确 / 无法连接到该服务

#### loading-submit（must）
- **设计描述**：测试/保存按钮 disabled + spinner

#### boundary-null（should）
- **设计描述**：Provider 无描述时灰色占位

---

### Screen: Observability Dashboard (/observability)

#### loading-initial（must）
- **设计描述**：4 指标卡片 + 2 图表 Skeleton

#### empty-first-time（must）
- **设计描述**：无监控数据 + 说明文字
- **文案建议**：还没有监控数据。当 Agent 开始处理任务后，性能指标会自动出现在这里。

#### empty-filter（should）
- **设计描述**：时间范围无数据 + 扩大范围建议

#### error-server（must）
- **设计描述**：指标查询失败 + 重试

#### loading-refresh（should）
- **设计描述**：自动刷新时图标轻微旋转指示

---

### Screen: Agent Topology Graph (/graph)

#### loading-initial（must）
- **设计描述**：画布中央 spinner + '加载 Agent 拓扑数据...'

#### empty-collection（must）
- **设计描述**：无 Agent 注册 + 引导
- **文案建议**：还没有注册的 Agent。在对话页面创建 Agent 后，拓扑关系会显示在这里。

#### error-server（must）
- **设计描述**：拓扑数据加载失败 + 重试

#### boundary-overflow（should）
- **设计描述**：Agent > 100 时自动缩放 + 搜索提示

---

### Screen: Settings (/settings)

#### loading-initial（must）
- **设计描述**：表单 5 行字段 Skeleton

#### error-permission（must）
- **设计描述**：非管理员灰色遮罩 + 锁图标
- **文案建议**：仅团队管理员可修改此设置

#### error-validation（must）
- **设计描述**：设置值不合法红色边框 + inline 提示

#### loading-submit（must）
- **设计描述**：保存按钮 disabled + spinner

#### error-server（must）
- **设计描述**：保存失败 toast + 重试

---

### Screen: Global (All Pages)

#### permission-anonymous（must）⭐ CRITICAL
- **设计描述**：未登录重定向 /login?redirect=/原路径，登录后自动回跳
- **关联 Story**：story-5

#### permission-not-authorized（must）
- **设计描述**：已登录但权限不足，ShieldOff 卡片 + 返回工作台

#### error-not-found（must）⭐ CRITICAL
- **设计描述**：404 页面 + '返回工作台'

#### error-server（must）
- **设计描述**：全局 Error Boundary 触发，全屏错误页 + 刷新

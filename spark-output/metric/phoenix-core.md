# Metric Blueprint — Phoenix-Core 多端适配改版

- **生成时间**：2026-06-30T23:00:00+08:00
- **数据工具**：自建埋点（Next.js + PostHog / 或 console.log 降级）
- **现有埋点覆盖**：partial（SSE 事件流 + API 日志，无前端结构化埋点）
- **复盘节奏**：weekly（v1 上线后头 2 周 daily）
- **Owner**：前端工程师 + PM 共同

---

## North Star Metric

**移动端核心页面可用率** = 在 375-768px 视口下成功完成至少 1 项核心操作（发送消息/切换群组/查看任务状态）的 session / 移动端总 session

- **目标**：≥ 80%
- **时间窗**：上线后 30 天达成
- **业务对齐**：直接对应 brief.business_goal[0]「核心页面移动端可用率 > 80%」+ PRD Section 4 首要成功度量
- **为什么是这个**：本次改版的核心赌注是"移动端可用性"。可用率是最直接衡量"陈昊能在手机上用系统"的行为指标——比 PV 好（消除无效访问噪音），比留存好（领先指标，首次体验就能测），比满意度好（行为而非态度）。如果可用率 < 60%，视为方向错误，需重新评估响应式策略。

---

## Driver Metrics（4 个）

### Driver 1：首次 Agent 交互完成时间中位数

- **推动 NSM**：首次交互时间 > 5 分钟时用户放弃率显著上升，直接降低移动端可用率（新用户第一次失败就不会再来）
- **公式**：`median(first_agent_message_sent.timestamp - login_success.timestamp)` 仅统计首次登录用户
- **目标**：≤ 5 分钟
- **时间窗**：上线后 60 天验证
- **切片**：`first_time vs returning` × `mobile vs tablet vs desktop` × `来源（direct / referral / search）`
- **需要事件**：`login_success`、`im_page_loaded`、`first_message_sent`、`first_agent_response_received`
- **埋点状态**：❌ missing
- **关联 Story**：story-1（移动端 IM）、story-5（首次使用引导）
- **关联策略维度**：多端适配 + 首次使用引导

### Driver 2：Blocker 级问题修复完成率

- **推动 NSM**：7 个 Blocker（无响应式/无引导/无撤销/无确认/无重连/无错误反馈/无焦点环）不修复，移动端根本不可用，可用率为 0%
- **公式**：`已修复 Blocker 数 / 总 Blocker 数（7）` × 100%
- **目标**：100%（7/7）
- **时间窗**：上线前 30 天内完成
- **切片**：`by_audit_finding_id`（追踪每个具体 finding 的修复状态）
- **需要事件**：工程侧追踪（GitHub issue / PR linked to audit finding ID）
- **埋点状态**：⚠️ partial（GitHub issue tracking 有，但无自动关联到 audit finding ID）
- **关联 Story**：story-1/2/3/4/6（覆盖所有 Blocker 修复）
- **关联策略维度**：高优先级 Blocker 修复

### Driver 3：统一 Toast 覆盖率

- **推动 NSM**：5 种错误模式（alert/console.error/inline/空 catch/原生 toast）混杂导致用户在移动端遇到错误时无法理解或操作，降低可用率
- **公式**：`使用统一 Toast 组件的 catch 块数 / 全部 catch 块数` × 100%
- **目标**：100%
- **时间窗**：上线后 60 天
- **切片**：`by_page`（IM/Workflow/Pipeline/Skills/Models/Settings）× `by_error_type`（network/validation/server/permission）
- **需要事件**：`toast_displayed`（含 variant: success/error/warning/info + page_id + error_type）
- **埋点状态**：❌ missing
- **关联 Story**：story-6（统一错误反馈）
- **关联策略维度**：错误反馈标准化

### Driver 4：触摸目标合规率

- **推动 NSM**：触摸目标 < 44px 时用户误触率上升，直接降低移动端操作成功率（可用率的分母）
- **公式**：`移动端可交互元素中 ≥ 44px 的数量 / 移动端可交互元素总数` × 100%
- **目标**：≥ 95%
- **时间窗**：上线后 30 天
- **切片**：`by_page` × `by_component_type`（button/link/input/icon/tab）× `by_breakpoint`（mobile/tablet）
- **需要事件**：`touch_target_audit`（自动化测试脚本定期跑，非用户行为埋点）
- **埋点状态**：❌ missing（需编写自动化审计脚本）
- **关联 Story**：story-1/2/3（所有涉及移动端交互的 Story）
- **关联策略维度**：多端适配

---

## Counter Metrics（4 个）

### Counter 1：桌面端任务完成率

- **防止什么**：为移动端简化界面而砍掉桌面端高级功能（拓扑可视化、TaskMonitor 多 section），导致桌面端用户体验降级
- **公式**：`桌面端成功完成 Agent 交互的 session / 桌面端总 session`
- **阈值**：≥ 改版前基线（不可下降超过 5%）
- **关联 PRD Anti-metric**：PRD Section 4 已声明"不优化桌面端信息密度"

### Counter 2：引导跳过率

- **防止什么**：为拉首次交互完成率，用强制引导（不可跳过的 modal）逼迫用户完成 onboarding，破坏"可控"体验承诺
- **公式**：`点击跳过的 session / 触发引导的 session` × 100%
- **阈值**：跳过率 ≤ 60%（若 > 60% 说明引导本身有问题，而非用户不需要）
- **关联 Story**：story-5（首次使用引导）

### Counter 3：SSE 连接中断频率

- **防止什么**：响应式改造过程中引入新的前端逻辑导致 SSE 连接不稳定（移动端抽屉开关、组件重新挂载时 EventSource 被意外关闭）
- **公式**：`SSE 非预期断开次数 / 总 SSE session 数`
- **阈值**：≤ 改版前基线（不可上升）
- **关联 Story**：story-1/2（侧栏抽屉交互可能影响 SSE 生命周期）

### Counter 4：首屏加载时长 P95

- **防止什么**：响应式布局引入额外的 CSS/JS（media query、framer-motion 动画、useMediaQuery hook），导致首屏性能退化
- **公式**：`P95(first_contentful_paint)` across all breakpoints
- **阈值**：≤ 3 秒（mobile 4G 网络）
- **关联**：PRD 技术约束"Next.js 16 + framer-motion 11 延续"

---

## Health Metrics

| 指标 | 保护什么 | 阈值 | 告警条件 |
| --- | --- | --- | --- |
| JS 错误率 | 整体稳定性 | ≤ 0.5% session | 单日新增未处理错误 > 10 个 |
| API 请求失败率 | 后端可达性 | ≤ 2% | 连续 1 小时 > 5% |
| SSE 重连成功率 | 实时数据可用性 | ≥ 95% | 重连成功率 < 80% 持续 5 分钟 |
| 触摸事件响应延迟 | 移动端交互流畅度 | ≤ 100ms | P95 > 300ms |
| 构建成功率 | 工程健康 | 100%（CI 绿） | 连续 2 次构建失败 |

---

## 埋点缺口清单（给工程师）

### 🔴 Must（NSM / Driver / Health 必须）

| # | 事件名 | 触发时机 | 位置 | 关键字段 | 关联指标 |
| --- | --- | --- | --- | --- | --- |
| 1 | `login_success` | OAuth 回调成功 | `app/login/page.tsx` | user_id, is_first_login, source | NSM, Driver 1 |
| 2 | `im_page_loaded` | IM 页面首屏渲染完成 | `app/im/page.tsx` useEffect | viewport_width, breakpoint, load_time_ms | NSM, Driver 1, Counter 4 |
| 3 | `first_message_sent` | 用户首次发送消息 | `app/im/page.tsx` onSend | group_id, has_skill_attachment, message_length | Driver 1 |
| 4 | `agent_response_received` | 收到首个 Agent 回复 | SSE onmessage handler | response_time_ms, agent_role, has_tool_call | Driver 1 |
| 5 | `toast_displayed` | Toast 弹出 | 全局 Toast 组件 onEnter | variant, page_id, error_type, is_retryable | Driver 3, Health |
| 6 | `toast_retry_clicked` | 用户点击 Toast 重试 | 全局 Toast 组件 retry onClick | toast_id, error_type, retry_count | Driver 3 |
| 7 | `sse_disconnected` | SSE 连接断开 | EventSource onerror | page_id, duration_connected_ms, reason | Counter 3, Health |
| 8 | `sse_reconnected` | SSE 重连成功 | EventSource onopen (重连后) | page_id, reconnect_attempts, reconnect_time_ms | Health |
| 9 | `drawer_opened` | 侧栏抽屉展开 | Drawer 组件 onOpen | breakpoint, trigger_type (hamburger/swipe) | NSM |
| 10 | `drawer_closed` | 侧栏抽屉关闭 | Drawer 组件 onClose | breakpoint, close_trigger (backdrop/item_click/swipe) | NSM |
| 11 | `bottom_sheet_opened` | 底部 Sheet 弹出 | BottomSheet 组件 onOpen | breakpoint, content_type (tasks/node_config) | NSM |
| 12 | `undo_performed` | 用户执行撤销 | Zustand temporal middleware subscribe | action_type, steps_undone, node_type | story-4 验证 |
| 13 | `onboarding_tour_started` | 引导开始 | Tour 组件 onInit | user_id, is_replay | story-5 验证 |
| 14 | `onboarding_tour_completed` | 引导完成 | Tour 组件 onComplete | user_id, steps_completed, duration_ms | Counter 2, story-5 |
| 15 | `onboarding_tour_skipped` | 引导跳过 | Tour 组件 onSkip | user_id, skipped_at_step, duration_ms | Counter 2 |

### 🟠 Should（Counter 需要）

| # | 事件名 | 触发时机 | 位置 | 关联指标 |
| --- | --- | --- | --- | --- |
| 16 | `breakpoint_switched` | 视口跨断点切换 | useBreakpoint hook | Counter 3（检测 SSE 是否因切换断开） |
| 17 | `workflow_node_deleted` | 节点被删除 | WorkflowCanvas onDelete | undo 使用率分析 |
| 18 | `workflow_saved` | Workflow 保存 | workflow/page.tsx onSave | 保存成功率 |
| 19 | `skill_installed` | Skill 安装 | skills/page.tsx onInstall | 功能采用率 |
| 20 | `model_tested` | 模型连通性测试 | models/page.tsx onTest | 配置成功率 |

### 🟡 Nice-to-have

| # | 事件名 | 触发时机 | 关联指标 |
| --- | --- | --- | --- |
| 21 | `chat_message_scrolled` | 聊天区滚动 | 信息消费深度 |
| 22 | `viz_interaction` | 拓扑图交互 | 可视化使用率 |
| 23 | `keyboard_shortcut_used` | 快捷键使用 | 效率分析 |
| 24 | `settings_changed` | 设置修改 | 功能偏好 |

---

## Dashboard 建议

**首屏（6 个核心数字）**：
- 🌟 移动端可用率（NSM）
- 🚀 首次交互时间中位数（Driver 1）
- 🚀 Blocker 修复进度 7/N（Driver 2）
- 🚀 Toast 覆盖率 %（Driver 3）
- ⚠️ 桌面端任务完成率（Counter 1）
- 💊 SSE 重连成功率（Health）

**钻取维度**：
- 视口分群（mobile < 768px / tablet 768-1023px / desktop ≥ 1024px）
- 用户类型（first_time / returning）
- 页面（IM / Workflow / Pipeline / Skills / Models / Settings）
- 时间（按周趋势 + 上线前后对比）

**复盘节奏**：v1 上线后头 2 周 daily → 稳定后 weekly
**Owner**：前端工程师负责埋点实施 + PM 负责数据解读与决策

---

## 下一步建议

- **跟工程团队对齐**：把"埋点缺口清单"15 个 must 事件给到前端工程师，确认排期（建议与 Story 6 Toast 组件同步开发）
- **更新 PRD Section 4**：用本 Metric Blueprint 的完整指标体系替代 Brief 简版的 5 条度量
- **Pitch Ask 追加**：上线节奏是否等 15 个 must 埋点齐再上 vs 先上后补（建议先上 MVP + 边跑边补）

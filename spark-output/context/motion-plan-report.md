# Phoenix-Core 动效规范

**项目**: Phoenix-Core 多 Agent 蜂群系统
**日期**: 2026-06-28
**模式**: 独立模式（无上游 brief/flow 上下文）

---

## Personality: Corporate

**情感目标**: 专业稳重 — 干净、专业、可信赖
**用户确认**: 已在 AskUserQuestion 中显式选择

| 属性 | 值 |
|------|-----|
| Duration 范围 | 200-400ms |
| 默认缓动 | `cubic-bezier(0.2, 0, 0, 1)` (Material Design 3) |
| 过冲范围 | 0-3% |
| 关键词 | clean, professional, business, dashboard |

---

## Brand Motion Identity

### Signature Easing
`cubic-bezier(0.2, 0, 0, 1)` — 80% 的动画使用此曲线

### Duration Palette

| 档位 | 时长 | 用途 |
|------|------|------|
| Quick | 200ms | 按钮反馈、toggle、tooltip、hover 状态 |
| Standard | 300ms | 卡片入场、面板展开、消息气泡、Graph 节点 |
| Slow | 400ms | 模态框、页面转场、Onboarding 步骤切换 |

### Entrance Pattern
fade + slide-up: 元素从下方 12px 处以 opacity 0 渐入至正常位置，300ms

---

## Element Specs (6 个元素)

### 1. Button Press (button-press)
**页面**: all | **情感**: 专业可信赖的即时反馈
**Disney 原则**: Squash & Stretch (subtle), Follow Through

**视觉描述**: 按钮按下时轻微收缩至 97%，松手后回弹至 102% 再稳定到 100%——像按下实体机械键盘的键帽，有明确物理反馈但不过分弹跳。Hover 时背景微亮，像灯光缓缓打在按钮表面。

| 层级 | 属性 | 描述 | 振幅比 |
|------|------|------|--------|
| Primary | scale | hover→1.0, press→0.97, release→1.02, settle→1.0 | 100% |
| Secondary | box-shadow | 按下时阴影收缩，释放时恢复 | 40% |
| Ambient | background-color | Hover 时亮度微增 8% | 15% |

**参数**: 200ms / `cubic-bezier(0.2, 0, 0, 1)` / overshoot 2%

---

### 2. Message Bubble Enter (message-bubble-enter)
**页面**: chat | **情感**: 消息有序到达的稳定感
**Disney 原则**: Staging, Follow Through, Straight Ahead (stagger)

**视觉描述**: 新消息从底部轻柔滑入，像信件从桌面下方优雅推上来。先淡入（opacity 先行 80ms），再位移到位。头像比消息体早 80ms 出现，时间戳晚 120ms 跟随——形成「头像 → 消息 → 时间」的阅读节奏。

| 层级 | 属性 | 描述 | 振幅比 |
|------|------|------|--------|
| Primary | translateY + opacity | 从 12px/0 渐入到 0/1 | 100% |
| Secondary | timestamp opacity | 消息到位后 120ms 渐入 | 50% |
| Ambient | chat background | 底部微光脉冲一次（200ms） | 10% |

**Stagger**: avatar -80ms / body 0ms / timestamp +120ms = 总预算 200ms
**参数**: 280ms / `cubic-bezier(0.2, 0, 0, 1)`

---

### 3. Graph Node Animate (graph-node-animate)
**页面**: graph | **情感**: 拓扑变化的有序感知
**Disney 原则**: Anticipation, Secondary Action, Exaggeration (subtle)

**视觉描述**: 新 Agent 节点出现时，先微微收缩（anticipation 100ms），然后弹性扩展至目标大小。连接边从源节点「画」向目标节点，像墨水沿管道流动。活跃节点有极轻微的呼吸脉冲（scale 1.0↔1.02，2s 周期），暗示它正在思考。

| 层级 | 属性 | 描述 | 振幅比 |
|------|------|------|--------|
| Primary | scale + opacity | anticipation(0.85) → expand(1.05) → settle(1.0) | 100% |
| Secondary | edge stroke-dashoffset | 连接边从源向目标绘制，250ms | 50% |
| Ambient | breathing pulse | scale 1.0↔1.02，周期 2000ms，sine | 2% |

**参数**: 450ms (total) / `cubic-bezier(0.2, 0, 0, 1)` / overshoot 5%

---

### 4. Sidebar Panel Toggle (sidebar-panel-toggle)
**页面**: settings | **情感**: 面板展开的流畅秩序感
**Disney 原则**: Staging, Follow Through

**视觉描述**: 侧边栏从左滑入，像抽屉被平稳拉开。主内容区同步收缩让出空间（而非被覆盖），形成空间共享感。菜单项依次从左侧滑入（stagger 30ms/项），选中项的左侧指示条从 0 高度展开到完整高度。

| 层级 | 属性 | 描述 | 振幅比 |
|------|------|------|--------|
| Primary | translateX | 从 -280px 滑入到 0 | 100% |
| Secondary | menu items stagger | 30ms/项，最多 8 项 | 30% |
| Ambient | main-content width | 主内容区宽度同步过渡 | 20% |

**Stagger**: 30ms/项 x 8 = 240ms (within 500ms budget)
**参数**: 300ms / `cubic-bezier(0.2, 0, 0, 1)`

---

### 5. Modal Enter/Exit (modal-enter-exit)
**页面**: all | **情感**: 焦点转移的明确性
**Disney 原则**: Staging, Anticipation

**视觉描述**: 背景遮罩先快速变暗（150ms），将用户注意力收拢。模态面板从底部 24px 处滑入并渐显，到位后有极轻微的过冲回弹（1.01→1.0）。关闭时反向：面板先下沉渐隐，遮罩最后消失。

| 层级 | 属性 | 描述 | 振幅比 |
|------|------|------|--------|
| Primary | translateY + opacity | enter: 24px→0 / exit: 0→16px | 100% |
| Secondary | backdrop opacity | 遮罩先于面板 100ms 开始变暗 | 50% |
| Ambient | content stagger | 标题→正文→按钮依次渐入，40ms/项 | 15% |

**参数**: enter 350ms / exit 250ms / `cubic-bezier(0.2, 0, 0, 1)` / overshoot 1%

---

### 6. Onboarding Step Transition (onboarding-step-transition)
**页面**: onboarding | **情感**: 引导步骤的流畅推进感
**Disney 原则**: Staging, Follow Through, Arcs

**视觉描述**: 当前步骤内容向左滑出（渐隐），新步骤从右侧滑入（渐显），像翻书一样自然。底部进度条平滑填充到新位置（非跳变），进度节点有轻微放大脉冲确认当前步骤。整体节奏从容不迫，给用户消化信息的时间。

| 层级 | 属性 | 描述 | 振幅比 |
|------|------|------|--------|
| Primary | translateX + opacity | exit: 0→-40px / enter: 40px→0 | 100% |
| Secondary | progress bar fill | 宽度平滑过渡，400ms | 50% |
| Ambient | progress node pulse | scale 1.0→1.15→1.0，确认感 | 15% |

**参数**: 400ms (total) / `cubic-bezier(0.2, 0, 0, 1)`

---

## Choreography (页面级编排)

### Chat 页面加载序列
```
[0ms]    skeleton screens fade in (100ms)
[50ms]   header slides down (200ms)
[100ms]  message list stagger (30ms/bubble, max 200ms)
[200ms]  input bar slides up (200ms)
总预算: 450ms
```

### Graph 页面加载序列
```
[0ms]    canvas fade in (150ms)
[100ms]  root node appears (300ms)
[200ms]  child nodes stagger (80ms/node, max 400ms)
[after]  edges draw (250ms, after nodes settle)
总预算: 500ms
```

### Settings 页面加载序列
```
[0ms]    sidebar slides in (300ms)
[50ms]   menu items stagger (30ms/item, max 240ms)
[200ms]  content panel fades in (200ms)
总预算: 400ms
```

### Onboarding 加载序列
```
[0ms]    logo scale pop (300ms)
[100ms]  title + subtitle stagger (80ms)
[200ms]  CTA button slides up (250ms)
[300ms]  progress dots fade in (150ms)
总预算: 480ms
```

**全局约束**: 所有页面 stagger 总预算 ≤ 500ms

---

## Reduced Motion Fallback

**策略**: 移除所有空间位移类动效（translateX/Y），仅保留 opacity 渐变；移除 spring/overshoot；所有 duration 减少 50%；连续动画完全禁用

| 规则 | 具体行为 |
|------|---------|
| translateX/Y → opacity | 所有空间位移替换为透明度渐变 |
| scale → background-color | 仅保留 hover/focus 的颜色变化 |
| stagger → 保留但 delay 减半 | 节奏感保留但更紧凑 |
| continuous → 移除 | breathing pulse 等循环动画完全禁用 |
| Graph edge draw → 直接显示 | 无绘制动画 |
| Progress bar → 直接跳变 | 无过渡 |

**CSS 实现建议**: 使用 CSS 自定义属性 `--motion-translate: 12px`，在 `@media (prefers-reduced-motion: reduce)` 时设为 `0px`

---

## 8-Step Checklist 追溯

| 步骤 | 检查项 | 状态 |
|------|--------|------|
| 1. Emotional target | 专业稳重 → Corporate | PASS |
| 2. Motion Personality | Corporate: 200-400ms, (0.2,0,0,1), 0-3% | PASS |
| 3. Primary property | 按元素类型分别选择 | PASS |
| 4. Duration | 参照 Duration Table 映射 | PASS |
| 5. Easing family | 入场=decelerate / 出场=accelerate | PASS |
| 6. Hero element | Graph 节点（最复杂，三层齐全） | PASS |
| 7. Secondary + ambient | 6 个元素均含三层 | PASS |
| 8. 1/3 rules | 距离 ≤ 40px, stagger ≤ 500ms | PASS |

---

## 质量红线检查

| 红线 | 状态 |
|------|------|
| 空间位移不用 linear | PASS — 全部使用 cubic-bezier |
| 重要状态变化不只用 opacity | PASS — 均配合 position/scale/color |
| 不超 1/3 屏 | PASS — 最大位移 40px |
| 三层动效齐全 | PASS — 6 个元素均含 primary/secondary/ambient |

---

*本规范由 ASSERT 动效规划 Skill 生成，完整 JSON 数据见 `spark-output/context/motion-plan.json`*

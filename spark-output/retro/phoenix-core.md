# Retro — Phoenix-Core

- **生成时间**：2026-06-30T23:30:00+08:00
- **项目周期**：2026-06-01 → 2026-06-30（计划 8 周 vs 实际 4 周设计阶段，尚未进入工程交付）
- **复盘类型**：设计过程复盘（项目未上线，无实际度量数据）
- **团队规模**：2-3 人
- **关键发现**：设计链路 14 Skill 全部跑完，产出 104 findings + 78 edge states + 82 design tokens，但 **零实现、零测试、零验证** —— 全部决策停留在纸面

---

## 📊 Project Summary

Phoenix-Core 是一个已完成 4 阶段商业化（TSC 0, 570 tests, 81% coverage）的多 Agent 协作系统前端。本项目目标是在 8 周内完成"全局响应式降级 + 7 个 Blocker 修复"的设计规划，将移动端可用率从 0% 提升至 80%。

实际执行情况：设计链路在 4 周内跑完了全部 14 个 Skill（audit → check → motion-plan → motion-apply → brief → journey → stories → sitemap → flow-web → edge → prd → pitch → metric → extract），产出了完整的设计规划体系。但截至复盘时点，**没有任何设计产物被工程实现**，没有进行可用性测试，没有收集用户反馈。

这意味着本 Retro 只能做"设计决策复盘"——评估规划质量、链路完整性、假设合理性——无法做"效果复盘"。

**计划 vs 实际**：

| 维度 | 计划 | 实际 | Delta |
|------|------|------|-------|
| 总工期 | 8 周 | 4 周（设计阶段） | 设计阶段提前，工程未启动 |
| Blocker 修复 | 7/7 | 0/7 | 全部未启动 |
| 移动端可用率 | ≥80% | 0%（未实现） | N/A |
| 埋点覆盖 | 24 events | 0 events | 全部缺失 |
| 设计产物 | 14 Skill 输出 | 14/14 完成 | ✅ 达标 |

---

## ⚖️ Decision Validation（7 个关键决策的事后判断）

> 注：项目未上线，verdict 基于"决策逻辑是否自洽 + 已知约束是否被充分考虑"而非实际效果。

### ✅ Validated

| # | 决策 | 来源 | 判断依据 | Lesson |
|---|------|------|----------|--------|
| 1 | **押响应式 Web 而非原生 App** | pitch.direction | 8 周工期 + 2-3 人团队，原生 App 维护成本翻倍是客观约束；响应式 Web 可在不改变后端的前提下独立交付 | 小团队短工期下"减法决策"比"加法决策"正确率高。这个选择逻辑自洽 |
| 2 | **三层断点策略（mobile < 768 / tablet 768-1023 / desktop ≥ 1024）** | flow-web.breakpoints | 与 CSS 变量体系（--bp-sm/md/lg/xl）完全对齐；flow-web 4 屏原型覆盖完整 | 断点选择与已有设计 token 体系一致，减少工程侧映射成本 |
| 3 | **基础设施优先：统一 Toast → 再做页面级改动** | pitch.decisions[4] | Story 6（Toast）排在 MVP Release 第一位；5 种错误反馈模式跨 6 个页面，先修基础设施避免重复返工 | 基础设施先行的排序逻辑在 PRD 中有 Given/When/Then 验收支撑 |

### ⚠️ Partially Validated

| # | 决策 | 来源 | 判断依据 | Lesson |
|---|------|------|----------|--------|
| 4 | **Workflow 移动端只做只读，编辑延后到 Phase 2** | pitch.decisions[5] | Canvas 780px 最小宽度是硬约束，只读方案合理。但 pitch 没有给出 Phase 2 的时间承诺，"延后"可能变成"永远不做" | 任何"延后"决策都应绑定 Phase 2 的最晚启动时间，否则就是隐性取消 |
| 5 | **Zustand temporal middleware 做 undo/redo** | pitch.decisions[3] | 技术选型正确（Zustand + Immer 原生支持），但 audit-3 的核心问题是"delete 不可逆"——undo 是补救措施，**确认弹窗（audit-4）才是根因修复**。决策优先做了补救而非预防 | 先修预防（确认弹窗）再修补救（undo），成本更低、效果更直接 |
| 6 | **8 周工期 + 渐进式翻新** | pitch.asks[4] | 设计阶段 4 周完成（提前），但工程阶段完全未启动。8 周工期本身已被 pitch 标注"可能延长到 10-12 周"，实际风险已被识别但未被缓解 | 识别了风险但没有 mitigation plan = 风险没有真正被处理 |

### ❌ Refuted

| # | 决策 | 来源 | 判断依据 | Lesson |
|---|------|------|----------|--------|
| 7 | **设计产物可直接被工程消费** | chain protocol 隐含假设 | 14 个 Skill 产出了完整的设计规划体系，但截至复盘时点零实现。设计→工程的 handoff 存在断层：PRD 的 Given/When/Then 验收标准没有配套的测试用例，flow-web 的 4 屏原型没有可运行的代码，motion-apply 的 7 个路径中 3 个依赖未创建的页面 | 设计链路的"完成"≠ 工程可交付。需要在 Pitch 之后加一个"工程 Ready Check"步骤，确认每个产物是否真的能被消费 |

### ❓ Inconclusive

| # | 决策 | 来源 | 判断依据 |
|---|------|------|----------|
| — | **移动端是否有真实使用场景** | pitch.critical_assumption | 这是整个项目的核心赌注，但项目未上线，无法验证。metric.json 设计了 NSM（移动端可用率 ≥80%），但 24 个埋点全部缺失意味着即使上线初期也无法度量 |

---

## 🎯 Assumption Validation（3 个关键假设验证）

> 项目未上线，所有假设均为 inconclusive，但可评估"假设定义质量"。

### 假设 1：陈昊真的会在移动端查看和操作 Agent 任务

- **来源**：pitch.critical_assumption + prd.critical_assumption
- **目标度量**：移动端 session 占总 session ≥ 20%（隐含阈值）
- **实际数据**：无（未上线）
- **Verdict**：❓ inconclusive
- **假设质量评估**：假设被正确识别为"最关键假设"并在 pitch + prd 中反复标注，但**没有设计验证实验**（如：先做一个最小 mobile landing page 测流量占比）。识别了风险但没有低成本验证路径 = 只能靠上线后赌结果
- **Next Action**：在全量响应式开发之前，先用 1-2 天做一个 mobile-only prototype 部署到测试环境，邀请 3-5 个目标用户在手机上试用，收集定性反馈

### 假设 2：5 分钟内新用户可完成首次 Agent 交互

- **来源**：brief.business_goals[1] + metric.driver_metrics[1]
- **目标度量**：首次交互中位数 ≤ 5 min（60 天验证窗口）
- **实际数据**：无（onboarding 未实现）
- **Verdict**：❓ inconclusive
- **假设质量评估**：5 分钟目标基于 journey.json Stage 3 的 pain_level=5（最高）推导，逻辑合理。但 journey 的 onboarding 阶段设计（react-joyride 3-4 步引导）是否能真正将 pain 从 5 降到 2 以下，没有原型验证
- **Next Action**：做一个 clickable prototype（Figma / HTML），跑 5 人可用性测试，验证"30 秒进入填写态"的设计标准是否可达

### 假设 3：设计链路产出的 82 个 design tokens 足以覆盖工程实现

- **来源**：extract.json token inventory
- **目标度量**：工程实现时不需要额外发明 color/spacing/radius 值
- **实际数据**：无（未进入工程阶段）
- **Verdict**：❓ inconclusive
- **假设质量评估**：extract 扫描了 globals.css + motion.ts + package.json，token 提取覆盖面完整。但 check.json 指出"4 套不兼容的样式系统共存"（globals.css / Tailwind utility / inline hardcoded hex / inline CSS var），意味着**提取的 82 tokens 可能无法覆盖散落在各处的硬编码值**
- **Next Action**：工程启动前先做一次"硬编码值清查"——用 AST 扫描所有 .tsx 文件中的 hardcoded hex colors 和 inline pixel values，与 extract tokens 做 diff

---

## ✨ What Worked（4 个设计过程中的成功实践）

### 1. 全链 14 Skill 无断裂执行

- **What**：从 audit 到 extract，14 个 Skill 在 4 周内全部跑完，context 传递无断裂（_session-state.json 持续更新，dashboard.html 进度可视化）
- **Why**：chain protocol 的 context/*.json + marker 机制确保了上下游数据不丢失；每个 Skill 的 next_hint 提供了明确的下一步引导
- **Keep Doing**：下个项目的启动阶段也用 chain protocol 跑全链，但在 Pitch 之后加一个"工程 Ready Check" Skill

### 2. Audit + Check 双视角交叉验证

- **What**：audit（启发式走查）发现 48 findings，check（设计自检）发现 56 findings，两者重叠度高但各有独立发现（如 check 独立发现了 F-003 "4 套不兼容样式系统"）
- **Why**：两种方法论互补——audit 偏"用户体验视角"，check 偏"实现质量视角"
- **Keep Doing**：每个改版项目都应跑 audit + check 双视角，不偏废

### 3. Metric 在设计阶段就定义了度量体系

- **What**：metric.json 在项目未上线时就定义了 NSM + 4 Driver + 4 Counter + 5 Health 的完整度量框架，并识别了 24 个埋点缺口
- **Why**：这意味着工程启动时可以按 metric 的 instrumentation gap 清单优先埋点，避免"上线后才发现没埋点"的常见陷阱
- **Keep Doing**：metric 应在 pitch 之后、工程启动之前就跑，确保度量设计先于实现

### 4. Extract 提取了完整的设计语言文档

- **What**：从代码库中提取了 82 色彩 tokens + 7 间距 + 4 圆角 + 3 阴影 + 3 动效 + 4 断点 + 9 层 z-index，输出为 W3C Design Tokens 格式 + 19 段 AI-optimized 设计语言文档
- **Why**：这份文档可以被工程侧直接消费（CSS 变量名 → token 映射），也可以作为新项目的设计基线参考
- **Keep Doing**：extract 应在 brief 之后尽早跑，让所有下游 Skill 都能参考统一的 token 体系

---

## ⚠️ What Didn't（5 个设计过程中的不足）

### 1. 设计→工程断层：产出未被消费

- **What**：14 个 Skill 产出了完整的设计规划体系（PRD / Stories / Flow / Edge / Metric / Extract），但截至复盘时点**零实现**
- **Root Cause**：chain protocol 的终点是 extract（或 retro），没有"工程启动"节点。设计链路跑完后缺少一个明确的 handoff ceremony——谁负责把 PRD 转成 sprint backlog？谁负责把 flow-web 的 4 屏原型转成组件代码？
- **Avoid Next Time**：在 Pitch 之后增加一个"工程 Ready Check"步骤：(1) 每个设计产物标注"工程消费方式" (2) PRD stories 映射到 sprint backlog items (3) flow-web 的 HTML 原型转成可运行组件骨架

### 2. 核心假设未设计验证实验

- **What**：项目最关键假设——"陈昊真的会在移动端操作 Agent 任务"——被正确识别（pitch + prd 反复标注），但**没有低成本验证路径**
- **Root Cause**：chain protocol 中没有"假设验证"Skill。Frame → Brief → Stories 的链路在做"规划"而非"验证"。metric.json 识别了 24 个埋点缺口，但埋点要上线后才能收集数据
- **Avoid Next Time**：在 Brief 之后增加"假设验证 sprint"——对每个 critical_assumption 设计一个 ≤ 2 天的最小验证实验（prototype / 假门测试 / 5 人访谈）

### 3. Motion-Apply 3/7 路径依赖未创建页面

- **What**：motion-apply 的 7 个实施路径中，sidebar panel / modal / onboarding transition 3 个处于 PENDING 状态——因为对应页面/组件根本不存在
- **Root Cause**：motion-plan 在设计动效规格时没有检查"目标元素是否存在"。设计了一个精美的 onboarding 动效规格（Disney 12 原则 + 编舞规则），但 onboarding 页面本身还没创建
- **Avoid Next Time**：motion-plan 应增加一个"目标存在性检查"步骤——对每个动效目标元素，检查对应组件文件是否存在。不存在时标注"需先创建"并调整优先级

### 4. 没有做 QA（设计验收）和 Board（视觉情绪板）

- **What**：chain 中 14 个 Skill 跑了 14 个，但 qa（设计验收）和 board（视觉情绪板）不在已完成列表中
- **Root Cause**：qa 需要"已有实现"才能做还原度核查——项目没实现所以跑不了。board 需要"视觉方向探索"需求——项目已有成熟设计语言（82 tokens），方向明确所以跳过了
- **Avoid Next Time**：board 在有成熟设计体系的项目中可以合理跳过（记录为"deliberate skip"）。qa 必须在工程实现后补跑，不能永远跳过

### 5. 104 findings 没有修复进度追踪

- **What**：audit（48 findings）+ check（56 findings）= 104 个设计/质量问题，但没有任何机制追踪这些 findings 的修复进度
- **Root Cause**：chain protocol 中 findings 以 JSON 格式持久化在 context 里，但没有与 Linear / Jira / GitHub Issues 打通。findings 停留在"设计文档"层面，没有进入"工程 backlog"
- **Avoid Next Time**：audit / check 完成后，应自动将 Blocker + Major findings 导出为 GitHub Issues 或 Linear tickets，让工程侧有明确的修复清单

---

## 💡 Surprises（3 个设计过程中的意外发现）

### 1. 4 套不兼容样式系统共存

- **Surprise**：check.json 发现项目中同时存在 4 套样式系统（globals.css shared classes / Tailwind utility / inline style + hardcoded hex / inline style + CSS var），而项目已经有 82 个设计 tokens
- **Learning**：设计 token 体系（extract 提取的）和实际代码实现之间存在严重的"规范 vs 现实"差距。这意味着工程侧在做响应式改造时，不仅要加 media queries，还要先统一样式系统。**统一样式系统可能是比响应式本身更大的工作量**
- **Next Action**：工程阶段第一步应该是"样式系统统一 sprint"——把所有 hardcoded hex 替换为 CSS 变量引用，消除 Tailwind utility 的不一致使用

### 2. 用户对项目状态的自我评估

- **Surprise**：用户反馈"都没测试过，未发布，不知道是否达到商业标准，功能是否完善，运行是否顺畅"——这暴露了一个根本问题：设计链路跑了 14 个 Skill 但**没有产生任何可运行的产物**
- **Learning**：设计链路解决的是"设计什么"的问题，但用户真正关心的是"这个东西能不能用"。纯设计产出的价值需要通过工程实现来兑现。14 个 Skill 全跑完 ≠ 项目 ready
- **Next Action**：下个项目的 chain protocol 应在 Pitch 之后强制进入"实现 sprint"——至少做一个可运行的 vertical slice，而不是停留在规划层

### 3. IM 页面 1060 行代码的"隐形地雷"

- **Surprise**：stories.json 指出 IM 页面有 1060 行代码，是整个项目最大的重构目标。但 audit / check / flow-web 都没有给出这个文件的具体拆分方案
- **Learning**：设计层面的"IM 三栏响应式"决策，在工程层面意味着对一个 1060 行的巨型文件做组件拆分 + 响应式改造。这是两个独立的高风险操作被合并成了一个 story
- **Next Action**：Story 1（IM 移动端适配）应拆成两步：(1) 先做组件拆分（不涉及响应式）(2) 再做响应式改造。降低单次变更的爆炸半径

---

## 🛠 Skill Usage 评估（14 Skill 全覆盖）

| Skill | 用了 | 价值 | 痛点 | 建议 |
|-------|------|------|------|------|
| **Audit** | ✅ | high | findings 没有自动导出为工程 backlog | 增加 `export_to_issues` 步骤 |
| **Check** | ✅ | high | 与 audit 有较多 findings 重叠 | 增加"去重"步骤，引用 audit findings |
| **Motion-Plan** | ✅ | medium | 规格精美但 3/7 目标不存在 | 增加"目标存在性检查" |
| **Motion-Apply** | ✅ | medium | 3/7 路径 PENDING | 与 motion-plan 联动，仅实施已存在目标 |
| **Brief** | ✅ | high | 设计标准全部定量但无验证路径 | 增加"标准验证实验"字段 |
| **Journey** | ✅ | high | 7 stage 完整，Stage 3 pain=5 准确 | 增加"已有解决方案"列 |
| **Stories** | ✅ | high | Story 1 负载过重（1060 行文件重构+响应式） | 增加"故事复杂度评估"，超限拆分 |
| **Sitemap** | ✅ | medium | IA 结构简单（max depth 1），产出价值一般 | 简单 IA 可用 quick-mode |
| **Flow-Web** | ✅ | high | 4 屏原型质量好，但只是 HTML 不可运行 | 考虑输出可运行的 React 组件骨架 |
| **Edge** | ✅ | high | 78 states + 8 critical_missing 覆盖全面 | 增加"实现优先级"排序 |
| **PRD** | ✅ | high | Given/When/Then 验收标准可直接消费 | 增加"工程消费确认"签字栏 |
| **Pitch** | ✅ | high | 5 Asks 设计好但决策结果未记录 | 增加"决策结果回填"机制 |
| **Metric** | ✅ | high | 24 埋点缺口识别好，但全部未实现 | 增加"埋点 sprint plan"输出 |
| **Extract** | ✅ | high | 82 tokens + W3C 格式 + 19 段文档 | 增加"硬编码值 diff"输出 |
| **Scope** | ❌ | n/a | — | 有 PRD 场景不需要 Scope |
| **Frame** | ❌ | n/a | — | 改版项目从 Audit 入口，合理跳过 |
| **Probe** | ❌ | n/a | — | 没有做用户访谈，是本项目最大盲区之一 |
| **Bench** | ❌ | n/a | — | 没有做竞品拆解，pitch 提到"竞品窗口"但无数据支撑 |
| **Signal** | ❌ | n/a | — | 没有客服工单/反馈数据可分析 |
| **Board** | ❌ | n/a | 已有成熟设计体系 | Deliberate skip，合理 |
| **Flow-Mobile** | ❌ | n/a | — | IM 移动端 flow 由 flow-web 覆盖，边界模糊 |
| **Chart** | ❌ | n/a | — | 无可视化需求 |
| **Avatar** | ❌ | n/a | — | 无头像需求 |
| **Poster** | ❌ | n/a | — | 无营销图需求 |
| **Access** | ❌ | n/a | — | 应在工程实现后补跑 |
| **Test** | ❌ | n/a | — | 项目未上线，无法做可用性测试 |
| **QA** | ❌ | n/a | — | 项目未实现，无法做还原度核查 |
| **Retro** | ✅ | current | — | 本次执行 |

**使用统计**：15/27 Skills used（含 retro），12 skipped。其中 deliberate skips（合理跳过）：Scope, Frame, Chart, Avatar, Poster, Board（6 个）；应跑未跑：Probe（用户研究）, Bench（竞品）, Access（无障碍）（3 个）；时机未到：Test, QA, Signal, Flow-Mobile（4 个）。

---

## 🎯 Recommendations

### 给自己

- **在设计链路之后强制进入"实现验证 sprint"**：下个项目的 Pitch 之后，花 2-3 天做一个最小可运行 slice（一个页面 + 一个交互 + 一个埋点），验证设计产物是否真的能被工程消费。不要等到 14 个 Skill 全跑完才发现"全部停留在纸面"
- **对 1060 行以上的文件做"复杂度预评估"**：Stories 中 Story 1 负载过重是因为没有在 stories 阶段评估目标文件复杂度。下次写 story 前用 `wc -l` 扫一遍目标文件，超过 500 行的自动标记"需拆分"

### 给团队

- **建立"设计→工程 handoff"ceremony**：当前 chain protocol 在设计侧完整，但 handoff 到工程侧时缺少明确的责任转移。建议建立"设计交付评审会"——设计师展示 PRD + Stories + Flow，工程师确认"这些我能直接消费"，不通过则回退修改
- **findings 自动导出为工程 backlog**：audit + check 的 104 findings 应该自动转为 GitHub Issues（Blocker 标 P0，Major 标 P1），让工程侧有明确的修复清单，而不是让 PM 手动从 JSON 里挑

### 给下个项目

- **改版项目必须跑 Probe 或 Signal**：本项目跳过了用户研究（Probe）和反馈分析（Signal），直接凭 Audit + Check 找问题。虽然 findings 数量充足（104 个），但缺少"用户真实声音"——所有 pain points 是设计师推断的，不是用户报告的。下个改版项目至少跑其中一个
- **先验证核心假设再投入全链设计**：本项目的核心赌注（"移动端有真实使用场景"）如果在全链设计之前用一个 mobile prototype + 5 人测试验证，可以避免"方向错了但 14 个 Skill 全白跑"的风险

### 给组织（可选）

- **Pitch Ask 决策结果应归档**：pitch.json 中 5 个 Asks 要求"本周/下周"决策，但没有决策结果回填机制。组织应建立"设计决策案例库"——每个项目的 Pitch Asks + 决策结果 + 事后验证，供其他团队参考
- **设计链路完成 ≠ 项目 Ready**：组织层面应明确"设计链路完成"和"项目可交付"之间的 gap。建议在项目管理流程中增加"设计→工程 Ready Check"节点

---

## Lessons Learned 卡片（一页摘要，可分享）

**核心 lesson 3 条**（最值得带到下个项目的）：

1. **设计链路全跑完 ≠ 项目 ready** —— 14 个 Skill 产出完整规划体系但零实现，设计产物价值需要通过工程交付兑现。下次 Pitch 之后强制进入 2-3 天的"实现验证 sprint"
2. **识别了核心假设但没有验证实验 = 赌博** —— "移动端有使用场景"被正确识别为最关键假设，但没有低成本验证路径。下次 Brief 之后对每个 critical_assumption 设计 ≤ 2 天的最小验证实验
3. **104 findings 没有进入工程 backlog = 0 findings** —— audit + check 发现的问题停留在 JSON 文件里，没有转为 GitHub Issues / Linear tickets。下次 findings 产出后自动导出为工程可追踪的 ticket

**流程改进 2 条**：

1. 在 Pitch 之后、Retro 之前增加"工程 Ready Check"节点——确认每个设计产物是否真的能被消费
2. 在 Brief 之后增加"假设验证 sprint"节点——对 critical_assumption 做低成本验证

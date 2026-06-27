# AgentHound 回归测试操作指南 — Phoenix-Core

## 快速开始

```bash
# 1. 安装依赖
cd F:\swarm-ide
pip install -r tests/requirements.txt

# 2. 确保 Phoenix-Core 服务正在运行
cd backend && bun dev

# 3. 运行冒烟测试（快速验证，约 2 分钟）
python tests/agenthound_runner.py --suite smoke

# 4. 列出所有可用测试用例
python tests/agenthound_runner.py --list --suite all
```

## 首次基线建立

在确认当前版本处于"已知良好"状态后：

```bash
# Step 1: 运行全量测试并录制基线
python tests/agenthound_runner.py --suite all --record-baseline

# Step 2: 人工审核基线
# 检查 evals/results/baselines/ 下每个 JSON 文件，确认输出是否符合预期
ls evals/results/baselines/

# Step 3: 审核通过后提交到 Git
git add evals/results/baselines/
git commit -m "baseline: 首次建立 Agent 行为基线"
git tag baseline-v1.0

# Step 4: 记录基线版本
echo "baseline-v1.0 $(date +%Y-%m-%d)" >> evals/results/baselines/VERSION
```

## 日常回归流程

每次修改 Prompt / Agent 代码 / 工具定义后：

```bash
# Step 1: 冒烟测试（快速验证，< 2 分钟）
python tests/agenthound_runner.py --suite smoke --compare --fail-fast

# Step 2: 冒烟通过后，运行全量回归
python tests/agenthound_runner.py --suite all --compare

# Step 3: 查看报告
cat evals/results/reports/regression-*.md  # 或直接打开文件
```

## 更新基线

当 Agent 行为发生**有意变更**（如重构 Prompt、升级模型）时：

```bash
# 1. 运行测试，确认新行为符合预期
python tests/agenthound_runner.py --suite all

# 2. 人工审核新输出

# 3. 覆盖基线
python tests/agenthound_runner.py --suite all --record-baseline

# 4. 提交
git add evals/results/baselines/
git commit -m "baseline: 更新基线 - [变更原因]"
git tag baseline-v1.1
```

## 环境变量

| 变量名 | 默认值 | 说明 |
|--------|--------|------|
| `PHOENIX_BASE_URL` | `http://localhost:3100` | Phoenix-Core API 地址 |
| `AGENTHOUND_TIMEOUT` | `60000` | 默认超时 (ms) |

## 目录结构

```
swarm-ide/
├── agenthound.yaml                    # AgentHound 配置
├── tests/
│   ├── automated/
│   │   ├── smoke/                     # 冒烟测试 (7 条，critical)
│   │   │   ├── agent-create.yaml      #   Agent 创建与响应
│   │   │   ├── role-resolve.yaml      #   角色解析正确性
│   │   │   ├── message-route.yaml     #   群组消息路由
│   │   │   ├── tool-execution.yaml    #   工具调用执行
│   │   │   ├── multi-agent.yaml       #   多 Agent 协作
│   │   │   ├── workflow-engine.yaml   #   Workflow 引擎
│   │   │   └── llm-provider.yaml      #   LLM 流式响应
│   │   ├── consistency/               # 一致性测试 (4 条，high)
│   │   │   ├── role-behavior.yaml     #   角色行为模板一致性
│   │   │   ├── task-response.yaml     #   同类任务响应一致性
│   │   │   ├── tool-choice.yaml       #   工具选择一致性
│   │   │   └── subagent-pattern.yaml  #   子 Agent 编排模式
│   │   └── boundary/                  # 边界回归 (4 条，medium-high)
│   │       ├── empty-input.yaml       #   空输入容错
│   │       ├── long-input.yaml        #   超长输入容错
│   │       ├── special-chars.yaml     #   Prompt 注入防御
│   │       └── concurrent-agents.yaml #   并发 Agent 稳定性
│   ├── agenthound_runner.py           # 测试运行器
│   └── requirements.txt               # Python 依赖
└── evals/
    └── results/
        ├── baselines/                 # 基线快照
        └── reports/                   # Markdown 测试报告
```

## 添加新测试

在对应套件目录下新建 YAML 文件即可。格式参考已有用例：

```yaml
test_id: smoke-your-test-008
name: 你的测试名
category: smoke  # 或 consistency / boundary
description: |
  测试目的描述

steps:
  - action: create_workspace
    params:
      name: "test-workspace"
    save_as: workspace_id
  # ... 更多步骤

assertions:
  - type: not_empty
    field: response_content
    description: Agent 必须返回非空响应

timeout_ms: 60000
priority: high
tags: [your-tag]
```

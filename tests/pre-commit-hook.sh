#!/bin/bash
# .git/hooks/pre-commit — 对 prompts/ 和 runtime/ 变更自动触发冒烟测试
# 安装方式: cp tests/pre-commit-hook.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

set -e

# 检查是否有 prompt 或 agent runtime 相关变更
CHANGED=$(git diff --cached --name-only)

TRIGGER_PATTERNS=(
  "src/prompts/"
  "src/runtime/agent-runtime.ts"
  "src/runtime/agent-tools.ts"
  "src/runtime/soul.ts"
  "src/runtime/workflow-engine.ts"
  "src/runtime/pipeline-dispatcher.ts"
)

NEED_TEST=false
for pattern in "${TRIGGER_PATTERNS[@]}"; do
  if echo "$CHANGED" | grep -q "^$pattern"; then
    NEED_TEST=true
    break
  fi
done

if [ "$NEED_TEST" = false ]; then
  exit 0
fi

echo "═══════════════════════════════════════"
echo "AgentHound: 检测到 Agent 核心文件变更"
echo "运行冒烟回归测试..."
echo "═══════════════════════════════════════"

# 运行冒烟测试
python tests/agenthound_runner.py --suite smoke --compare --fail-fast
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "═══════════════════════════════════════"
  echo "❌ 冒烟测试失败，阻止提交"
  echo "请检查报告: evals/results/reports/"
  echo "如需强制提交: git commit --no-verify"
  echo "═══════════════════════════════════════"
  exit 1
fi

echo ""
echo "✅ 冒烟测试通过"

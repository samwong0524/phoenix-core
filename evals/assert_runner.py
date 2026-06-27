#!/usr/bin/env python3
"""
ASSERT Evaluation Runner — Phoenix-Core 评测流水线执行器

按 ASSERT 方法论执行完整评测流程：
  1. 加载数据集 (Source)
  2. 批量推理 (Execute)
  3. 自动评分 (Formulate)
  4. 生成报告 (Report)
  5. 更新追踪 (Track)

用法：
  python assert_runner.py                        # 运行完整评测
  python assert_runner.py --dataset golden       # 仅 Golden Set
  python assert_runner.py --dataset edge         # 仅 Edge Set
  python assert_runner.py --dataset adversarial  # 仅 Adversarial Set
  python assert_runner.py --auto-only            # 跳过人工评分
  python assert_runner.py --compare baseline     # 与基线对比

依赖：
  pip install requests pyyaml
"""

import argparse
import json
import os
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

# 确保能 import 同目录模块
sys.path.insert(0, str(Path(__file__).resolve().parent / "scorers"))

try:
    import requests
    import yaml
except ImportError:
    print("[ERROR] 请先安装依赖: pip install requests pyyaml")
    sys.exit(1)

from auto_scorers import ScorerRegistry

# ─── 配置 ──────────────────────────────────────────────────

EVALS_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = EVALS_ROOT.parent
RESULTS_DIR = EVALS_ROOT / "results"
TRACKING_DIR = EVALS_ROOT / "tracking"
HISTORY_FILE = TRACKING_DIR / "history.jsonl"
DASHBOARD_FILE = TRACKING_DIR / "dashboard.md"

DEFAULT_BASE_URL = os.environ.get("PHOENIX_BASE_URL", "http://localhost:3100")
DEFAULT_TIMEOUT = int(os.environ.get("ASSERT_TIMEOUT", "60"))

DATASET_MAP = {
    "golden": [
        EVALS_ROOT / "datasets" / "golden" / "agent-lifecycle.yaml",
        EVALS_ROOT / "datasets" / "golden" / "task-orchestration.yaml",
        EVALS_ROOT / "datasets" / "golden" / "tool-usage.yaml",
    ],
    "edge": [
        EVALS_ROOT / "datasets" / "edge" / "edge-cases.yaml",
    ],
    "adversarial": [
        EVALS_ROOT / "datasets" / "adversarial" / "security.yaml",
    ],
}


# ─── 工具函数 ──────────────────────────────────────────────

def generate_run_id() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def load_dataset(path: Path) -> list[dict]:
    """加载单个数据集文件"""
    if not path.exists():
        print(f"  [WARN] 数据集文件不存在: {path}")
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not data:
        return []
    cases = data.get("cases", [])
    dataset_id = data.get("dataset_id", path.stem)
    for c in cases:
        c["_dataset_id"] = dataset_id
    print(f"  Loaded {len(cases)} cases from {path.name}")
    return cases


def execute_step(session: requests.Session, base_url: str, step: dict, context: dict) -> dict:
    """执行单个测试步骤"""
    action = step.get("action", "")
    params = step.get("params", {})
    save_fields = step.get("save", "")

    # 解析参数中的 {{var}} 引用
    def resolve(val):
        if isinstance(val, str):
            for k, v in context.items():
                val = val.replace("{{" + k + "}}", str(v))
        return val

    resolved_params = {}
    for k, v in params.items():
        if isinstance(v, list):
            resolved_params[k] = [resolve(item) if isinstance(item, str) else item for item in v]
        else:
            resolved_params[k] = resolve(v)

    result = {}
    status_code = 200

    try:
        if action == "create_workspace":
            resp = session.post(f"{base_url}/api/workspaces", json={}, timeout=DEFAULT_TIMEOUT)
            status_code = resp.status_code
            if resp.ok:
                data = resp.json()
                result = {
                    "workspace_id": data.get("workspaceId", ""),
                    "human_agent_id": data.get("humanAgentId", ""),
                    "assistant_agent_id": data.get("assistantAgentId", ""),
                    "default_group_id": data.get("defaultGroupId", ""),
                }

        elif action == "create_agent":
            workspace_id = resolve(params.get("workspace_id", context.get("workspace_id", "")))
            creator_id = resolve(params.get("creator_id", context.get("human_agent_id", "")))
            role = resolved_params.get("role", "worker")
            name = resolved_params.get("name", "Test Agent")
            resp = session.post(
                f"{base_url}/api/agents",
                json={"role": role, "name": name, "creatorId": creator_id},
                params={"workspaceId": workspace_id} if workspace_id else {},
                timeout=DEFAULT_TIMEOUT,
            )
            status_code = resp.status_code
            if resp.ok:
                data = resp.json()
                result = {
                    "agent_id": data.get("id", ""),
                    "group_id": data.get("groupId", ""),
                }

        elif action == "create_group":
            workspace_id = resolve(params.get("workspace_id", context.get("workspace_id", "")))
            member_ids = resolved_params.get("member_ids", [])
            resp = session.post(
                f"{base_url}/api/groups",
                json={"memberIds": member_ids},
                params={"workspaceId": workspace_id} if workspace_id else {},
                timeout=DEFAULT_TIMEOUT,
            )
            status_code = resp.status_code
            if resp.ok:
                data = resp.json()
                result = {"group_id": data.get("id", "")}

        elif action == "send_message":
            group_id = resolve(params.get("group_id", context.get("group_id", "")))
            message = resolved_params.get("message", "")
            workspace_id = context.get("workspace_id", "")
            sender_id = context.get("human_agent_id", "")
            resp = session.post(
                f"{base_url}/api/groups/{group_id}/messages",
                json={"content": message, "senderId": sender_id},
                params={"workspaceId": workspace_id} if workspace_id else {},
                timeout=DEFAULT_TIMEOUT,
            )
            status_code = resp.status_code
            # 等待 Agent 处理
            time.sleep(3)

        elif action == "get_messages":
            group_id = resolve(params.get("group_id", context.get("group_id", "")))
            workspace_id = context.get("workspace_id", "")
            resp = session.get(
                f"{base_url}/api/groups/{group_id}/messages",
                params={"workspaceId": workspace_id} if workspace_id else {},
                timeout=DEFAULT_TIMEOUT,
            )
            status_code = resp.status_code
            if resp.ok:
                data = resp.json()
                messages = data if isinstance(data, list) else data.get("messages", [])
                result = {"messages": messages}

    except requests.exceptions.Timeout:
        status_code = 408
        result = {"error": "timeout"}
    except requests.exceptions.ConnectionError:
        status_code = 503
        result = {"error": "connection_refused"}
    except Exception as e:
        status_code = 500
        result = {"error": str(e)}

    # 保存字段到 context
    if save_fields and result:
        if isinstance(save_fields, str):
            for field in save_fields.split(","):
                field = field.strip()
                if field in result:
                    context[field] = result[field]
        elif isinstance(save_fields, list):
            for field in save_fields:
                if field in result:
                    context[field] = result[field]

    context["status_code"] = status_code
    return result


def run_case(session: requests.Session, base_url: str, case: dict) -> dict:
    """运行单个测试用例"""
    case_id = case.get("id", "unknown")
    context = {}
    outputs = []
    total_latency = 0

    steps = case.get("steps", [])
    for i, step in enumerate(steps):
        start = time.time()
        result = execute_step(session, base_url, step, context)
        elapsed = (time.time() - start) * 1000
        total_latency += elapsed

        if step.get("action") == "get_messages":
            messages = result.get("messages", [])
            # 提取 Agent 响应文本
            agent_msgs = [
                m for m in messages
                if m.get("senderId") != context.get("human_agent_id", "HUMAN")
            ]
            if agent_msgs:
                output = agent_msgs[-1].get("content", "")
            else:
                output = ""
            outputs.append(output)

    context["latency_ms"] = total_latency
    final_output = outputs[-1] if outputs else ""

    return {
        "case_id": case_id,
        "dataset_id": case.get("_dataset_id", ""),
        "output": final_output,
        "context": {k: v for k, v in context.items() if isinstance(v, (str, int, float, bool))},
    }


# ─── 报告生成 ──────────────────────────────────────────────

def generate_report(run_id: str, all_scores: list[dict], summary: dict,
                    dataset_stats: dict, elapsed_total: float) -> str:
    """生成 Markdown 评测报告"""
    now = datetime.now().strftime("%Y-%m-%d %H:%M")

    lines = [
        f"# Phoenix-Core ASSERT 评测报告",
        "",
        f"**评测时间**：{now}",
        f"**Run ID**：{run_id}",
        f"**评测数据集**：Golden {dataset_stats.get('golden', 0)} + "
        f"Edge {dataset_stats.get('edge', 0)} + "
        f"Adversarial {dataset_stats.get('adversarial', 0)} = "
        f"{sum(dataset_stats.values())} 条",
        f"**总耗时**：{elapsed_total:.1f}s",
        "",
        "---",
        "",
        "## 核心指标 (North Star Metrics)",
        "",
        "| 指标 | 本次结果 | 目标 | 达标 |",
        "|------|---------|------|------|",
    ]

    by_metric = summary.get("by_metric", {})

    # 核心指标映射
    north_star = [
        ("response_not_empty", "响应有效率", ">=", "95%"),
        ("keyword_coverage_rate", "关键词覆盖率", ">=", "60%"),
        ("agent_creation_success", "Agent 创建成功率", ">=", "90%"),
    ]

    for metric_key, label, op, target in north_star:
        data = by_metric.get(metric_key, {})
        rate = data.get("pass_rate", 0)
        rate_str = f"{rate:.0%}"
        target_val = float(target.rstrip("%")) / 100
        pass_mark = "Y" if rate >= target_val else "N"
        lines.append(f"| {label} | {rate_str} | {op}{target} | {pass_mark} |")

    lines += [
        "",
        "## 驱动指标 (Driver Metrics)",
        "",
        "| 指标 | 本次结果 | 备注 |",
        "|------|---------|------|",
    ]

    driver_metrics = [
        ("min_response_length", "最小长度达标率"),
        ("group_creation_success", "Group 创建成功率"),
        ("server_error_free", "无服务错误率"),
    ]

    for metric_key, label in driver_metrics:
        data = by_metric.get(metric_key, {})
        rate = data.get("pass_rate", 0)
        total = data.get("total", 0)
        passed = data.get("passed", 0)
        lines.append(f"| {label} | {rate:.0%} | {passed}/{total} |")

    lines += [
        "",
        "## 健康指标 (Health Metrics)",
        "",
        "| 指标 | 本次结果 |",
        "|------|---------|",
    ]

    latency_data = by_metric.get("latency_ms", {})
    avg_latency = latency_data.get("avg_score", 0)
    lines.append(f"| 平均延迟评分 | {avg_latency:.2f} |")
    lines.append(f"| 评测总耗时 | {elapsed_total:.1f}s |")

    lines += [
        "",
        "## 数据集分布分析",
        "",
        "| 数据类型 | 用例数 | 通过率 | 主要发现 |",
        "|---------|--------|--------|---------|",
    ]

    for ds_type in ["golden", "edge", "adversarial"]:
        count = dataset_stats.get(ds_type, 0)
        ds_scores = [s for s in all_scores if ds_type in s.get("dataset_id", "")]
        ds_passed = sum(1 for s in ds_scores if s.get("passed"))
        ds_rate = ds_passed / len(ds_scores) if ds_scores else 0
        lines.append(f"| {ds_type.capitalize()} | {count} | {ds_rate:.0%} | - |")

    lines += [
        "",
        "## 综合评分",
        "",
        f"- **总评分数**：{summary.get('total_scores', 0)}",
        f"- **通过数**：{summary.get('total_passed', 0)}",
        f"- **总通过率**：{summary.get('pass_rate', 0):.0%}",
        f"- **平均得分**：{summary.get('avg_score', 0):.2f}",
        "",
        "## 行动建议",
        "",
        "| 优先级 | 建议 | 关联指标 |",
        "|--------|------|---------|",
    ]

    # 根据指标自动生成建议
    for metric_key, data in by_metric.items():
        if data.get("pass_rate", 1) < 0.8:
            lines.append(f"| P1 | 改进 {metric_key}（当前 {data['pass_rate']:.0%}） | {metric_key} |")

    if not any(d.get("pass_rate", 1) < 0.8 for d in by_metric.values()):
        lines.append("| - | 所有指标达标，无紧急行动项 | - |")

    lines.append("")
    return "\n".join(lines)


# ─── 追踪更新 ──────────────────────────────────────────────

def update_tracking(run_id: str, summary: dict, report_path: str):
    """追加评测记录到历史追踪"""
    TRACKING_DIR.mkdir(parents=True, exist_ok=True)

    entry = {
        "run_id": run_id,
        "timestamp": datetime.now().isoformat(),
        "pass_rate": summary.get("pass_rate", 0),
        "avg_score": summary.get("avg_score", 0),
        "total_scores": summary.get("total_scores", 0),
        "by_metric": summary.get("by_metric", {}),
        "report_path": str(report_path),
    }

    with open(HISTORY_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    # 更新 dashboard
    update_dashboard()


def update_dashboard():
    """更新追踪看板"""
    if not HISTORY_FILE.exists():
        return

    entries = []
    with open(HISTORY_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                entries.append(json.loads(line))

    lines = [
        "# Phoenix-Core 评测追踪看板",
        "",
        f"**最后更新**：{datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"**累计评测次数**：{len(entries)}",
        "",
        "## 历史趋势",
        "",
        "| Run ID | 时间 | 通过率 | 平均分 | 评分数 |",
        "|--------|------|--------|--------|--------|",
    ]

    for entry in entries[-20:]:  # 最近 20 次
        ts = entry.get("timestamp", "")[:16]
        lines.append(
            f"| {entry['run_id']} | {ts} | "
            f"{entry.get('pass_rate', 0):.0%} | "
            f"{entry.get('avg_score', 0):.2f} | "
            f"{entry.get('total_scores', 0)} |"
        )

    lines += [
        "",
        "## 指标趋势",
        "",
    ]

    # 收集所有出现过的 metric
    all_metrics = set()
    for e in entries:
        all_metrics.update(e.get("by_metric", {}).keys())

    if all_metrics:
        header = "| 指标 |"
        separator = "|------|"
        for e in entries[-5:]:
            header += f" {e['run_id'][-5:]} |"
            separator += "------|"
        lines.append(header)
        lines.append(separator)

        for metric in sorted(all_metrics):
            row = f"| {metric} |"
            for e in entries[-5:]:
                val = e.get("by_metric", {}).get(metric, {}).get("pass_rate", 0)
                row += f" {val:.0%} |"
            lines.append(row)

    lines.append("")
    with open(DASHBOARD_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


# ─── 主流程 ────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Phoenix-Core ASSERT 评测流水线")
    parser.add_argument("--dataset", choices=["golden", "edge", "adversarial", "all"],
                        default="all", help="选择评测数据集")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Phoenix-Core API 地址")
    parser.add_argument("--auto-only", action="store_true", help="仅自动评分，跳过人工评分")
    parser.add_argument("--compare", metavar="RUN_ID", help="与指定 run 对比")
    parser.add_argument("--dry-run", action="store_true", help="仅加载数据集，不执行推理")
    args = parser.parse_args()

    run_id = generate_run_id()
    print(f"=" * 60)
    print(f"Phoenix-Core ASSERT Evaluation Runner")
    print(f"Run ID: {run_id}")
    print(f"Base URL: {args.base_url}")
    print(f"Dataset: {args.dataset}")
    print(f"=" * 60)

    # ── Stage 1: 加载数据集 ──
    print("\n[Stage 1] Loading datasets...")
    all_cases = []
    dataset_stats = {}

    if args.dataset == "all":
        datasets_to_load = DATASET_MAP.keys()
    else:
        datasets_to_load = [args.dataset]

    for ds_name in datasets_to_load:
        paths = DATASET_MAP.get(ds_name, [])
        ds_cases = []
        for p in paths:
            ds_cases.extend(load_dataset(p))
        all_cases.extend(ds_cases)
        dataset_stats[ds_name] = len(ds_cases)

    print(f"\nTotal cases loaded: {len(all_cases)}")

    if args.dry_run:
        print("\n[Dry Run] 数据集加载完成，跳过执行。")
        return

    # ── Stage 2: 批量推理 ──
    print(f"\n[Stage 2] Executing {len(all_cases)} test cases...")
    run_dir = RESULTS_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    outputs = []
    start_time = time.time()

    for i, case in enumerate(all_cases):
        case_id = case.get("id", "?")
        print(f"  [{i+1}/{len(all_cases)}] {case_id}...", end=" ")
        try:
            result = run_case(session, args.base_url, case)
            outputs.append(result)
            status = "OK" if result.get("output") else "EMPTY"
            print(status)
        except Exception as e:
            print(f"ERROR: {e}")
            outputs.append({
                "case_id": case_id,
                "dataset_id": case.get("_dataset_id", ""),
                "output": "",
                "context": {"error": str(e)},
            })

    elapsed = time.time() - start_time
    print(f"\nExecution completed in {elapsed:.1f}s")

    # 保存原始输出
    outputs_path = run_dir / "outputs.jsonl"
    with open(outputs_path, "w", encoding="utf-8") as f:
        for o in outputs:
            f.write(json.dumps(o, ensure_ascii=False) + "\n")
    print(f"Outputs saved to {outputs_path}")

    # ── Stage 3: 自动评分 ──
    print(f"\n[Stage 3] Auto-scoring...")
    registry = ScorerRegistry()
    all_scores = []

    for o in outputs:
        case = next((c for c in all_cases if c.get("id") == o["case_id"]), {})
        scores = registry.score_all(case, o.get("output", ""), o.get("context", {}))
        all_scores.extend(scores)

    summary = registry.compute_summary(all_scores)

    # 保存评分结果
    scores_path = run_dir / "auto_scores.jsonl"
    with open(scores_path, "w", encoding="utf-8") as f:
        for s in all_scores:
            f.write(json.dumps(s, ensure_ascii=False) + "\n")
    print(f"Scores saved to {scores_path}")

    # ── Stage 4: 生成报告 ──
    print(f"\n[Stage 4] Generating report...")
    report = generate_report(run_id, all_scores, summary, dataset_stats, elapsed)
    report_path = run_dir / "report.md"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report)
    print(f"Report saved to {report_path}")

    # ── Stage 5: 更新追踪 ──
    print(f"\n[Stage 5] Updating tracking...")
    update_tracking(run_id, summary, str(report_path))
    print(f"Tracking updated.")

    # ── 输出摘要 ──
    print(f"\n{'=' * 60}")
    print(f"EVALUATION COMPLETE")
    print(f"{'=' * 60}")
    print(f"  Total scores:  {summary.get('total_scores', 0)}")
    print(f"  Passed:        {summary.get('total_passed', 0)}")
    print(f"  Pass rate:     {summary.get('pass_rate', 0):.0%}")
    print(f"  Avg score:     {summary.get('avg_score', 0):.2f}")
    print(f"  Report:        {report_path}")
    print(f"  Dashboard:     {DASHBOARD_FILE}")
    print(f"{'=' * 60}")


if __name__ == "__main__":
    main()

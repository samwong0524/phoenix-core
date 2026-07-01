#!/usr/bin/env python3
"""
AgentHound Runner — Phoenix-Core Agent 行为回归测试框架

在 AgentHound 正式安装前，本脚本实现核心回归测试功能：
  1. 解析 YAML 测试用例
  2. 通过 HTTP API 执行测试步骤
  3. 运行断言检查
  4. 基线录制与漂移检测
  5. 生成 Markdown 回归报告

用法：
  python agenthound_runner.py --suite smoke              # 运行冒烟测试
  python agenthound_runner.py --suite all                # 运行全部测试
  python agenthound_runner.py --record-baseline          # 录制基线
  python agenthound_runner.py --suite smoke --compare    # 与基线对比

依赖：
  pip install requests pyyaml
"""

import argparse
import json
import os
import re
import sys
import time
import hashlib
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import requests
import yaml

# ─── 配置 ────────────────────────────────────────────────

DEFAULT_BASE_URL = os.environ.get("PHOENIX_BASE_URL", "http://localhost:3100")
DEFAULT_TIMEOUT = int(os.environ.get("AGENTHOUND_TIMEOUT", "60000"))

PROJECT_ROOT = Path(__file__).resolve().parent.parent  # F:\swarm-ide
TESTS_DIR = PROJECT_ROOT / "tests" / "automated"
BASELINE_DIR = PROJECT_ROOT / "evals" / "results" / "baselines"
REPORT_DIR = PROJECT_ROOT / "evals" / "results" / "reports"

SUITE_PATHS = {
    "smoke": TESTS_DIR / "smoke",
    "consistency": TESTS_DIR / "consistency",
    "boundary": TESTS_DIR / "boundary",
}


# ─── 工具函数 ──────────────────────────────────────────────

def load_test_cases(suite: str) -> list[dict]:
    """加载指定套件的 YAML 测试用例"""
    if suite == "all":
        cases = []
        for s in SUITE_PATHS:
            cases.extend(load_test_cases(s))
        return cases

    path = SUITE_PATHS.get(suite)
    if not path or not path.exists():
        print(f"[WARN] 测试套件目录不存在: {path}")
        return []

    cases = []
    for f in sorted(path.glob("*.yaml")):
        with open(f, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
            if data:
                data["_source_file"] = str(f.relative_to(PROJECT_ROOT))
                cases.append(data)
    return cases


def resolve_var(text: str, context: dict) -> str:
    """将 {{var}} 占位符替换为 context 中的实际值"""
    if not isinstance(text, str):
        return text
    pattern = re.compile(r"\{\{(\w+)\}\}")
    def replacer(match):
        key = match.group(1)
        return str(context.get(key, match.group(0)))
    return pattern.sub(replacer, text)


def resolve_dict(d: dict, context: dict) -> dict:
    """递归解析字典中所有 {{var}} 占位符"""
    result = {}
    for k, v in d.items():
        if isinstance(v, str):
            result[k] = resolve_var(v, context)
        elif isinstance(v, dict):
            result[k] = resolve_dict(v, context)
        elif isinstance(v, list):
            result[k] = [
                resolve_dict(item, context) if isinstance(item, dict)
                else resolve_var(item, context) if isinstance(item, str)
                else item
                for item in v
            ]
        else:
            result[k] = v
    return result


# ─── API 客户端 ────────────────────────────────────────────

class PhoenixClient:
    """Phoenix-Core API 客户端"""

    def __init__(self, base_url: str = DEFAULT_BASE_URL):
        self.base_url = base_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def check_alive(self) -> bool:
        """检查服务是否在线"""
        try:
            r = self.session.get(self._url("/"), timeout=5)
            return r.status_code < 500
        except requests.ConnectionError:
            return False

    def create_workspace(self, name: str) -> dict | None:
        """创建工作区，返回完整信息 {workspaceId, humanAgentId, assistantAgentId, defaultGroupId}"""
        try:
            r = self.session.post(self._url("/api/workspaces"), json={
                "name": name
            }, timeout=10)
            if r.status_code in (200, 201):
                return r.json()
            print(f"  [WARN] create_workspace 返回 {r.status_code}: {r.text[:200]}")
            return None
        except Exception as e:
            print(f"  [ERROR] create_workspace 失败: {e}")
            return None

    def create_agent(self, role: str, name: str, workspace_id: str, creator_id: str = "") -> dict | None:
        """创建 Agent（子 Agent），返回 agent 信息。需要 creatorId（已存在的 Agent ID）"""
        try:
            payload = {
                "role": role,
                "workspaceId": workspace_id,
                "creatorId": creator_id,
            }
            if name:
                payload["name"] = name
            r = self.session.post(self._url("/api/agents"), json=payload, timeout=15)
            if r.status_code in (200, 201):
                return r.json()
            print(f"  [WARN] create_agent 返回 {r.status_code}: {r.text[:200]}")
            return None
        except Exception as e:
            print(f"  [ERROR] create_agent 失败: {e}")
            return None

    def create_group(self, name: str, members: list[str], workspace_id: str) -> dict | None:
        """创建群组"""
        try:
            payload: dict = {
                "memberIds": members,
                "workspaceId": workspace_id,
            }
            if name:
                payload["name"] = name
            r = self.session.post(self._url("/api/groups"), json=payload, timeout=10)
            if r.status_code in (200, 201):
                return r.json()
            print(f"  [WARN] create_group 返回 {r.status_code}: {r.text[:200]}")
            return None
        except Exception as e:
            print(f"  [ERROR] create_group 失败: {e}")
            return None

    def send_message(self, group_id: str, content: str, sender_id: str = "agenthound-tester") -> dict | None:
        """发送消息到群组"""
        try:
            r = self.session.post(self._url(f"/api/groups/{group_id}/messages"), json={
                "senderId": sender_id,
                "content": content,
                "contentType": "text",
            }, timeout=10)
            if r.status_code in (200, 201):
                return r.json()
            print(f"  [WARN] send_message 返回 {r.status_code}: {r.text[:200]}")
            return None
        except Exception as e:
            print(f"  [ERROR] send_message 失败: {e}")
            return None

    def get_agent_events(self, agent_id: str, timeout_ms: int = 30000) -> list[dict]:
        """通过 SSE 收集 Agent 事件流"""
        events = []
        timeout_s = timeout_ms / 1000
        try:
            r = self.session.get(
                self._url(f"/api/agents/{agent_id}/context-stream"),
                stream=True,
                timeout=timeout_s,
            )
            start = time.time()
            for line in r.iter_lines(decode_unicode=True):
                if time.time() - start > timeout_s:
                    break
                if line and line.startswith("data: "):
                    try:
                        ev = json.loads(line[6:])
                        events.append(ev)
                        # 实际格式: {"event": "agent.done", ...}
                        if ev.get("event") in ("agent.done", "llm.done"):
                            break
                    except json.JSONDecodeError:
                        continue
        except Exception as e:
            print(f"  [WARN] SSE 流异常: {e}")
        return events

    def get_messages(self, group_id: str, limit: int = 10) -> list[dict]:
        """获取群组最新消息，返回 messages 列表"""
        try:
            r = self.session.get(
                self._url(f"/api/groups/{group_id}/messages"),
                params={"limit": limit},
                timeout=10,
            )
            if r.status_code == 200:
                data = r.json()
                # API returns {"messages": [...]}
                if isinstance(data, dict) and "messages" in data:
                    return data["messages"]
                if isinstance(data, list):
                    return data
                return []
            return []
        except Exception:
            return []

    def create_workflow(self, workspace_id: str, name: str, tasks: list[dict]) -> dict | None:
        """创建 Workflow"""
        try:
            r = self.session.post(self._url("/api/workflows"), json={
                "workspaceId": workspace_id,
                "name": name,
                "tasks": tasks,
            }, timeout=15)
            if r.status_code in (200, 201):
                return r.json()
            return None
        except Exception as e:
            print(f"  [ERROR] create_workflow 失败: {e}")
            return None

    def activate_workflow(self, workflow_id: str) -> bool:
        """激活 Workflow"""
        try:
            r = self.session.post(self._url(f"/api/workflows/{workflow_id}/activate"), timeout=10)
            return r.status_code in (200, 201, 204)
        except Exception:
            return False

    def list_agents(self, workspace_id: str, meta: bool = True) -> list[dict]:
        """列出工作区内的 Agent"""
        try:
            params = {"workspaceId": workspace_id}
            if meta:
                params["meta"] = "true"
            r = self.session.get(self._url("/api/agents"), params=params, timeout=10)
            if r.status_code == 200:
                data = r.json()
                return data.get("agents", []) if isinstance(data, dict) else data
            return []
        except Exception:
            return []

    def get_agent_details(self, agent_id: str) -> dict | None:
        """获取 Agent 详情（含 role, llmHistory）"""
        try:
            r = self.session.get(self._url(f"/api/agents/{agent_id}"), timeout=10)
            if r.status_code == 200:
                return r.json()
            return None
        except Exception:
            return None

    def get_workflow_executions(self, workflow_id: str) -> dict | None:
        """获取 Workflow 执行详情（含 tasks 状态）"""
        try:
            r = self.session.get(
                self._url(f"/api/workflows/{workflow_id}/executions"),
                timeout=10,
            )
            if r.status_code == 200:
                return r.json()
            return None
        except Exception:
            return None


# ─── 步骤执行器 ────────────────────────────────────────────

class StepExecutor:
    """执行 YAML 中定义的测试步骤"""

    def __init__(self, client: PhoenixClient):
        self.client = client
        self.context: dict[str, Any] = {}
        self.tool_calls_log: list[dict] = []
        self.timing: dict[str, float] = {}
        self.errors: list[str] = []
        self.agent_registry: list[dict] = []  # tracks all created agents with metadata

    def execute(self, steps: list[dict]) -> dict:
        """执行所有步骤，返回收集的结果"""
        for i, step in enumerate(steps):
            action = step.get("action", "")
            params = resolve_dict(step.get("params", {}), self.context)
            save_as = step.get("save_as")
            # Pass through step-level metadata for assertions
            if "assert_role_template" in step:
                params["_assert_role_template"] = step["assert_role_template"]
            step_name = f"step-{i+1}-{action}"

            print(f"  [{step_name}] 执行中...")
            start = time.time()

            try:
                result = self._dispatch(action, params)
                elapsed = time.time() - start
                self.timing[step_name] = elapsed

                if result is not None:
                    if save_as:
                        self.context[save_as] = result
                    print(f"  [{step_name}] 完成 ({elapsed:.2f}s)")
                else:
                    self.errors.append(f"{step_name}: 返回 None")
                    print(f"  [{step_name}] 失败 (返回 None)")

            except Exception as e:
                elapsed = time.time() - start
                self.timing[step_name] = elapsed
                self.errors.append(f"{step_name}: {e}")
                print(f"  [{step_name}] 异常: {e}")

        return {
            "context": self.context,
            "tool_calls": self.tool_calls_log,
            "timing": self.timing,
            "errors": self.errors,
            "agent_registry": self.agent_registry,
        }

    def _dispatch(self, action: str, params: dict) -> Any:
        """分发到具体的 API 调用"""
        if action == "create_workspace":
            result = self.client.create_workspace(params.get("name", "test-ws"))
            if result:
                # 将 workspace 返回的所有字段注入 context
                self.context["workspace_id"] = result.get("workspaceId", "")
                self.context["human_agent_id"] = result.get("humanAgentId", "")
                self.context["assistant_agent_id"] = result.get("assistantAgentId", "")
                self.context["default_group_id"] = result.get("defaultGroupId", "")
                return result.get("workspaceId")
            return None

        elif action == "create_agent":
            # creatorId 可以从 params 显式传入，或自动使用 humanAgentId
            creator_id = params.get("creator_id") or self.context.get("human_agent_id", "")
            role = params.get("role", "worker")
            name = params.get("name", "test-agent")
            ws_id = params.get("workspace_id", "") or self.context.get("workspace_id", "")
            result = self.client.create_agent(
                role=role, name=name, workspace_id=ws_id, creator_id=creator_id,
            )
            if result:
                agent_id = result.get("id") or result.get("agentId")
                self.agent_registry.append({
                    "id": agent_id, "role": role, "name": name,
                    "expected_template": params.get("_assert_role_template"),
                    "workspace_id": ws_id,
                })
                return agent_id
            return None

        elif action == "create_group":
            members = params.get("members", [])
            result = self.client.create_group(
                name=params.get("name", "test-group"),
                members=members,
                workspace_id=params.get("workspace_id", "") or self.context.get("workspace_id", ""),
            )
            if result:
                return result.get("id") or result.get("groupId")
            return None

        elif action == "send_message":
            return self.client.send_message(
                group_id=params.get("group_id", ""),
                content=params.get("content", ""),
                sender_id=params.get("sender_id", "agenthound-tester"),
            )

        elif action == "wait_for_response":
            agent_id = params.get("agent_id", "")
            group_id = params.get("group_id", "") or self.context.get("group_id", "")
            timeout_ms = params.get("timeout_ms", 30000)
            sender_id = params.get("sender_id", "human-tester")
            # Poll group messages for agent response
            timeout_s = timeout_ms / 1000
            start = time.time()
            initial_count = 0
            try:
                r = self.client.get_messages(group_id, limit=100)
                initial_count = len(r.get("messages", [])) if isinstance(r, dict) else len(r)
            except:
                pass
            while time.time() - start < timeout_s:
                time.sleep(2)
                try:
                    msgs = self.client.get_messages(group_id, limit=100)
                    msg_list = msgs.get("messages", []) if isinstance(msgs, dict) else msgs
                    new_msgs = msg_list[initial_count:]
                    for m in new_msgs:
                        if isinstance(m, dict) and m.get("senderId") != sender_id and m.get("senderId") != self.context.get("human_agent_id", ""):
                            return m.get("content", "")
                except:
                    pass
            return None

        elif action == "wait_for_responses":
            agent_ids = params.get("agent_ids", [])
            group_id = params.get("group_id", "") or self.context.get("group_id", "")
            timeout_ms = params.get("timeout_ms", 30000)
            sender_id = params.get("sender_id", "human-tester")
            timeout_s = timeout_ms / 1000
            start = time.time()
            initial_count = 0
            try:
                r = self.client.get_messages(group_id, limit=100)
                initial_count = len(r.get("messages", [])) if isinstance(r, dict) else len(r)
            except:
                pass
            responses = {}
            while time.time() - start < timeout_s:
                time.sleep(2)
                try:
                    msgs = self.client.get_messages(group_id, limit=100)
                    msg_list = msgs.get("messages", []) if isinstance(msgs, dict) else msgs
                    new_msgs = msg_list[initial_count:]
                    for m in new_msgs:
                        if isinstance(m, dict):
                            sid = m.get("senderId", "")
                            if sid != sender_id and sid != self.context.get("human_agent_id", "") and sid not in responses:
                                responses[sid] = m.get("content", "")
                    if len(responses) >= len(agent_ids):
                        break
                except:
                    pass
            return responses

        elif action == "send_multiple_and_collect":
            group_id = params.get("group_id", "")
            messages = params.get("messages", [])
            sender_id = params.get("sender_id", "agenthound-tester")
            timeout_ms = params.get("timeout_ms", 30000)
            responses = []
            for msg in messages:
                self.client.send_message(group_id, msg, sender_id)
                time.sleep(1)  # 短暂等待避免竞态
            # 获取群组消息
            group_msgs = self.client.get_messages(group_id, limit=len(messages) * 3)
            # 过滤掉 tester 的消息
            for m in group_msgs:
                if m.get("senderId") != sender_id:
                    responses.append(m.get("content", ""))
            return responses

        elif action == "create_workflow":
            result = self.client.create_workflow(
                workspace_id=params.get("workspace_id", ""),
                name=params.get("name", "test-wf"),
                tasks=params.get("tasks", []),
            )
            if result:
                return result.get("id") or result.get("workflowId")
            return None

        elif action == "activate_workflow":
            return self.client.activate_workflow(params.get("workflow_id", ""))

        elif action == "generate_long_text":
            count = params.get("char_count", 100000)
            template = params.get("template", "test text {{index}}")
            parts = []
            total = 0
            idx = 0
            while total < count:
                chunk = template.replace("{{index}}", str(idx))
                parts.append(chunk)
                total += len(chunk)
                idx += 1
            return "".join(parts)[:count]

        elif action == "check_stream_integrity":
            agent_id = params.get("agent_id", "")
            events = self.client.get_agent_events(agent_id, timeout_ms=10000)
            error_events = [e for e in events if e.get("event", "").endswith(".error")
                           or "error" in str(e.get("data", "")).lower()]
            return {
                "has_errors": len(error_events) > 0,
                "error_count": len(error_events),
                "total_events": len(events),
                "error_details": error_events,
            }

        elif action == "check_sub_agents":
            workspace_id = params.get("workspace_id", "") or self.context.get("workspace_id", "")
            min_count = params.get("min_count", 1)
            agents = self.client.list_agents(workspace_id, meta=True)
            # Sub-agents are those with a parentId (created by another agent)
            sub_agents = [a for a in agents if a.get("parentId")]
            return {
                "count": len(sub_agents),
                "min_count": min_count,
                "agents": sub_agents,
                "workspace_id": workspace_id,
            }

        elif action == "wait_for_workflow_progress":
            workflow_id = params.get("workflow_id", "")
            timeout_ms = params.get("timeout_ms", 90000)
            timeout_s = timeout_ms / 1000
            start = time.time()
            last_state = None
            while time.time() - start < timeout_s:
                exec_info = self.client.get_workflow_executions(workflow_id)
                if exec_info:
                    last_state = exec_info
                    summary = exec_info.get("summary", {})
                    if summary.get("completed", 0) > 0 or summary.get("inProgress", 0) > 0:
                        return last_state
                time.sleep(3)
            return last_state or {"status": "timeout", "workflow_id": workflow_id}

        elif action == "loop_create_and_inspect":
            role = params.get("role", "worker")
            name_prefix = params.get("name_prefix", "agent")
            workspace_id = params.get("workspace_id", "") or self.context.get("workspace_id", "")
            repeat = params.get("repeat", 3)
            inspect_field = params.get("inspect_field", "system_prompt")
            prompts = []
            for i in range(repeat):
                name = f"{name_prefix}-{i}"
                result = self.client.create_agent(role=role, name=name, workspace_id=workspace_id)
                if result:
                    agent_id = result.get("id") or result.get("agentId")
                    details = self.client.get_agent_details(agent_id) if agent_id else None
                    # Extract system prompt from llmHistory JSON
                    prompt_text = ""
                    if details and inspect_field == "system_prompt":
                        try:
                            history = json.loads(details.get("llmHistory", "[]"))
                            for msg in history:
                                if msg.get("role") == "system":
                                    prompt_text = msg.get("content", "")
                                    break
                        except (json.JSONDecodeError, TypeError):
                            pass
                    prompts.append({
                        "agent_id": agent_id, "role": role, "name": name,
                        "prompt": prompt_text, "prompt_length": len(prompt_text),
                    })
                    self.agent_registry.append({
                        "id": agent_id, "role": role, "name": name,
                        "expected_template": None, "workspace_id": workspace_id,
                    })
            return prompts

        elif action == "send_and_check_tools":
            group_id = params.get("group_id", "")
            messages = params.get("messages", [])
            sender_id = params.get("sender_id", "human-tester")
            timeout_ms = params.get("timeout_ms", 45000)
            results = []
            for msg in messages:
                self.client.send_message(group_id, msg, sender_id)
                # Wait for response and check tool usage
                timeout_s = timeout_ms / 1000
                start = time.time()
                response_content = ""
                while time.time() - start < timeout_s:
                    time.sleep(2)
                    msgs = self.client.get_messages(group_id, limit=100)
                    msg_list = msgs if isinstance(msgs, list) else msgs.get("messages", [])
                    for m in msg_list:
                        if isinstance(m, dict) and m.get("senderId") != sender_id:
                            response_content = m.get("content", "")
                            break
                    if response_content:
                        break
                # Detect tool calls from response content (look for tool indicators)
                tools_used = []
                if any(kw in response_content.lower() for kw in ["bash", "terminal", "命令", "执行"]):
                    tools_used.append("bash")
                results.append({
                    "message": msg, "response": response_content,
                    "tools_used": tools_used, "responded": bool(response_content),
                })
            return results

        elif action == "send_each_and_check":
            group_id = params.get("group_id", "")
            messages = params.get("messages", [])
            sender_id = params.get("sender_id", "human-tester")
            results = []
            for msg in messages:
                resp = self.client.send_message(group_id, msg, sender_id)
                has_error = resp is None or (isinstance(resp, dict) and resp.get("error"))
                results.append({
                    "message": msg, "sent": resp is not None,
                    "has_error": has_error,
                })
            return results

        elif action == "send_each_and_collect":
            group_id = params.get("group_id", "")
            messages = params.get("messages", [])
            sender_id = params.get("sender_id", "human-tester")
            timeout_ms = params.get("timeout_ms", 30000)
            responses = []
            for msg in messages:
                self.client.send_message(group_id, msg, sender_id)
                time.sleep(1)
                # Wait briefly for response
                timeout_s = min(timeout_ms / 1000, 15)
                start = time.time()
                response_content = ""
                while time.time() - start < timeout_s:
                    time.sleep(2)
                    msgs = self.client.get_messages(group_id, limit=50)
                    msg_list = msgs if isinstance(msgs, list) else msgs.get("messages", [])
                    for m in msg_list:
                        if isinstance(m, dict) and m.get("senderId") != sender_id:
                            response_content = m.get("content", "")
                            break
                    if response_content:
                        break
                responses.append({
                    "input": msg, "response": response_content,
                    "responded": bool(response_content),
                })
            return responses

        elif action == "send_multiple_and_count_agents":
            group_id = params.get("group_id", "")
            messages = params.get("messages", [])
            sender_id = params.get("sender_id", "human-tester")
            results = []
            for msg in messages:
                self.client.send_message(group_id, msg, sender_id)
                time.sleep(1)
            # Get messages and count unique agent responders
            msgs = self.client.get_messages(group_id, limit=100)
            msg_list = msgs if isinstance(msgs, list) else msgs.get("messages", [])
            unique_agents = set()
            for m in msg_list:
                if isinstance(m, dict) and m.get("senderId") != sender_id:
                    unique_agents.add(m.get("senderId", ""))
            return {
                "agent_count": len(unique_agents),
                "agent_ids": list(unique_agents),
                "messages_sent": len(messages),
            }

        elif action == "create_agents_parallel":
            workspace_id = params.get("workspace_id", "") or self.context.get("workspace_id", "")
            agents_spec = params.get("agents", [])
            created_ids = []
            for spec in agents_spec:
                result = self.client.create_agent(
                    role=spec.get("role", "worker"),
                    name=spec.get("name", "parallel-agent"),
                    workspace_id=workspace_id,
                )
                if result:
                    agent_id = result.get("id") or result.get("agentId")
                    created_ids.append(agent_id)
                    self.agent_registry.append({
                        "id": agent_id, "role": spec.get("role", "worker"),
                        "name": spec.get("name", ""), "expected_template": None,
                        "workspace_id": workspace_id,
                    })
            return created_ids

        else:
            print(f"    [WARN] 未知动作: {action}")
            return None


# ─── 断言引擎 ──────────────────────────────────────────────

class AssertionEngine:
    """根据 YAML 中的 assertions 规则检验执行结果"""

    def __init__(self):
        self.results: list[dict] = []

    def check(self, assertions: list[dict], exec_result: dict) -> list[dict]:
        """运行所有断言，返回每条的结果"""
        context = exec_result.get("context", {})
        errors = exec_result.get("errors", [])
        agent_registry = exec_result.get("agent_registry", [])
        results = []

        for assertion in assertions:
            atype = assertion.get("type", "")
            desc = assertion.get("description", "")
            passed = False
            detail = ""

            try:
                if atype == "not_empty":
                    field = assertion.get("field", "")
                    val = context.get(field) or context.get("response_content", "")
                    passed = bool(val and str(val).strip())
                    detail = f"字段 '{field}' = '{str(val)[:80]}'" if val else "字段为空"

                elif atype == "length":
                    field = assertion.get("field", "")
                    val = str(context.get(field, ""))
                    min_len = assertion.get("min", 0)
                    max_len = assertion.get("max", float("inf"))
                    actual = len(val)
                    passed = min_len <= actual <= max_len
                    detail = f"长度={actual}, 要求 [{min_len}, {max_len}]"

                elif atype == "contains_any":
                    field = assertion.get("field", "")
                    val = str(context.get(field, ""))
                    values = assertion.get("values", [])
                    matched = [v for v in values if v in val]
                    passed = len(matched) > 0
                    detail = f"匹配到: {matched}" if matched else f"未匹配任何: {values}"

                elif atype == "not_contains":
                    field = assertion.get("field", "")
                    val = str(context.get(field, ""))
                    values = assertion.get("values", [])
                    found = [v for v in values if v.lower() in val.lower()]
                    passed = len(found) == 0
                    detail = f"未发现禁止词" if passed else f"发现禁止词: {found}"

                elif atype == "format":
                    field = assertion.get("field", "")
                    val = str(context.get(field, ""))
                    pattern = assertion.get("pattern", "")
                    passed = bool(re.match(pattern, val.strip()))
                    detail = f"正则 {pattern} 匹配: {passed}"

                elif atype == "response_time":
                    max_ms = assertion.get("max_ms", 30000)
                    total_time = sum(exec_result.get("timing", {}).values()) * 1000
                    passed = total_time <= max_ms
                    detail = f"总耗时 {total_time:.0f}ms, 上限 {max_ms}ms"

                elif atype == "no_server_error":
                    passed = not any("500" in str(e) for e in errors)
                    detail = f"错误数: {len(errors)}"

                elif atype == "agent_alive":
                    passed = not any("crash" in str(e).lower() for e in errors)
                    detail = "Agent 存活检查通过" if passed else "检测到崩溃"

                elif atype == "tool_was_called":
                    tool_name = assertion.get("tool_name", "")
                    tools = exec_result.get("tool_calls", [])
                    called = [t.get("name", "") for t in tools]
                    passed = tool_name in called
                    detail = f"已调用工具: {called}"

                elif atype == "all_agents_created":
                    expected_count = assertion.get("expected_count")
                    field = assertion.get("field", "")
                    if field and field in context:
                        # Check from context field (e.g. agent_ids list)
                        val = context[field]
                        if isinstance(val, list):
                            actual = len([v for v in val if v])  # count non-empty
                        elif isinstance(val, dict):
                            actual = val.get("count", len(val))
                        else:
                            actual = 0
                        if expected_count:
                            passed = actual >= expected_count
                            detail = f"创建 {actual}/{expected_count} 个 Agent"
                        else:
                            passed = actual > 0
                            detail = f"创建了 {actual} 个 Agent"
                    else:
                        # Check from agent_registry
                        created = [a for a in agent_registry if a.get("id")]
                        passed = len(created) > 0
                        if expected_count:
                            passed = len(created) >= expected_count
                            detail = f"registry: {len(created)}/{expected_count} 个 Agent"
                        else:
                            detail = f"registry: {len(created)} 个 Agent 已创建"

                elif atype == "all_responded":
                    field = assertion.get("field", "responses")
                    min_agents = assertion.get("min_agents", 1)
                    val = context.get(field, {})
                    if isinstance(val, dict):
                        responded = len([v for v in val.values() if v])
                    elif isinstance(val, list):
                        # List of results with 'responded' key
                        responded = len([v for v in val if isinstance(v, dict) and v.get("responded")])
                    else:
                        responded = 0
                    passed = responded >= min_agents
                    detail = f"{responded} 个 Agent 响应 (要求 >= {min_agents})"

                elif atype == "role_mapping_correct":
                    mismatches = []
                    for entry in agent_registry:
                        expected = entry.get("expected_template")
                        if expected and entry.get("role"):
                            role_lower = entry["role"].lower()
                            # Map role to expected template category
                            role_map = {
                                "coordinator": "coordinator", "产品经理": "coordinator",
                                "reviewer": "reviewer",
                                "specialist": "specialist", "frontend developer": "specialist",
                                "researcher": "researcher",
                                "worker": "worker", "程序员": "specialist",
                            }
                            actual_template = role_map.get(role_lower, "worker")
                            if actual_template != expected:
                                mismatches.append(
                                    f"{entry['name']}: role='{entry['role']}' → "
                                    f"got '{actual_template}', expected '{expected}'"
                                )
                    passed = len(mismatches) == 0
                    detail = "角色映射全部正确" if passed else f"映射不匹配: {mismatches}"

                elif atype == "same_topic":
                    field = assertion.get("field", "responses")
                    val = context.get(field, {})
                    if isinstance(val, list):
                        texts = [str(v.get("response", v)) if isinstance(v, dict) else str(v) for v in val]
                    elif isinstance(val, dict):
                        texts = [str(v) for v in val.values() if v]
                    else:
                        texts = [str(val)]
                    # Check that all responses share common topic keywords
                    if len(texts) >= 2:
                        # Use word overlap as topic similarity proxy
                        word_sets = [set(re.findall(r'\w+', t.lower())) for t in texts if t]
                        if word_sets:
                            common = word_sets[0]
                            for ws in word_sets[1:]:
                                common = common & ws
                            passed = len(common) > 3  # at least 3 common words
                            detail = f"共同词数: {len(common)}, 文本数: {len(texts)}"
                        else:
                            passed = False
                            detail = "无有效文本可比较"
                    else:
                        passed = True
                        detail = "文本不足 2 条，跳过一致性检查"

                elif atype == "same_template_keywords":
                    field = assertion.get("field", "prompts")
                    keywords = assertion.get("keywords", [])
                    val = context.get(field, [])
                    if isinstance(val, list) and val:
                        prompts = [v.get("prompt", "") if isinstance(v, dict) else str(v) for v in val]
                        match_counts = []
                        for prompt in prompts:
                            count = sum(1 for kw in keywords if kw.lower() in prompt.lower())
                            match_counts.append(count)
                        # All prompts should match at least the same minimum number of keywords
                        min_matches = min(match_counts) if match_counts else 0
                        passed = min_matches >= len(keywords) * 0.5  # at least 50% keywords match
                        detail = f"关键词匹配数: {match_counts}, 要求 >= {len(keywords) * 0.5:.0f}"
                    else:
                        passed = False
                        detail = "无 prompt 数据"

                elif atype == "same_tool_chosen":
                    field = assertion.get("field", "tool_calls")
                    expected_tool = assertion.get("expected_tool", "bash")
                    min_match_pct = assertion.get("min_match_pct", 66)
                    val = context.get(field, [])
                    if isinstance(val, list) and val:
                        match_count = 0
                        total = len(val)
                        for item in val:
                            if isinstance(item, dict):
                                tools = item.get("tools_used", [])
                                if expected_tool in tools:
                                    match_count += 1
                            elif isinstance(item, str) and expected_tool in item:
                                match_count += 1
                        pct = (match_count / total * 100) if total else 0
                        passed = pct >= min_match_pct
                        detail = f"工具匹配率: {pct:.0f}% ({match_count}/{total}), 要求 >= {min_match_pct}%"
                    else:
                        passed = False
                        detail = "无工具调用数据"

                elif atype == "prompt_length_consistent":
                    field = assertion.get("field", "prompts")
                    max_variance_pct = assertion.get("max_variance_pct", 10)
                    val = context.get(field, [])
                    if isinstance(val, list) and len(val) >= 2:
                        lengths = [v.get("prompt_length", 0) if isinstance(v, dict) else len(str(v)) for v in val]
                        avg = sum(lengths) / len(lengths) if lengths else 0
                        if avg > 0:
                            max_dev = max(abs(l - avg) / avg * 100 for l in lengths)
                            passed = max_dev <= max_variance_pct
                            detail = f"长度偏差最大 {max_dev:.1f}% (上限 {max_variance_pct}%), 长度: {lengths}"
                        else:
                            passed = False
                            detail = "平均长度为 0"
                    else:
                        passed = True
                        detail = "数据不足 2 条，跳过一致性检查"

                elif atype == "response_length_consistent":
                    field = assertion.get("field", "responses")
                    max_variance_pct = assertion.get("max_variance_pct", 30)
                    val = context.get(field, [])
                    if isinstance(val, list) and len(val) >= 2:
                        lengths = []
                        for v in val:
                            if isinstance(v, dict):
                                lengths.append(len(str(v.get("response", ""))))
                            else:
                                lengths.append(len(str(v)))
                        avg = sum(lengths) / len(lengths) if lengths else 0
                        if avg > 0:
                            max_dev = max(abs(l - avg) / avg * 100 for l in lengths)
                            passed = max_dev <= max_variance_pct
                            detail = f"响应长度偏差最大 {max_dev:.1f}% (上限 {max_variance_pct}%)"
                        else:
                            passed = False
                            detail = "平均长度为 0"
                    elif isinstance(val, dict):
                        lengths = [len(str(v)) for v in val.values() if v]
                        if len(lengths) >= 2:
                            avg = sum(lengths) / len(lengths)
                            max_dev = max(abs(l - avg) / avg * 100 for l in lengths) if avg > 0 else 0
                            passed = max_dev <= max_variance_pct
                            detail = f"响应长度偏差最大 {max_dev:.1f}%"
                        else:
                            passed = True
                            detail = "响应不足 2 条"
                    else:
                        passed = True
                        detail = "无响应数据"

                elif atype == "agent_count_consistent":
                    field = assertion.get("field", "agent_count")
                    val = context.get(field, {})
                    if isinstance(val, dict):
                        actual = val.get("agent_count", 0)
                        expected = assertion.get("expected_count")
                        if expected:
                            passed = actual == expected
                            detail = f"Agent 数: {actual}, 预期: {expected}"
                        else:
                            passed = actual > 0
                            detail = f"Agent 数: {actual}"
                    elif isinstance(val, int):
                        passed = val > 0
                        detail = f"Agent 数: {val}"
                    else:
                        passed = False
                        detail = "无 agent_count 数据"

                elif atype == "sub_agents_created":
                    field = assertion.get("field", "sub_agents")
                    min_count = assertion.get("min_count", 1)
                    val = context.get(field, {})
                    if isinstance(val, dict):
                        count = val.get("count", 0)
                    elif isinstance(val, list):
                        count = len(val)
                    elif isinstance(val, int):
                        count = val
                    else:
                        count = 0
                    passed = count >= min_count
                    detail = f"子 Agent 数: {count}, 要求 >= {min_count}"

                elif atype == "no_stream_errors":
                    field = assertion.get("field", "stream_check")
                    val = context.get(field, {})
                    if isinstance(val, dict):
                        has_errors = val.get("has_errors", False)
                        error_count = val.get("error_count", 0)
                        passed = not has_errors
                        detail = f"流式错误: {error_count} 个"
                    else:
                        # Check exec errors as fallback
                        stream_errors = [e for e in errors if "stream" in str(e).lower() or "sse" in str(e).lower()]
                        passed = len(stream_errors) == 0
                        detail = f"执行错误中的流式错误: {len(stream_errors)} 个"

                elif atype == "no_tool_abuse":
                    field = assertion.get("field", "responses")
                    forbidden_tools = assertion.get("forbidden_tools", [])
                    val = context.get(field, [])
                    if isinstance(val, list):
                        abused = []
                        for item in val:
                            if isinstance(item, dict):
                                response = str(item.get("response", "")).lower()
                                # Check if response indicates forbidden tool usage
                                for tool in forbidden_tools:
                                    if tool.lower() in response and any(
                                        kw in response for kw in
                                        ["rm -rf", "sudo", "curl|bash", "delete", "删除"]
                                    ):
                                        abused.append(f"{tool} in response to: {item.get('input', '')[:50]}")
                        passed = len(abused) == 0
                        detail = "未发现工具滥用" if passed else f"发现: {abused}"
                    else:
                        passed = True
                        detail = "无响应数据可检查"

                elif atype == "workflow_activated":
                    field = assertion.get("field", "workflow_state")
                    val = context.get(field, {})
                    if isinstance(val, dict):
                        status = val.get("status", "")
                        workflow = val.get("workflow", {})
                        if isinstance(workflow, dict):
                            status = workflow.get("status", status)
                        summary = val.get("summary", {})
                        # Activated if we got a valid response with tasks
                        passed = status != "timeout" and (
                            status in ("active", "running", "activated", "")
                            or summary.get("totalTasks", 0) > 0
                            or val.get("status") != "timeout"
                        )
                        detail = f"Workflow 状态: '{status}', tasks: {summary.get('totalTasks', '?')}"
                    else:
                        passed = val is not None and val is not False
                        detail = f"Workflow 返回值: {val}"

                elif atype == "task_started":
                    field = assertion.get("field", "workflow_state")
                    task_name = assertion.get("task_name", "")
                    val = context.get(field, {})
                    if isinstance(val, dict):
                        tasks = val.get("tasks", [])
                        if tasks:
                            target = None
                            for t in tasks:
                                if task_name in t.get("name", "") or task_name in t.get("displayName", ""):
                                    target = t
                                    break
                            if target:
                                t_status = target.get("status", "")
                                passed = t_status in ("in_progress", "completed", "reviewed", "pending")
                                detail = f"任务 '{task_name}' 状态: {t_status}"
                            else:
                                # No specific task found, check if any task started
                                any_started = any(
                                    t.get("status") in ("in_progress", "completed", "reviewed")
                                    for t in tasks
                                )
                                passed = any_started
                                detail = f"未找到任务 '{task_name}', 其他任务状态: {[(t.get('name'), t.get('status')) for t in tasks[:3]]}"
                        else:
                            # No tasks array, check summary
                            summary = val.get("summary", {})
                            passed = summary.get("inProgress", 0) > 0 or summary.get("completed", 0) > 0
                            detail = f"无 tasks 数组, summary: {summary}"
                    else:
                        passed = False
                        detail = "无 workflow 状态数据"

                elif atype == "min_responses_received":
                    field = assertion.get("field", "responses")
                    min_count = assertion.get("min_count", 1)
                    val = context.get(field, {})
                    if isinstance(val, dict):
                        count = len([v for v in val.values() if v])
                    elif isinstance(val, list):
                        count = len([v for v in val if v and (not isinstance(v, dict) or v.get("responded", True))])
                    else:
                        count = 0
                    passed = count >= min_count
                    detail = f"收到 {count} 个响应, 要求 >= {min_count}"

                elif atype == "same_category":
                    # Not currently used in any YAML, but implement for completeness
                    field = assertion.get("field", "")
                    val = context.get(field, [])
                    if isinstance(val, list) and len(val) >= 2:
                        categories = set()
                        for v in val:
                            if isinstance(v, dict):
                                categories.add(v.get("category", ""))
                            else:
                                categories.add(str(v))
                        passed = len(categories) == 1
                        detail = f"类别集合: {categories}"
                    else:
                        passed = True
                        detail = "数据不足"

                else:
                    detail = f"未知断言类型: {atype}"
                    passed = True  # 未知类型不阻断

            except Exception as e:
                passed = False
                detail = f"断言异常: {e}"

            results.append({
                "type": atype,
                "description": desc,
                "passed": passed,
                "detail": detail,
            })

        self.results = results
        return results


# ─── 基线管理 ──────────────────────────────────────────────

class BaselineManager:
    """基线录制与漂移检测"""

    def __init__(self, baseline_dir: Path = BASELINE_DIR):
        self.baseline_dir = baseline_dir
        self.baseline_dir.mkdir(parents=True, exist_ok=True)

    def save_baseline(self, test_id: str, result: dict):
        """保存测试结果作为基线"""
        baseline_file = self.baseline_dir / f"{test_id}.json"
        data = {
            "test_id": test_id,
            "timestamp": datetime.now().isoformat(),
            "response_content": result.get("context", {}).get("response_content", ""),
            "response_hash": self._hash(str(result.get("context", {}))),
            "timing": result.get("timing", {}),
            "tool_calls": result.get("tool_calls", []),
        }
        with open(baseline_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"  [BASELINE] 已保存: {baseline_file.name}")

    def load_baseline(self, test_id: str) -> dict | None:
        """加载已有基线"""
        baseline_file = self.baseline_dir / f"{test_id}.json"
        if baseline_file.exists():
            with open(baseline_file, "r", encoding="utf-8") as f:
                return json.load(f)
        return None

    def compare(self, test_id: str, current: dict, threshold: float = 0.15) -> dict:
        """与基线对比，返回漂移报告"""
        baseline = self.load_baseline(test_id)
        if not baseline:
            return {"has_baseline": False, "drift": None}

        current_content = str(current.get("context", {}).get("response_content", ""))
        baseline_content = baseline.get("response_content", "")

        # 语义相似度（基于 SequenceMatcher，轻量级替代 embedding）
        similarity = SequenceMatcher(None, baseline_content, current_content).ratio()
        drift = 1.0 - similarity

        return {
            "has_baseline": True,
            "drift": drift,
            "similarity": similarity,
            "threshold": threshold,
            "exceeds_threshold": drift > threshold,
            "baseline_hash": baseline.get("response_hash", ""),
            "current_hash": self._hash(current_content),
        }

    @staticmethod
    def _hash(text: str) -> str:
        return hashlib.md5(text.encode()).hexdigest()[:12]


# ─── 报告生成 ──────────────────────────────────────────────

class ReportGenerator:
    """生成 Markdown 格式的回归测试报告"""

    def __init__(self, report_dir: Path = REPORT_DIR):
        self.report_dir = report_dir
        self.report_dir.mkdir(parents=True, exist_ok=True)

    def generate(self, results: list[dict], trigger: str = "manual",
                 baseline_version: str = "N/A") -> Path:
        """生成报告文件"""
        now = datetime.now()
        filename = f"regression-{now.strftime('%Y%m%d-%H%M%S')}.md"
        filepath = self.report_dir / filename

        # 统计
        total = len(results)
        passed = sum(1 for r in results if r["passed"])
        failed = total - passed

        by_suite = {}
        for r in results:
            suite = r.get("category", "unknown")
            by_suite.setdefault(suite, {"total": 0, "passed": 0, "failed": 0})
            by_suite[suite]["total"] += 1
            if r["passed"]:
                by_suite[suite]["passed"] += 1
            else:
                by_suite[suite]["failed"] += 1

        pass_rate = (passed / total * 100) if total else 0

        lines = [
            "# 回归测试报告",
            "",
            f"**时间**：{now.strftime('%Y-%m-%d %H:%M')}",
            f"**触发**：{trigger}",
            f"**基线版本**：{baseline_version}",
            "",
            "## 总览",
            "",
            "| 测试套件 | 总数 | 通过 | 失败 | 跳过 | 通过率 |",
            "|---------|------|------|------|------|--------|",
        ]

        for suite, stats in by_suite.items():
            suite_name = {"smoke": "冒烟测试", "consistency": "一致性测试", "boundary": "边界回归"}.get(suite, suite)
            rate = (stats["passed"] / stats["total"] * 100) if stats["total"] else 0
            lines.append(f"| {suite_name} | {stats['total']} | {stats['passed']} | {stats['failed']} | 0 | {rate:.1f}% |")

        lines.extend([
            f"| **合计** | **{total}** | **{passed}** | **{failed}** | **0** | **{pass_rate:.1f}%** |",
            "",
        ])

        # 失败详情
        failed_results = [r for r in results if not r["passed"]]
        if failed_results:
            lines.extend(["## 失败详情", ""])
            for r in failed_results:
                lines.extend([
                    f"### ❌ {r.get('test_id', 'unknown')}: {r.get('name', '')}",
                    f"- **分类**：{r.get('category', 'unknown')}",
                    f"- **失败断言**：{r.get('failed_assertion', '')}",
                    f"- **描述**：{r.get('assertion_desc', '')}",
                    f"- **详情**：{r.get('detail', '')}",
                    "",
                ])

        # 基线对比
        drift_results = [r for r in results if r.get("drift_info", {}).get("has_baseline")]
        if drift_results:
            lines.extend(["## 基线对比", ""])
            for r in drift_results:
                drift = r["drift_info"]
                icon = "⚠️" if drift["exceeds_threshold"] else "✅"
                lines.append(
                    f"- {icon} **{r['test_id']}**: 相似度 {drift['similarity']:.2%}, "
                    f"漂移 {drift['drift']:.2%} (阈值 {drift['threshold']:.2%})"
                )
            lines.append("")

        # 上线建议
        if failed == 0:
            verdict = "☑ 可上线"
        elif any(r.get("category") == "smoke" and not r["passed"] for r in results):
            verdict = "☑ 修复失败项后复测"
        else:
            verdict = "☑ 需要人工评估"

        lines.extend(["## 上线建议", verdict, ""])

        report_text = "\n".join(lines)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(report_text)

        return filepath


# ─── 主运行器 ──────────────────────────────────────────────

class AgentHoundRunner:
    """主运行器：编排测试加载、执行、断言、基线对比、报告生成"""

    def __init__(self, base_url: str = DEFAULT_BASE_URL,
                 record_baseline: bool = False,
                 compare_baseline: bool = False,
                 drift_threshold: float = 0.15,
                 fail_fast: bool = False):
        self.client = PhoenixClient(base_url)
        self.baseline_mgr = BaselineManager()
        self.report_gen = ReportGenerator()
        self.record_baseline = record_baseline
        self.compare_baseline = compare_baseline
        self.drift_threshold = drift_threshold
        self.fail_fast = fail_fast

    def run(self, suite: str) -> int:
        """运行测试套件，返回退出码 (0=全通过, 1=有失败)"""
        print(f"\n{'='*60}")
        print(f"AgentHound Runner — 套件: {suite}")
        print(f"目标: {self.client.base_url}")
        print(f"{'='*60}\n")

        # 检查服务
        if not self.client.check_alive():
            print("[ERROR] Phoenix-Core 服务不可达，请确保服务正在运行:")
            print(f"  cd backend && bun dev")
            print(f"  或设置 PHOENIX_BASE_URL 环境变量")
            return 2

        print("[OK] 服务在线\n")

        # 加载测试用例
        cases = load_test_cases(suite)
        if not cases:
            print(f"[WARN] 未找到测试用例 (suite={suite})")
            return 0

        print(f"已加载 {len(cases)} 个测试用例\n")

        # 逐个执行
        results = []
        for case in cases:
            test_id = case.get("test_id", "unknown")
            name = case.get("name", "")
            category = case.get("category", "unknown")
            print(f"── [{category}] {test_id}: {name}")

            executor = StepExecutor(self.client)
            steps = case.get("steps", [])
            exec_result = executor.execute(steps)

            # 运行断言
            assertions = case.get("assertions", [])
            assertion_engine = AssertionEngine()
            assertion_results = assertion_engine.check(assertions, exec_result)

            case_passed = all(a["passed"] for a in assertion_results)
            failed_assertions = [a for a in assertion_results if not a["passed"]]

            # 基线管理
            drift_info = {}
            if self.record_baseline and case_passed:
                self.baseline_mgr.save_baseline(test_id, exec_result)
            elif self.compare_baseline:
                drift_info = self.baseline_mgr.compare(
                    test_id, exec_result, self.drift_threshold
                )
                if drift_info.get("exceeds_threshold"):
                    case_passed = False
                    failed_assertions.append({
                        "type": "baseline_drift",
                        "description": f"基线漂移超过阈值 ({drift_info['drift']:.2%} > {drift_info['threshold']:.2%})",
                        "detail": f"相似度: {drift_info['similarity']:.2%}",
                    })

            status = "[PASS]" if case_passed else "[FAIL]"
            print(f"  {status}")
            for fa in failed_assertions:
                print(f"  -> {fa['type']}: {fa['description']}")

            results.append({
                "test_id": test_id,
                "name": name,
                "category": category,
                "passed": case_passed,
                "failed_assertion": failed_assertions[0]["type"] if failed_assertions else "",
                "assertion_desc": failed_assertions[0].get("description", "") if failed_assertions else "",
                "detail": failed_assertions[0].get("detail", "") if failed_assertions else "",
                "drift_info": drift_info,
                "source_file": case.get("_source_file", ""),
            })

            if self.fail_fast and not case_passed and category == "smoke":
                print(f"\n[ABORT] 冒烟测试失败，停止执行 (fail_fast=true)")
                break

            print()

        # 生成报告
        report_path = self.report_gen.generate(results)
        print(f"\n{'='*60}")
        total = len(results)
        passed = sum(1 for r in results if r["passed"])
        print(f"结果: {passed}/{total} 通过 ({passed/total*100:.1f}%)" if total else "无测试结果")
        print(f"报告: {report_path}")
        print(f"{'='*60}\n")

        return 0 if passed == total else 1


# ─── CLI 入口 ──────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="AgentHound Runner — Phoenix-Core Agent 行为回归测试"
    )
    parser.add_argument(
        "--suite", default="smoke",
        choices=["smoke", "consistency", "boundary", "all"],
        help="要运行的测试套件 (默认: smoke)"
    )
    parser.add_argument(
        "--base-url", default=DEFAULT_BASE_URL,
        help=f"Phoenix-Core API 地址 (默认: {DEFAULT_BASE_URL})"
    )
    parser.add_argument(
        "--record-baseline", action="store_true",
        help="将本次运行结果录制为基线"
    )
    parser.add_argument(
        "--compare", action="store_true",
        help="与已有基线对比，检测漂移"
    )
    parser.add_argument(
        "--drift-threshold", type=float, default=0.15,
        help="语义漂移阈值 (默认: 0.15)"
    )
    parser.add_argument(
        "--fail-fast", action="store_true",
        help="冒烟测试失败时立即停止"
    )
    parser.add_argument(
        "--list", action="store_true",
        help="仅列出测试用例，不执行"
    )

    args = parser.parse_args()

    if args.list:
        cases = load_test_cases(args.suite)
        print(f"\n共 {len(cases)} 个测试用例:\n")
        for c in cases:
            print(f"  [{c.get('category', '?')}] {c.get('test_id', '?')}: {c.get('name', '?')}")
            print(f"    文件: {c.get('_source_file', '?')}")
            print(f"    优先级: {c.get('priority', '?')} | 超时: {c.get('timeout_ms', '?')}ms")
            print()
        return 0

    runner = AgentHoundRunner(
        base_url=args.base_url,
        record_baseline=args.record_baseline,
        compare_baseline=args.compare,
        drift_threshold=args.drift_threshold,
        fail_fast=args.fail_fast,
    )
    exit_code = runner.run(args.suite)
    sys.exit(exit_code)


if __name__ == "__main__":
    main()

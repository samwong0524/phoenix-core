---
sidebar_position: 5
---

# Tool System

The tool system provides 25+ built-in tools organized by domain, plus extensibility through MCP servers.

## Tool Organization

Tools are grouped into domains:

| Domain | Tools | Purpose |
|--------|-------|---------|
| **Agent** | `create`, `update_agent`, `delete_agent`, `get_agent_status` | Agent lifecycle management |
| **Skill** | `create_skill`, `update_skill`, `delete_skill`, `get_skill` | Skill management |
| **Message** | `send_group_message`, `get_group_history`, `get_message_detail` | Group communication |
| **Group** | `create_group`, `invite_to_group`, `leave_group`, `delete_group` | Group lifecycle |
| **Execution** | `bash` | Shell command execution |
| **Workflow** | `create_workflow`, `update_task`, `get_workflow_status`, `assign_agent` | Workflow orchestration |
| **Memory** | `memory_add`, `memory_search`, `memory_delete`, `get_decisions` | Memory operations |
| **Backup** | `backup_create`, `backup_list`, `backup_get` | Session backup/restore |
| **MCP** | (dynamic) | Tools loaded from MCP servers |

## Tool Availability Filtering

Tools are dynamically filtered based on runtime context:

| Tool | Requires |
|------|----------|
| `update_task` | Active workflow |
| `get_workflow_status` | Active workflow |
| `assign_agent` | Active workflow + coordinator role |
| `create_workflow` | Coordinator role |
| `delete_group` | Coordinator role |
| `bash` | Shell enabled (`DISABLE_SHELL !== "true"`) |

## Execution Model

1. **Parallel execution** — All tool calls in a single LLM response execute concurrently for I/O throughput
2. **Serial guardrails** — Results are processed sequentially to maintain guardrail integrity
3. **Failure tracking** — Per-tool and per-params tracking with escalating responses

## Adding Tools

Built-in tools are defined in `AGENT_TOOLS_*` arrays using the standard OpenAI function-calling schema. New tools can be added by:

1. Adding a function schema entry
2. Implementing the handler in `executeToolCall`
3. Optionally adding a `TOOL_AVAILABILITY` check

MCP tools are loaded dynamically from external servers and require no code changes.

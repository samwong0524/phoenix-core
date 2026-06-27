---
sidebar_position: 6
---

# MCP Integration

SWARM IDE integrates with the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) to extend agent capabilities with external tools and resources.

## Architecture

MCP servers are managed through a central `McpRegistry`:

```
AgentRunner → getAgentTools()
                → AGENT_TOOLS (built-in, filtered by context)
                → MCP Registry (dynamic, loaded on demand)
```

## Configuration

MCP servers are configured in the `mcp_servers` table or via environment variables. Each server specifies:

- `name` — Unique server identifier
- `url` — Server endpoint (SSE transport)
- `enabled` — Whether to load on startup

## Tool Lifecycle

1. **Registration** — MCP server registers its tool definitions on connect
2. **Loading** — `getAgentTools()` merges MCP tools with built-in tools
3. **Execution** — Tool calls are dispatched to the appropriate MCP server
4. **Caching** — Tool definitions are cached and refreshed on reconnect

## Built-in Tool Names

Certain tool names are reserved for built-in tools and excluded from MCP overrides:

```
self, create, update_agent, delete_agent, get_agent_status,
create_skill, update_skill, delete_skill, get_skill,
send_group_message, get_group_history, get_message_detail,
create_group, invite_to_group, leave_group, delete_group,
bash, update_task, get_workflow_status, assign_agent,
create_workflow, memory_add, memory_search, memory_delete,
get_decisions, backup_create, backup_list, backup_get
```

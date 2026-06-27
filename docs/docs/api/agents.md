---
sidebar_position: 2
---

# Agents API

## List Agents

```http
GET /api/agents
```

Returns all agents in the workspace.

## Get Agent

```http
GET /api/agents/:id
```

Returns a single agent by ID.

## Create Agent

```http
POST /api/agents

{
  "role": "developer",
  "group_id": "uuid-of-group"
}
```

Creates a new agent with the specified role and adds them to the group.

## Update Agent

```http
PATCH /api/agents/:id

{
  "role": "senior-developer"
}
```

## Delete Agent

```http
DELETE /api/agents/:id
```

## Get Agent Status

```http
GET /api/agents/:id/status
```

Returns the agent's current runtime status (running, paused, idle).

---
sidebar_position: 4
---

# Workflows API

## Create Workflow

```http
POST /api/workflows

{
  "group_id": "uuid-of-group",
  "name": "Implement feature X",
  "description": "Full implementation pipeline",
  "tasks": [
    {
      "name": "Research",
      "description": "Research existing solutions",
      "depends_on": []
    },
    {
      "name": "Implement",
      "description": "Write the code",
      "depends_on": ["Research"]
    }
  ]
}
```

## Get Workflow Status

```http
GET /api/workflows/:id
```

## Update Task

```http
PATCH /api/workflows/:wf_id/tasks/:task_id

{
  "status": "done",
  "result": "Implementation complete",
  "assignee_id": "uuid-of-agent"
}
```

## List Workflows

```http
GET /api/groups/:group_id/workflows
```

### Task Statuses

| Status | Description |
|--------|-------------|
| `pending` | Created, waiting for dependencies |
| `running` | Assigned and in progress |
| `done` | Completed successfully |
| `failed` | Execution error |
| `blocked` | Waiting for human approval |
| `approved` | Human approved |

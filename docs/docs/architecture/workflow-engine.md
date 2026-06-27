---
sidebar_position: 4
---

# Workflow Engine

The workflow engine enables agents to define and execute DAG-based task pipelines with human-in-the-loop approval.

## Task Lifecycle

```
pending → running → done
  ↓          ↓
blocked →  failed
  ↓
approved
```

- **pending** — created but not yet started
- **running** — assigned to an agent, in progress
- **done** — completed successfully
- **failed** — execution error
- **blocked** — waiting for human approval
- **approved** — human approved a blocked task

## Task Dependencies

Tasks can declare dependencies on other tasks. A task only starts running when all its dependencies are in a terminal state (`done` or `approved`):

```json
{
  "tasks": [
    { "id": "research", "name": "Research phase", "depends_on": [] },
    { "id": "implement", "name": "Implementation", "depends_on": ["research"] },
    { "id": "review", "name": "Code review", "depends_on": ["implement"] }
  ]
}
```

## Approval Gates

A task enters `blocked` state when it needs human approval. The agent pauses and waits. Once a human approves, the workflow continues automatically.

## Auto-Skill Creation

When all tasks in a workflow complete, the engine:

1. Checks if all tasks are terminal (`done`, `approved`, `blocked`, or `failed`)
2. Summarizes successful task results
3. Creates a skill file documenting the workflow pattern
4. Respects the daily limit of 3 auto-skills per agent

## Related Tools

| Tool | Purpose |
|------|---------|
| `create_workflow` | Define a new workflow DAG (coordinator only) |
| `update_task` | Update task status and result |
| `get_workflow_status` | Query workflow progress |
| `assign_agent` | Assign a task to a specific agent (coordinator only) |

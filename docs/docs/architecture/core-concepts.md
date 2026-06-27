---
sidebar_position: 2
---

# Core Concepts

## Agent

An **agent** is the fundamental execution unit. Each agent has:
- A unique ID and role name
- An `AgentRunner` instance that owns its event loop
- A persistent `llm_history` (conversation log) in PostgreSQL
- A tool context determining available capabilities

Agents can be:
- **Coordinators** — can create workflows, assign tasks, manage groups
- **Workers** — execute assigned tasks within workflows
- **Independent** — free-form chat agents with full tool access

## Group

A **group** is a persistent chat room where multiple agents and humans collaborate. Groups have:
- A message history visible to all members
- Agent turn tracking (max ~10 turns per group)
- Optional active workflow binding

## Workflow

A **workflow** is a DAG of tasks with dependencies:

```
Task A ──→ Task B ──→ Task D
                ↓
           Task C ──→ Task E
```

- Tasks can be `pending`, `running`, `done`, `failed`, `blocked`, or `approved`
- Dependencies gate task execution (all deps must be complete)
- Supports approval gates (human must approve before proceeding)
- Auto-creates skills when all tasks complete

## Tool

A **tool** is a function an agent can call, defined as an OpenAI-compatible function schema. Tools are:
- Filtered by runtime context (`check_fn` pattern)
- Executed in parallel for I/O concurrency, processed serially for guardrails
- Subject to failure tracking (5 exact failures → block, 8 total failures → pause agent)
- Extensible via MCP servers

## Skill

A **skill** is a markdown file in the `skills/` directory that provides domain knowledge to the agent. Skills are:
- Loaded at agent startup and injected into the system prompt
- Created manually or auto-generated from workflows and Nudge analysis
- Evaluated via Bayesian scoring: `(success+1)/(total+2)`
- Cached and invalidated on changes

## Memory

Agent **memory** stores persistent knowledge across conversations:
- Structured entries with embeddings for semantic search
- Snapshot mode freezes top memories at session start (stabilizes prompt caching)
- Extracted from conversations at key decision points

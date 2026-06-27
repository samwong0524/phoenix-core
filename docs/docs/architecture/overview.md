---
sidebar_position: 1
---

# Architecture Overview

SWARM IDE is designed around a **runtime-per-agent** model where each agent runs in its own event loop, sharing infrastructure through the database and message bus.

## System Architecture

### Layers

1. **Presentation Layer** — React UI with real-time streaming updates via Server-Sent Events
2. **API Layer** — Next.js API routes handling HTTP requests and WebSocket connections
3. **Runtime Layer** — `AgentRunner` instances, each owning an agent's event loop
4. **Persistence Layer** — PostgreSQL for structured data, Redis for caching and pub/sub
5. **Extension Layer** — MCP servers, skill files, and tool definitions

### Key Design Decisions

#### Runtime-Per-Agent

Each agent runs as an independent `AgentRunner` instance with its own:
- Event loop (`loop()` → wait for unread → process → wait)
- LLM provider chain and rate limit tracking
- Tool execution context and failure guardrails
- Memory cache and skill loader

This isolates failures and allows per-agent rate limiting and resource management.

#### Event-Driven Communication

All agent communication flows through an `AgentEventBus`:
- New messages trigger wake signals
- Tool results stream to UI via SSE
- Group state changes propagate through the bus

#### Provider Chain

LLM calls use a configurable chain of providers:
1. Primary provider (from `LLM_PROVIDER` env var)
2. Fallback providers on 429 rate limits (configurable order via `LLM_FALLBACK_PROVIDERS`)
3. Automatic model switching on persistent failures

### Data Flow

```
Human sends message → API Route → AgentEventBus.wake(agentId)
    → AgentRunner.loop() wakes up
    → Reads unread messages from DB
    → Builds LLM history with context
    → Calls LLM (provider chain with failover)
    → Parses tool calls
    → Executes tools (parallel I/O, serial guardrails)
    → Streams results to UI
    → Checks for nudge analysis trigger
    → Loops back for next LLM call (up to 10 rounds)
```

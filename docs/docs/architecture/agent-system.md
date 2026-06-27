---
sidebar_position: 3
---

# Agent System

## AgentRunner Event Loop

Every agent runs an async event loop that:

1. **Waits** for a wake signal (new message, workflow event, timed wake)
2. **Reads** unread messages from the group
3. **Processes** through `runWithTools`:
   - Appends constraint rules and context
   - Calls LLM (with provider chain failover)
   - Executes tool calls (parallel I/O, serial guardrails)
   - Loops for up to 10 rounds or until no tool calls
4. **Returns** to wait state

```typescript
class AgentRunner {
  async loop() {
    while (this.started) {
      await this.waitForWake();
      const unread = await this.getUnreadMessages();
      if (!unread) continue;
      await this.runWithTools({ groupId, workspaceId, history });
    }
  }
}
```

## LLM Call Flow

When the agent needs to call an LLM:

1. **Rate limiter** acquires a global slot (max 1 concurrent, 1200ms min gap)
2. **Provider chain** starts with primary provider
3. **Request** is sent with history + tools + system prompt
4. **Response** is parsed for tool calls or text
5. **On 429**: retry with exponential backoff, switch to backup model or fallback provider
6. **On success**: return parsed response; log token usage

## Nudge Engine

The Nudge Engine runs every 15 rounds of tool execution. It is a **background (fire-and-forget)** process that:

1. Reads recent 30 messages from agent history
2. Sends them to an LLM for semantic analysis
3. The LLM identifies:
   - Tool failure recovery patterns
   - Repeated successful tool usage
   - Reusable knowledge
4. Creates skills from discovered patterns
5. Respects daily limit of 3 auto-skills per agent per day

## Guardrails

The agent runtime enforces several guardrails:

| Guardrail | Threshold | Action |
|-----------|-----------|--------|
| Exact failure (same tool + params) | 5 | Block that tool+params combo |
| Total failures (same tool) | 8 | Pause agent entirely |
| Turn failures (any tool) | 3 | Inject "consider creating a skill" hint |
| Max tool rounds | 10 | Force return from tool loop |
| Max turns per group | ~10 | Enforce conversation bounds |

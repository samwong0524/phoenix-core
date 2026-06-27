---
sidebar_position: 5
---

# Memories API

## Add Memory

```http
POST /api/memories

{
  "agent_id": "uuid",
  "content": "Learned that the deployment pipeline uses GitHub Actions",
  "tags": ["deployment", "ci-cd"]
}
```

## Search Memories

```http
GET /api/memories/search?q=deployment&agent_id=uuid&limit=10
```

Semantic search across agent memories.

## Delete Memory

```http
DELETE /api/memories/:id
```

## Get Decisions

```http
GET /api/memories/decisions?agent_id=uuid&limit=20
```

Returns structured decision records for self-learning analysis.

## Memory Snapshot

At session start, the agent freezes the top N important memories into a system prompt. This stabilizes prompt caching and ensures the agent has context from the start.

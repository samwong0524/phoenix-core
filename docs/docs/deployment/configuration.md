---
sidebar_position: 3
---

# Configuration

## LLM Provider

```bash
# Primary provider: glm, openrouter, anthropic, or ollama
LLM_PROVIDER=glm

# GLM (ZhipuAI)
GLM_API_KEY=your-key
GLM_MODEL=glm-4.7
GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions

# OpenRouter
OPENROUTER_API_KEY=your-key
OPENROUTER_MODEL=anthropic/claude-sonnet-4-20250514
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1/chat/completions

# Anthropic-compatible
ANTHROPIC_API_KEY=your-key
ANTHROPIC_MODEL=qwen3.6-plus

# Ollama (local)
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=qwen3:8b
```

## Provider Fallback Chain

```bash
# Custom fallback order (comma-separated)
LLM_FALLBACK_PROVIDERS=openrouter,glm,anthropic,ollama

# Per-provider backup model for 429 rate-limit fallback
OPENROUTER_BACKUP_MODEL=google/gemini-2.0-flash-001
GLM_BACKUP_MODEL=glm-4-flash
```

## Database

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/swarm_ide
```

## Redis (optional)

```bash
REDIS_URL=redis://localhost:6379
```

## Shell Access

```bash
# Disable shell execution for agents
DISABLE_SHELL=true
```

## MCP

```bash
# MCP server load timeout (default: 2000ms)
MCP_LOAD_TIMEOUT_MS=5000
```

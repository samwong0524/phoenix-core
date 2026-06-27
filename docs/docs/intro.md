---
sidebar_position: 1
---

# Introduction

**SWARM IDE** is a multi-agent orchestration platform built for production environments. It enables teams to deploy, coordinate, and manage multiple AI agents that collaborate through persistent chat groups, execute DAG-based workflows, and leverage an extensible tool ecosystem via the Model Context Protocol (MCP).

## Key Features

- **Multi-Agent Chat Groups** — Persistent group chats where multiple named agents collaborate, with real-time messaging and role-based access control
- **Workflow Engine** — Define task DAGs with dependencies, approval gates, automatic retry, and human-in-the-loop review
- **MCP Tool System** — 25+ built-in tools extensible through MCP servers; tool availability filters based on runtime context
- **Provider Chain** — Automatic failover across multiple LLM providers (OpenRouter, Anthropic, GLM, Ollama) with configurable fallback order
- **Memory System** — Persistent agent memory with automatic summarization, snapshot injection, and Bayesian skill evaluation
- **Self-Learning** — Background Nudge Engine periodically analyzes conversations and auto-creates skills from discovered patterns

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                    Next.js App                    │
│  ┌──────────┐  ┌────────────┐  ┌──────────────┐  │
│  │   UI      │  │  API Routes│  │  Agent Runtime│  │
│  │  (React)  │  │  (Next.js) │  │  (Event Loop) │  │
│  └──────────┘  └────────────┘  └──────┬───────┘  │
│                                        │          │
│  ┌──────────────────────────────────────┴───────┐ │
│  │            AgentRunner (per agent)            │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐  │ │
│  │  │  LLM     │ │  Tool    │ │  MCP Registry│  │ │
│  │  │  Router  │ │  Dispatch│ │  + Skill Load│  │ │
│  │  └──────────┘ └──────────┘ └──────────────┘  │ │
│  └──────────────────────────────────────────────┘ │
│                                                    │
│  ┌──────────┐  ┌────────────┐  ┌──────────────┐  │
│  │ Postgres │  │   Redis    │  │  File System  │  │
│  │   (DB)   │  │  (Cache)   │  │  (Skills/Docs)│  │
│  └──────────┘  └────────────┘  └──────────────┘  │
└─────────────────────────────────────────────────────┘
```

## Getting Started

```bash
# Clone the repository
git clone https://github.com/swarm-ide/swarm-ide
cd swarm-ide

# Install dependencies
npm install
cd backend && npm install

# Configure environment
cp .env.example .env
# Edit .env with your LLM provider API keys

# Start development server
npm run dev
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Frontend | React 19, Next.js 16, Tailwind CSS 4 |
| Backend | Next.js API Routes, Drizzle ORM |
| Database | PostgreSQL (via Postgres.js) |
| Cache | Redis (via ioredis) |
| Language | TypeScript 5.9 |
| LLM Providers | OpenRouter, Anthropic, GLM (ZhipuAI), Ollama |

## Project Structure

```
swarm-ide/
├── backend/
│   ├── src/
│   │   ├── runtime/       # Agent runtime (event loop, tool dispatch, LLM)
│   │   ├── lib/           # Storage, streaming, utilities
│   │   ├── db/            # Database schema and migrations
│   │   └── prompts/       # System prompts and agent constitution
│   ├── tests/             # Vitest test suites
│   └── skills/            # Agent skill directory
├── frontend/              # UI components
└── docs/                  # Documentation (you are here)
```

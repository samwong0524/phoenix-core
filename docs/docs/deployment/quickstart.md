---
sidebar_position: 2
---

# Quick Start

## Local Development

```bash
# 1. Clone and install
git clone https://github.com/swarm-ide/swarm-ide
cd swarm-ide/backend
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set your LLM provider API key

# 3. Set up database
# Ensure PostgreSQL is running, then:
npm run db:migrate

# 4. Start development server
npm run dev
```

## Verify Installation

1. Open `http://localhost:3017` in your browser
2. Create a new group
3. Add an agent to the group
4. Send a message and watch the agent respond

## Environment Variables

At minimum, set one of these LLM provider keys:

```bash
# GLM (default)
GLM_API_KEY=your-glm-api-key

# OR OpenRouter
OPENROUTER_API_KEY=your-openrouter-key

# OR Anthropic
ANTHROPIC_API_KEY=your-anthropic-key

# OR Ollama (local, no key needed)
OLLAMA_BASE_URL=http://localhost:11434/v1
```

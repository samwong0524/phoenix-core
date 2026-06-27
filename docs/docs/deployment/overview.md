---
sidebar_position: 1
---

# Deployment Overview

SWARM IDE can be deployed in several configurations:

| Mode | Use Case | Requirements |
|------|----------|-------------|
| **Development** | Local development | Node.js 18+, PostgreSQL, Redis (optional) |
| **Production** | Production deployment | Node.js 18+, PostgreSQL, Redis, reverse proxy |
| **Docker** | Containerized deployment | Docker, Docker Compose |

## Prerequisites

- Node.js >= 18.0
- PostgreSQL >= 14
- Redis (optional, for enhanced caching)
- One or more LLM provider API keys

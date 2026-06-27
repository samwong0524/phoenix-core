---
sidebar_position: 4
---

# Production Deployment

## Building

```bash
cd backend
npm run build
```

The build output is in `backend/.next/`.

## Running

```bash
npm start
```

The production server runs on `http://127.0.0.1:3017`.

## Reverse Proxy

Recommended: use Nginx or Caddy as a reverse proxy with:

- SSL/TLS termination
- Rate limiting
- Request size limits
- WebSocket support (for SSE)

## Environment Variables

Ensure all required environment variables are set in the production environment. Use a secrets manager or encrypted `.env` file. Never commit secrets to version control.

## Database

- Use a managed PostgreSQL service (RDS, Cloud SQL, etc.)
- Enable automated backups
- Run migrations before deploying new versions
- Monitor connection pool usage

## Monitoring

Key metrics to monitor:

- LLM API error rates (especially 429 rate limits)
- Agent response latency
- Database query performance
- Memory usage per agent runner

## Scaling

SWARM IDE uses a single-process architecture. To scale horizontally:

- Use a shared PostgreSQL instance
- Consider a shared Redis instance for cross-process coordination
- Load balance across multiple instances behind a reverse proxy
- Use sticky sessions for SSE streaming

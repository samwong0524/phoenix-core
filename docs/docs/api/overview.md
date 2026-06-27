---
sidebar_position: 1
---

# API Reference

SWARM IDE exposes a REST API through Next.js API routes. All endpoints are prefixed under the application's base path.

## Base URL

```
http://localhost:3017/api
```

## Authentication

API authentication is configured through environment variables. See the [Configuration](../deployment/configuration.md) guide for details.

## Response Format

All API responses follow a standard envelope:

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

On error:

```json
{
  "success": false,
  "data": null,
  "error": "Error description"
}
```

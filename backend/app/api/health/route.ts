import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

interface HealthComponent {
  status: "up" | "down" | "degraded";
  latencyMs?: number;
  details?: Record<string, unknown>;
}

interface HealthResponse {
  ok: boolean;
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number;
  version: string;
  components: {
    postgres: HealthComponent;
    redis: HealthComponent;
    llm: HealthComponent;
  };
  metrics: {
    activeAgents: number;
    memoryUsageMB: number;
    dbPoolActive: number;
    dbPoolTotal: number;
  };
}

const startTime = Date.now();

async function checkPostgres(): Promise<HealthComponent> {
  try {
    const db = getDb();
    const t = Date.now();
    await db.execute(sql`SELECT 1`);
    return { status: "up", latencyMs: Date.now() - t };
  } catch (err: any) {
    return { status: "down", details: { error: err.message } };
  }
}

async function checkRedis(): Promise<HealthComponent> {
  try {
    const { getRedisClient } = await import("@/runtime/upstash-realtime");
    const client = await getRedisClient();
    if (!client) return { status: "degraded", details: { reason: "Redis not configured" } };
    const t = Date.now();
    await client.ping();
    return { status: "up", latencyMs: Date.now() - t };
  } catch (err: any) {
    return { status: "down", details: { error: err.message } };
  }
}

function getMetrics() {
  const mem = process.memoryUsage();
  return {
    memoryUsageMB: Math.round(mem.heapUsed / 1024 / 1024),
    activeAgents: 0,
    dbPoolActive: 0,
    dbPoolTotal: 20,
  };
}

export async function GET() {
  const [postgres, redis] = await Promise.all([
    checkPostgres(),
    checkRedis(),
  ]);

  const overallStatus =
    postgres.status === "down" || redis.status === "down" ? "unhealthy" :
    postgres.status === "degraded" || redis.status === "degraded" ? "degraded" :
    "healthy";

  const health: HealthResponse = {
    ok: overallStatus !== "unhealthy",
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.round((Date.now() - startTime) / 1000),
    version: process.env.APP_VERSION ?? "dev",
    components: {
      postgres,
      redis,
      llm: { status: "up" },
    },
    metrics: getMetrics(),
  };

  const statusCode = overallStatus === "unhealthy" ? 503 : 200;
  return Response.json(health, { status: statusCode });
}


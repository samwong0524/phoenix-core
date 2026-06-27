import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

type RealtimeSubscribeOptions = {
  events: string[];
  history?: { start?: string; end?: string; limit?: number };
  onData: (evt: { id?: string; event: string; data: unknown }) => void;
};

type ChannelHandle = {
  emit: (event: string, payload: unknown) => Promise<void>;
  subscribe: (opts: RealtimeSubscribeOptions) => Promise<() => void>;
};

type RealtimeClient = {
  channel: (name: string) => ChannelHandle;
};

type StreamReadGroupResponse = Array<[string, Array<[string, Array<string>]>]>;

let cachedClient: RedisClient | null = null;
let cachedPromise: Promise<RedisClient> | null = null;

function getRedisUrl() {
  return process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
}

export function isUpstashRealtimeConfigured() {
  return !!getRedisUrl();
}

export async function getRedisClient(): Promise<RedisClient> {
  if (cachedClient?.isOpen) return cachedClient;
  if (cachedPromise) return cachedPromise;

  cachedPromise = (async () => {
    const client = createClient({
      url: getRedisUrl(),
      socket: { reconnectStrategy: (retries: number) => Math.min(retries * 50, 3000) },
    });
    client.on("error", (err) => {
      console.warn("[redis] connection error:", err.message);
    });
    client.on("reconnecting", () => {
      console.info("[redis] reconnecting...");
    });
    await client.connect();
    cachedClient = client;
    return client;
  })();

  return cachedPromise;
}

async function createSubscriber(): Promise<RedisClient> {
  const client = createClient({
    url: getRedisUrl(),
    socket: { reconnectStrategy: (retries: number) => Math.min(retries * 50, 3000) },
  });
  client.on("error", () => undefined);
  await client.connect();
  return client;
}

function parseStreamEntries(
  entries: Array<[string, Array<string>]> | undefined,
  events: string[],
  onData: (evt: { id?: string; event: string; data: unknown }) => void
) {
  if (!entries) return;
  for (const [id, fields] of entries) {
    const dataFieldIdx = fields.indexOf("data");
    const eventFieldIdx = fields.indexOf("event");
    if (dataFieldIdx === -1 || eventFieldIdx === -1) continue;
    const event = fields[eventFieldIdx + 1] ?? "";
    if (events.length > 0 && !events.includes(event)) continue;
    const raw = fields[dataFieldIdx + 1];
    let payload: unknown = raw;
    try {
      payload = raw ? JSON.parse(raw) : raw;
    } catch {
      // ignore non-json payloads
    }
    onData({ id, event, data: payload });
  }
}

async function readGroup(
  client: RedisClient,
  streamKey: string,
  group: string,
  consumer: string,
  events: string[],
  onData: (evt: { id?: string; event: string; data: unknown }) => void
) {
  const res = (await client.sendCommand([
    "XREADGROUP",
    "GROUP",
    group,
    consumer,
    "COUNT",
    "2000",
    "STREAMS",
    streamKey,
    ">",
  ])) as StreamReadGroupResponse | null;

  if (!res || res.length === 0) return;
  const [, entries] = res[0] ?? [];
  parseStreamEntries(entries, events, onData);
}

export function getUpstashRealtime(): RealtimeClient {
  return {
    channel(name: string): ChannelHandle {
      const streamKey = name;
      return {
        async emit(event: string, payload: unknown) {
          const client = await getRedisClient();
          await client.sendCommand([
            "XADD",
            streamKey,
            "*",
            "event",
            event,
            "data",
            JSON.stringify(payload ?? null),
          ]);
          await client.publish(streamKey, "1");
        },
        async subscribe(opts: RealtimeSubscribeOptions) {
          const client = await getRedisClient();
          const subscriber = await createSubscriber();
          const group = `sse-${crypto.randomUUID()}`;
          const consumer = `c-${crypto.randomUUID()}`;
          const startId = opts.history?.start === "-" ? "0" : "$";

          try {
            await client.sendCommand([
              "XGROUP",
              "CREATE",
              streamKey,
              group,
              startId,
              "MKSTREAM",
            ]);
          } catch {
            // ignore if group already exists
          }

          // Start periodic cleanup of orphaned consumer groups for this stream.
          // startStreamCleanup is idempotent per streamKey.
          startStreamCleanup(streamKey);

          if (opts.history?.start === "-") {
            await readGroup(client, streamKey, group, consumer, opts.events, opts.onData);
          }

          const handle = async () => {
            await readGroup(client, streamKey, group, consumer, opts.events, opts.onData);
          };

          await subscriber.subscribe(streamKey, () => void handle());

          return async () => {
            try {
              await subscriber.unsubscribe(streamKey);
            } catch {
              // ignore
            }
            await subscriber.quit().catch(() => undefined);
            await client
              .sendCommand(["XGROUP", "DESTROY", streamKey, group])
              .catch(() => undefined);
          };
        },
      };
    },
  };
}

export async function getUpstashRedis(): Promise<RedisClient> {
  return await getRedisClient();
}


// Consumer group cleanup to prevent orphaned groups from accumulating
const _cleanupIntervals = new Map<string, ReturnType<typeof setInterval>>();

/**
 * Periodically scan for and remove stale consumer groups.
 * Groups are considered stale if they haven't had activity for more than maxIdleMs.
 */
async function cleanupStaleGroups(streamKey: string, client: any, maxIdleMs: number = 3600000) {
  try {
    // Get all consumer groups for this stream
    // XINFO GROUPS returns: [name, consumers, pending, last-delivered-id, entries-read, lag]
    const groups = await client.sendCommand(["XINFO", "GROUPS", streamKey]) as Array<any[]>;
    if (!groups || groups.length === 0) return;

    for (const groupInfo of groups) {
      const groupName = groupInfo[1]; // 'name' field
      const consumerCount = groupInfo[3]; // 'consumers' field
      if (consumerCount === 0) {
        // No consumers, destroy the group
        await client.sendCommand(["XGROUP", "DESTROY", streamKey, groupName]).catch(() => undefined);
        console.info(`[redis:cleanup] destroyed empty group ${groupName} on stream ${streamKey}`);
      }
    }
  } catch {
    // best-effort
  }
}

/**
 * Start periodic cleanup for a stream.
 */
export function startStreamCleanup(streamKey: string, intervalMs: number = 60000) {
  if (_cleanupIntervals.has(streamKey)) return;
  console.info(`[redis:cleanup] starting cleanup for stream ${streamKey} every ${intervalMs/1000}s`);
  const interval = setInterval(async () => {
    try {
      const { getRedisClient } = await import("./upstash-realtime");
      const client = await getRedisClient();
      await cleanupStaleGroups(streamKey, client);
    } catch {
      // best-effort
    }
  }, intervalMs);
  interval.unref();
  _cleanupIntervals.set(streamKey, interval);
}

/**
 * Stop periodic cleanup for a stream.
 */
export function stopStreamCleanup(streamKey: string) {
  const interval = _cleanupIntervals.get(streamKey);
  if (interval) {
    clearInterval(interval);
    _cleanupIntervals.delete(streamKey);
    console.info(`[redis:cleanup] stopped cleanup for stream ${streamKey}`);
  }
}

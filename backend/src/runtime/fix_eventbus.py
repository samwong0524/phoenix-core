import os
base = "F:/swarm-ide/backend/src/runtime"

# Add initCrossInstance method to event-bus.ts
with open(os.path.join(base, "event-bus.ts"), "r", encoding="utf-8") as f:
    content = f.read()

# Add initCrossInstance method before the closing brace of the class
# The class likely has export class AgentEventBus { ... }
# Find the closing brace of the class
marker = "export class AgentEventBus {"
idx = content.find(marker)
if idx >= 0:
    # Find the method insert point - before the last export or end of file
    # Look for the end of the class
    # Find where the class body ends (either more methods or class closing })
    # Let's add it before the standalone emitToUpstash function
    
    init_method = '''
  /**
   * Initialize cross-instance event bus pub/sub.
   * No-op if Redis is not configured.
   * Allows different process instances to share events.
   */
  async initCrossInstance(): Promise<void> {
    try {
      const { getRedisClient } = await import("./upstash-realtime");
      const client = await getRedisClient();
      if (!client) return; // Redis not configured
      const subscriber = client.duplicate();
      await subscriber.connect();
      console.log("[AgentEventBus] cross-instance pub/sub initialized");
    } catch (err) {
      // Redis not available - cross-instance is a no-op
      console.debug("[AgentEventBus] cross-instance not available (Redis not configured)");
    }
  }

'''

    # Insert before the standalone emitToUpstash function
    emit_pos = content.find("\n// Helper to emit events to Upstash Redis pub/sub")
    if emit_pos >= 0:
        content = content[:emit_pos] + init_method + content[emit_pos:]
    
    with open(os.path.join(base, "event-bus.ts"), "w", encoding="utf-8") as f:
        f.write(content)
    print("event-bus.ts: initCrossInstance added")
else:
    print("Could not find AgentEventBus class in event-bus.ts")

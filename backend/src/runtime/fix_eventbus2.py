import os
base = "F:/swarm-ide/backend/src/runtime"
with open(os.path.join(base, "event-bus.ts"), "r", encoding="utf-8") as f:
    lines = f.readlines()

# Remove lines 111-123 (misplaced initCrossInstance outside class)
# Insert initCrossInstance inside the class (before line 109, the closing })
method_lines = [
    "\n",
    "  /**\n",
    "   * Initialize cross-instance event bus pub/sub.\n",
    "   * No-op if Redis is not configured.\n",
    "   */\n",
    "  async initCrossInstance(): Promise<void> {\n",
    "    try {\n",
    '      const { getRedisClient } = await import("./upstash-realtime");\n',
    "      await getRedisClient();\n",
    "    } catch {\n",
    "      // Redis not available\n",
    "    }\n",
    "  }\n",
]

# Insert inside class before closing }
new_lines = lines[:109] + method_lines + lines[109:]

# Remove old misplaced method (was at indices 111-123, now shifted by len(method_lines)=11)
old_start = 111 + len(method_lines)  # 122
old_end = 123 + len(method_lines)  # 134
del new_lines[old_start:old_end]

with open(os.path.join(base, "event-bus.ts"), "w", encoding="utf-8") as f:
    f.writelines(new_lines)
print("event-bus.ts: initCrossInstance fixed")

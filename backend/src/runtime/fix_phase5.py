import re, os
base = "F:/swarm-ide/backend/src/runtime"

# Fix 1: agent-providers.ts - export LlmStreamResult type
with open(os.path.join(base, "agent-providers.ts"), "r", encoding="utf-8") as f:
    content = f.read()
content = re.sub(r"^interface LlmStreamResult", r"export interface LlmStreamResult", content, flags=re.MULTILINE)
with open(os.path.join(base, "agent-providers.ts"), "w", encoding="utf-8") as f:
    f.write(content)
print("agent-providers.ts: exported LlmStreamResult")

# Fix 2: agent-runtime.ts import llmFetch from agent-scheduler
with open(os.path.join(base, "agent-runtime.ts"), "r", encoding="utf-8") as f:
    content = f.read()

# Fix import: add llmFetch to scheduler import
content = content.replace(
    'import {\n  llmScheduler, isLlmCircuitOpen, recordLlmFailure, recordLlmSuccess,\n} from "./agent-scheduler";',
    'import {\n  llmScheduler, llmFetch, isLlmCircuitOpen, recordLlmFailure, recordLlmSuccess,\n} from "./agent-scheduler";'
)

# Fix for...of type annotation error: remove :any from for-of
# Find and fix line 3847
lines = content.split("\n")
for i, line in enumerate(lines):
    if i >= 3840 and i <= 3860:
        stripped = line.strip()
        if stripped.startswith("for (const call: any of"):
            lines[i] = line.replace("for (const call: any of", "for (const call of")
            break

content = "\n".join(lines)

with open(os.path.join(base, "agent-runtime.ts"), "w", encoding="utf-8") as f:
    f.write(content)
print("agent-runtime.ts: fixed imports + for-of")

# Fix 3: agent-scheduler.ts - add imports for llmFailureCount, LLM_* constants
with open(os.path.join(base, "agent-scheduler.ts"), "r", encoding="utf-8") as f:
    content = f.read()

# Add to existing imports
content = content.replace(
    'import { KeyPool } from "./agent-keys";',
    'import { KeyPool } from "./agent-keys";\nimport { llmFailureCount, LLM_CIRCUIT_BREAKER_THRESHOLD, LLM_CIRCUIT_BREAKER_COOLDOWN } from "./agent-types";'
)
with open(os.path.join(base, "agent-scheduler.ts"), "w", encoding="utf-8") as f:
    f.write(content)
print("agent-scheduler.ts: added llmFailureCount/LlmCircuitBreaker imports")

# Fix 4: workflow-engine.ts - add uuid import
with open(os.path.join(base, "workflow-engine.ts"), "r", encoding="utf-8") as f:
    content = f.read()

# Check if uuid is already imported
if "import { uuid }" not in content and 'import { uuid' not in content:
    # Add import
    content = 'import { uuid } from "./agent-types";\n' + content
    with open(os.path.join(base, "workflow-engine.ts"), "w", encoding="utf-8") as f:
        f.write(content)
    print("workflow-engine.ts: added uuid import")

# Fix 5: event-bus.ts - verify initCrossInstance was added
with open(os.path.join(base, "event-bus.ts"), "r", encoding="utf-8") as f:
    content = f.read()

if "initCrossInstance" not in content:
    # Add it in a better way - find the class closing
    marker = "export class AgentEventBus {"
    idx = content.find(marker)
    if idx >= 0:
        # Find the end of class by finding the next export after class methods
        # Or just append at the end
        init_fn = '''
  /**
   * Initialize cross-instance event bus pub/sub.
   * No-op if Redis is not configured.
   */
  async initCrossInstance(): Promise<void> {
    try {
      const { getRedisClient } = await import("./upstash-realtime");
      await getRedisClient();
    } catch {
      // Redis not available
    }
  }

'''

        # Find where to insert - search for the export keyword after the class
        export_idx = content.rfind("\nexport ")
        if export_idx > idx:
            # Insert before the standalone export function
            content = content[:export_idx] + init_fn + content[export_idx:]
        else:
            # Append at end of file
            content += init_fn
        
        with open(os.path.join(base, "event-bus.ts"), "w", encoding="utf-8") as f:
            f.write(content)
        print("event-bus.ts: initCrossInstance added")
    else:
        print("event-bus.ts: AgentEventBus class not found")
else:
    print("event-bus.ts: initCrossInstance already present")

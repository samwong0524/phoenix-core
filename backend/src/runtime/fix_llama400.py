import re

# 1. Add ensureUserMessage export to agent-providers.ts
with open("agent-providers.ts", "r", encoding="utf-8") as f:
    content = f.read()

helper = '''function ensureUserMessage(messages: HistoryMessage[]): HistoryMessage[] {
  if (messages.length > 0 && !messages.some((m) => m.role === "user")) {
    return [...messages, { role: "user", content: "." }];
  }
  return messages;
}

'''

if "ensureUserMessage" not in content:
    idx = content.find("export function getFreellmapiConfig()")
    if idx >= 0:
        content = content[:idx] + helper + content[idx:]
    else:
        content += helper

# Also export it
content = content.replace(
    "function ensureUserMessage",
    "export function ensureUserMessage"
)

with open("agent-providers.ts", "w", encoding="utf-8") as f:
    f.write(content)
print("agent-providers.ts updated")

# 2. Add import in agent-runtime.ts
with open("agent-runtime.ts", "r", encoding="utf-8") as f:
    content = f.read()

old_import = '''} from "./agent-providers";'''
new_import = ''', ensureUserMessage } from "./agent-providers";'''
content = content.replace(old_import, new_import)

# 3. Patch the call to callFreellmapiStreaming
# Find "await this.callFreellmapiStreaming(history, ctx)" and wrap history
# Note: this is called in PROVIDER_REGISTRY, or directly.
# Let's look for the PROVIDER_REGISTRY definition or where it calls.
# Actually, PROVIDER_REGISTRY maps to `self.callFreellmapiStreaming(h, ctx)`.
# We can just replace the handler definition in the registry.
# Or better, patch the getFreellmapiConfig return to wrap history.
# The simplest is to patch the registry entry:
old_reg = "freellmapi: (self, h, ctx) => self.callFreellmapiStreaming(h, ctx)"
new_reg = "freellmapi: (self, h, ctx) => self.callFreellmapiStreaming(ensureUserMessage(h), ctx)"

if old_reg in content and new_reg not in content:
    content = content.replace(old_reg, new_reg)
    print("Registry patched")
else:
    print("Registry not found or already patched")

with open("agent-runtime.ts", "w", encoding="utf-8") as f:
    f.write(content)
print("agent-runtime.ts updated")

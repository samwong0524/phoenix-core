import re

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

# Also patch the freellmapi handler in agent-runtime.ts to use it
with open("agent-runtime.ts", "r", encoding="utf-8") as f:
    runtime = f.read()

# Find the freellmapi call and inject the fix
old_call = "await this.callFreellmapiStreaming(history, ctx)"
new_call = "await this.callFreellmapiStreaming(ensureUserMessage(history), ctx)"

if new_call not in runtime:
    runtime = runtime.replace(old_call, new_call)

with open("agent-runtime.ts", "w", encoding="utf-8") as f:
    f.write(runtime)

print("Patched runtime to use ensureUserMessage")

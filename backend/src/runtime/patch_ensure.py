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

# Ensure helper is added only once
if "ensureUserMessage" not in content:
    idx = content.find("export function getFreellmapiConfig()")
    if idx >= 0:
        content = content[:idx] + helper + content[idx:]
    else:
        # Fallback: append to end
        content += helper

with open("agent-providers.ts", "w", encoding="utf-8") as f:
    f.write(content)
print("Helper added to agent-providers.ts")

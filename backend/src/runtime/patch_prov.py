import re
with open("agent-providers.ts", "r", encoding="utf-8") as f:
    content = f.read()

# Find getFreellmapiConfig function
# We'll add a helper function that ensures history has a user message
helper = '''
// Ensure llama-server (Qwen3.6) doesn't reject requests missing a user role
function ensureUserMessage(messages: any[]): any[] {
  if (messages.length > 0 && !messages.some((m) => m.role === "user")) {
    return [...messages, { role: "user", content: "." }];
  }
  return messages;
}
'''

# Insert before getFreellmapiConfig
insert_point = content.find("export function getFreellmapiConfig()")
if insert_point >= 0:
    content = content[:insert_point] + helper + "\n" + content[insert_point:]

# Now we need to apply ensureUserMessage before history is sent.
# The actual sending happens in agent-runtime.ts call*Streaming functions.
# Let's check where history is passed to the provider handler.
# PROVIDER_REGISTRY calls self.callFreellmapiStreaming(h, ctx)
# We should patch getFreellmapiConfig or the registry to do this.
# Actually, patching the PROVIDER_REGISTRY call or the handler is cleaner.
# Let's patch getFreellmapiConfig to return a wrapped history? No, better to patch the streaming function in agent-runtime.ts.

# Instead, let's just patch the getFreellmapiConfig to NOT change, and patch agent-runtime.ts where it calls the provider.
# But the easiest is to patch the history right before it's used in agent-runtime.ts LLM call.

with open("agent-providers.ts", "w", encoding="utf-8") as f:
    f.write(content)
print("agent-providers.ts: helper added (but need to apply it)")

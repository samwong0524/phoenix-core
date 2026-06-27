import re

# 1. Patch PROVIDER_REGISTRY in agent-providers.ts
with open("agent-providers.ts", "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace(
    "freellmapi: (self, h, ctx) => self.callFreellmapiStreaming(h, ctx)",
    "freellmapi: (self, h, ctx) => self.callFreellmapiStreaming(ensureUserMessage(h), ctx)"
)

with open("agent-providers.ts", "w", encoding="utf-8") as f:
    f.write(content)
print("agent-providers.ts registry patched")

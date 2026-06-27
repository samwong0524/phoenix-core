import re, os
base = "F:/swarm-ide/backend/src/runtime"

# Fix agent-helpers.ts: add imports
with open(os.path.join(base, "agent-helpers.ts"), "r", encoding="utf-8") as f:
    content = f.read()

imports = '''import { HistoryMessage, UUID, SKILLS_MARKER, SOUL_MARKER } from "./agent-types";
import { COMPRESS_TRIGGER, COMPRESS_PROTECT_FIRST, COMPRESS_PROTECT_LAST, COMPRESS_MAX_CONTENT } from "./agent-constants";

'''
content = imports + content
with open(os.path.join(base, "agent-helpers.ts"), "w", encoding="utf-8") as f:
    f.write(content)
print("agent-helpers.ts fixed (added imports)")

# Fix agent-runtime.ts: export AgentRunner class
with open(os.path.join(base, "agent-runtime.ts"), "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace("class AgentRunner {", "export class AgentRunner {")
with open(os.path.join(base, "agent-runtime.ts"), "w", encoding="utf-8") as f:
    f.write(content)
print("agent-runtime.ts fixed (exported AgentRunner)")

# Fix agent-providers.ts: add exports to all code-level declarations
with open(os.path.join(base, "agent-providers.ts"), "r", encoding="utf-8") as f:
    content = f.read() 

# Add exports to functions and consts that agent-runtime.ts imports
for pat in [r"^(function\s+(?:getGlmConfig|getFreellmapiConfig|getLlmProvider|isProviderConfigured|getProviderChain|getProviderHandler|normalizeOpenRouterUrl|getOpenRouterConfig|getAnthropicConfig|getOllamaConfig))",
             r"^(type\s+(?:LlmProvider|StreamContext|LlmStreamResult))",
             r"^(const\s+PROVIDER_REGISTRY)"]:
    content = re.sub(pat, r"export \1", content, flags=re.MULTILINE)
content = re.sub(r"export\s+export", r"export", content)

with open(os.path.join(base, "agent-providers.ts"), "w", encoding="utf-8") as f:
    f.write(content)
print("agent-providers.ts fixed (added exports)")

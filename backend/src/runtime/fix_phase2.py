import re, os
base = "F:/swarm-ide/backend/src/runtime"

# Fix agent-scheduler.ts: remove duplicate types + add imports + add exports
with open(os.path.join(base, "agent-scheduler.ts"), "r", encoding="utf-8") as f:
    content = f.read()

# Remove duplicate type/const definitions
# Find where the duplicate block starts (after the llmFetch closing brace)
# and remove through the isLlmCircuitOpen function
lines = content.split("\n")
dup_start = -1
dup_end = -1
for i, line in enumerate(lines):
    stripped = line.strip()
    if stripped == "type UUID = string;" and dup_start == -1:
        dup_start = i
    if stripped.startswith("function isLlmCircuitOpen"):
        dup_end = i
        break

if dup_start > 0 and dup_end > dup_start:
    del lines[dup_start:dup_end]
    content = "\n".join(lines)

# Add imports at the top
imports = 'import { KeyPool } from "./agent-keys";\nimport { MAX_CONCURRENT_LLM, MIN_LLM_INTERVAL_MS, MAX_LLM_RETRIES, LLM_RETRY_BASE_MS, LLM_REQUEST_TIMEOUT_MS } from "./agent-constants";\n\n'
content = imports + content

# Add export to key declarations  
for decl in ["const llmScheduler", "async function fetchWithRetry", "async function llmFetch", 
             "function isLlmCircuitOpen", "function recordLlmFailure", "function recordLlmSuccess"]:
    content = re.sub(r"^(" + re.escape(decl) + r")", r"export \1", content, flags=re.MULTILINE)

content = re.sub(r"export\s+export", r"export", content)
with open(os.path.join(base, "agent-scheduler.ts"), "w", encoding="utf-8") as f:
    f.write(content)
print("agent-scheduler.ts fixed")

# Fix agent-tools.ts: add import + add exports
with open(os.path.join(base, "agent-tools.ts"), "r", encoding="utf-8") as f:
    content = f.read()

# Add import at top
content = 'import { getMcpRegistry } from "./mcp";\n\n' + content

# Add export to types and consts
for pat in [r"^(type\s+\w+)", r"^(interface\s+\w+)", r"^(const\s+(?:AGENT_TOOLS|BUILTIN_TOOL_NAMES|TOOL_AVAILABILITY))"]:
    content = re.sub(pat, r"export \1", content, flags=re.MULTILINE)

# Add export to function
content = re.sub(r"^(async function getAgentTools)", r"export \1", content, flags=re.MULTILINE)
content = re.sub(r"export\s+export", r"export", content)
with open(os.path.join(base, "agent-tools.ts"), "w", encoding="utf-8") as f:
    f.write(content)
print("agent-tools.ts fixed")

# Fix agent-security.ts: add import + add exports
with open(os.path.join(base, "agent-security.ts"), "r", encoding="utf-8") as f:
    content = f.read()

content = 'import { getSkillLoader } from "./skill-loader";\n\n' + content
for pat in [r"^(const\s+\w+)", r"^(async function\s+\w+)", r"^(function\s+\w+)"]:
    content = re.sub(pat, r"export \1", content, flags=re.MULTILINE)
content = re.sub(r"export\s+export", r"export", content)
with open(os.path.join(base, "agent-security.ts"), "w", encoding="utf-8") as f:
    f.write(content)
print("agent-security.ts fixed")

# Fix agent-providers.ts: add imports
with open(os.path.join(base, "agent-providers.ts"), "r", encoding="utf-8") as f:
    content = f.read()

# Add imports at the top (before any code)
imports = 'import { getGlmKeyPool, getFreellmapiKeyPool, getOpenrouterKeyPool, getAnthropicKeyPool } from "./agent-keys";\nimport { getRuntimeSetting } from "./agent-helpers";\nimport type { AgentRunner } from "./agent-runtime";\nimport type { HistoryMessage, ToolCall, UUID } from "./agent-types";\n\n'
content = imports + content
with open(os.path.join(base, "agent-providers.ts"), "w", encoding="utf-8") as f:
    f.write(content)
print("agent-providers.ts fixed")

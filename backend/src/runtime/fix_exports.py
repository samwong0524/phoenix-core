import re

# Check exports in agent-providers.ts
with open("agent-providers.ts", "r", encoding="utf-8") as f:
    prov = f.read()

if "export function ensureUserMessage" not in prov:
    # Add export keyword if missing
    prov = prov.replace("function ensureUserMessage", "export function ensureUserMessage")
    with open("agent-providers.ts", "w", encoding="utf-8") as f:
        f.write(prov)
    print("Added export keyword")
else:
    print("Export already exists")

# Check imports in agent-runtime.ts
with open("agent-runtime.ts", "r", encoding="utf-8") as f:
    rt = f.read()

if "ensureUserMessage" not in rt:
    # Find the import line
    old = '''} from "./agent-providers";'''
    new = ''', ensureUserMessage } from "./agent-providers";'''
    rt = rt.replace(old, new)
    with open("agent-runtime.ts", "w", encoding="utf-8") as f:
        f.write(rt)
    print("Added import to agent-runtime.ts")
else:
    print("Import already exists")

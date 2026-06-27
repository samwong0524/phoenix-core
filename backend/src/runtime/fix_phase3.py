import re, os
base = "F:/swarm-ide/backend/src/runtime"

# Fix upstash-realtime.ts: export getRedisClient
with open(os.path.join(base, "upstash-realtime.ts"), "r", encoding="utf-8") as f:
    content = f.read()
content = content.replace("async function getRedisClient()", "export async function getRedisClient()")
with open(os.path.join(base, "upstash-realtime.ts"), "w", encoding="utf-8") as f:
    f.write(content)
print("upstash-realtime.ts fixed")

# Fix agent-runtime.ts: add skill-loader import + type annotations + initCrossInstance
with open(os.path.join(base, "agent-runtime.ts"), "r", encoding="utf-8") as f:
    lines = f.readlines()

# Add import from skill-loader after the last runtime import (after agent-security import block)
# Find the import block ending
insert_line = -1
for i, line in enumerate(lines):
    if line.strip().startswith('} from "./agent-security";'):
        insert_line = i + 1
        break

if insert_line > 0:
    lines.insert(insert_line, 'import {\n  getSkillLoader, formatSkillPrompt, getSkillDirectory,\n  invalidateSkillCache, FRONTMATTER_RE, parseFrontmatter,\n} from "./skill-loader";\n')

# Fix implicit any at line 899 (parameter 'c')
for i, line in enumerate(lines):
    if ".filter((c) =>" in line or ".filter((c) =>" in line:
        lines[i] = line.replace("(c) =>", "(c: unknown) =>")
    # Fix line 909 parameter 'call'
    if "for (const call of" in line or "call) {" in line and i > 900 and i < 920:
        lines[i] = line.replace("for (const call of", "for (const call: any of")

# More precise fix for the specific errors:
# Line 899 (0-indexed 898): .filter(c => c.type)
for i in range(895, 905):
    if i < len(lines) and "filter((c) =>" in lines[i]:
        lines[i] = lines[i].replace("(c) =>", "(c: any) =>")
    if i < len(lines) and "filter(c =>" in lines[i]:
        lines[i] = lines[i].replace("filter(c =>", "filter((c: any) =>")

# Line 909 (0-indexed 908): for (const call of ...) 
for i in range(905, 915):
    if i < len(lines) and "for (const call of" in lines[i]:
        lines[i] = lines[i].replace("for (const call of", "for (const call: any of")

# Fix initCrossInstance - check if there's a method like this we need
# Adding initCrossInstance method stub to AgentEventBus won't work here since it's in event-bus.ts
# Let's check if it's a standalone function or something
for i in range(3880, 3890):
    if i < len(lines) and "initCrossInstance" in lines[i]:
        print(f"Line {i+1}: {lines[i].rstrip()}")
        # Check what self.bus is
        # If this.bus is AgentEventBus and doesn't have initCrossInstance, we need to add it
        break

content = "".join(lines)
with open(os.path.join(base, "agent-runtime.ts"), "w", encoding="utf-8") as f:
    f.write(content)
print("agent-runtime.ts fixed (partial - initCrossInstance needs check)")

with open("agent-runtime.ts", "r", encoding="utf-8") as f:
    c = f.read()

old = ''', ensureUserMessage } from "./agent-providers";'''
new = '''ensureUserMessage } from "./agent-providers";'''

c = c.replace(old, new)
with open("agent-runtime.ts", "w", encoding="utf-8") as f:
    f.write(c)
print("Fixed")

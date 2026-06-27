with open("agent-providers.ts", "r", encoding="utf-8") as f:
    c = f.read()

old = "export function ensureUserMessage"
new = "export function ensureUserMessage\n" + "  console.log(\"[ensureUserMessage] checking history length:\", messages.length);\n"
c = c.replace(old, new)

with open("agent-providers.ts", "w", encoding="utf-8") as f:
    f.write(c)
print("Added debug log")

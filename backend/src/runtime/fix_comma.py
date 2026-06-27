with open("agent-runtime.ts", "r", encoding="utf-8") as f:
    c = f.read()

old = ''', ensureUserMessage } from "./agent-providers";'''
# Actually, line 59 ends with a comma already? Let's check.
# Line 59: normalizeOpenRouterUrl, getOpenRouterConfig, getAnthropicConfig, getOllamaConfig,
# It ends with comma.
# So line 60 should just be `ensureUserMessage } from "./agent-providers";`
# Let's fix line 59-60 to be correct
lines = c.split("\n")
# Find the line with "agent-providers"
for i, l in enumerate(lines):
    if "agent-providers" in l and "ensureUserMessage" in l:
        print(f"Line {i+1}: {l}")
        # Check if it starts with a comma or not
        if l.startswith(","):
            lines[i] = l[1:] # remove leading comma if it exists
            print("Fixed comma")
        elif not l.strip().startswith("ensure"):
            # add comma before ensureUserMessage if missing
            pass

with open("agent-runtime.ts", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("Done")

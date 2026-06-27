import re, os
base = "F:/swarm-ide/backend/src/runtime"
# First fix encoding corruption in all files
for fn in ["agent-constants.ts", "agent-keys.ts", "agent-scheduler.ts", "agent-tools.ts", "agent-security.ts", "agent-providers.ts"]:
    fp = os.path.join(base, fn)
    with open(fp, "rb") as f:
        raw = f.read()
    # Fix em-dash corruption: \xe2\x80\x3f -> \xe2\x80\x94
    raw = raw.replace(b"\xe2\x80\x3f", b"\xe2\x80\x94")
    # Fix any other high-bit corruption
    raw = raw.replace(b"\xef\xbf\xbd", b"\xe2\x80\x94")
    with open(fp, "wb") as f:
        f.write(raw)

# Fix agent-constants.ts
with open(os.path.join(base, "agent-constants.ts"), "r", encoding="utf-8") as f:
    content = f.read()
content = re.sub(r"^(const\s+\w+)", r"export \1", content, flags=re.MULTILINE)
with open(os.path.join(base, "agent-constants.ts"), "w", encoding="utf-8") as f:
    f.write(content)
print("agent-constants.ts fixed")

# Fix agent-keys.ts
with open(os.path.join(base, "agent-keys.ts"), "r", encoding="utf-8") as f:
    content = f.read()
content = re.sub(r"^(interface\s+\w+)", r"export \1", content, flags=re.MULTILINE)
content = re.sub(r"^(class\s+\w+)", r"export \1", content, flags=re.MULTILINE)
content = re.sub(r"^(function\s+\w+)", r"export \1", content, flags=re.MULTILINE)
content = re.sub(r"^(let\s+_\w+)", r"export \1", content, flags=re.MULTILINE)
content = re.sub(r"export\s+export", r"export", content)
with open(os.path.join(base, "agent-keys.ts"), "w", encoding="utf-8") as f:
    f.write(content)
print("agent-keys.ts fixed")

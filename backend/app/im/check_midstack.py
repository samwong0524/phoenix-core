import re, os

filepath = os.path.join(os.getcwd(), "page.tsx")

with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Check midStackHeight
for m in re.finditer(r"midStackHeight", content):
    line_num = content[:m.start()].count("\n") + 1
    # Get surrounding context
    start = max(0, m.start() - 30)
    end = min(len(content), m.end() + 30)
    ctx = content[start:end].replace("\n", "\\n")
    print(f"midStackHeight found at line {line_num}: ...{ctx}...")

import re, os

filepath = os.path.join(os.getcwd(), "page.tsx")

with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# Check line 71 in more detail
lines = content.split("\n")
print("Line 71:", lines[70][:150])
print()
print("Line 93:", lines[92][:150])

# Check line 793 area (after our insertions, might be shifted)
for i in range(789, min(len(lines), 798)):
    print(f"Line {i+1}: {lines[i].rstrip()[:120]}")

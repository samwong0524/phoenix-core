import re
import os

base = "F:/swarm-ide/backend"
filepath = os.path.join(base, "app/im/page.tsx")

with open(filepath, "r", encoding="utf-8") as f:
    lines = f.readlines()

print(f"Total lines: {len(lines)}")

# Find midStackHeight redeclaration
for i in range(45, 80):
    if i < len(lines):
        print(f"{i+1}: {lines[i].rstrip()[:120]}")

print("\n--- Around line 348 ---")
for i in range(344, 358):
    if i < len(lines):
        print(f"{i+1}: {lines[i].rstrip()[:120]}")

print("\n--- Around line 620-630 ---")
for i in range(616, 632):
    if i < len(lines):
        print(f"{i+1}: {lines[i].rstrip()[:120]}")

print("\n--- Around line 734-760 ---")
for i in range(730, 762):
    if i < len(lines):
        print(f"{i+1}: {lines[i].rstrip()[:120]}")

print("\n--- Around line 812-820 ---")
for i in range(808, 822):
    if i < len(lines):
        print(f"{i+1}: {lines[i].rstrip()[:120]}")

path = "F:\\swarm-ide\\backend\\src\\runtime\\workflow-engine.ts"
with open(path, "r", encoding="utf-8") as f:
    lines = f.read().splitlines()

changes = 0

# Fix 1: Remove duplicate 'const now = new Date();' 
for i in range(len(lines) - 1, 0, -1):
    if "const now = new Date();" in lines[i] and "const now = new Date();" in lines[i-1]:
        del lines[i]
        changes += 1
        print(f"Removed duplicate now declaration at line {i+1}")
        break

# Fix 2: Fix remaining ${errorMsg} references
for i, line in enumerate(lines):
    if "${errorMsg}" in line:
        near = " ".join(lines[max(0,i-5):min(len(lines),i+3)])
        if "failed_max_revisions" in near:
            lines[i] = line.replace("${errorMsg}", "'Max revisions exceeded'")
            changes += 1
            print(f"Fixed errorMsg -> 'Max revisions exceeded' at line {i+1}")

with open(path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print(f"\nTotal {changes} changes made")

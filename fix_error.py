import sys
path = "F:\\swarm-ide\\backend\\src\\runtime\\workflow-engine.ts"
with open(path, "r", encoding="utf-8") as f:
    lines = f.read().splitlines()
for i, line in enumerate(lines):
    if "${errorMsg}" in line:
        lines[i] = line.replace("${errorMsg}", "Max revisions exceeded")
        print(f'Fixed at line {i+1}')
with open(path, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print('Done')

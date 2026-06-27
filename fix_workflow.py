import sys, os

path = r'F:\swarm-ide\backend\src\runtime\workflow-engine.ts'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()
    lines = content.splitlines()

changes = 0

# Fix 1: Insert 'const now = new Date();' in logTaskEvent method
for i in range(len(lines)):
    if 'private async logTaskEvent' in lines[i]:
        # Find the uuid import line inside this method
        for j in range(i, min(i+10, len(lines))):
            if 'const { v4: uuid } = await import("uuid");' in lines[j]:
                lines.insert(j+1, '      const now = new Date();')
                changes += 1
                print(f'Inserted now declaration after line {j+1}')
                break
        break

# Fix 2: Fix SQL closing parens in VALUES lines - ) should be inside template
for i in range(len(lines)):
    if 'VALUES' in lines[i] and '${now}' in lines[i] and lines[i].endswith(')`'):
        old = lines[i]
        lines[i] = lines[i].replace('${now}`)', '${now})')
        if old != lines[i]:
            changes += 1
            print(f'Fixed SQL paren at line {i+1}')
    elif 'VALUES' in lines[i] and '${now}`)' in lines[i]:
        old = lines[i]
        lines[i] = lines[i].replace('${now}`)', '${now})')
        if old != lines[i]:
            changes += 1
            print(f'Fixed SQL paren at line {i+1}')

# Fix 3: Fix errorMsg references with context-appropriate messages
error_contexts = [
    ('timed_out', "Task timed out"),
    ('failed_no_agent', "No agent found for role"),
    ('failed_max_revisions', "Max revisions exceeded"),
]

for i in range(len(lines)):
    if '${errorMsg}' in lines[i]:
        near = ' '.join(lines[max(0,i-5):min(len(lines),i+3)])
        for keyword, msg in error_contexts:
            if keyword in near:
                lines[i] = lines[i].replace('${errorMsg}', f"'{msg}'")
                changes += 1
                print(f'Fixed errorMsg -> "{msg}" at line {i+1}')
                break

# Write back
output = '\n'.join(lines)
with open(path, 'w', encoding='utf-8') as f:
    f.write(output)

print(f'\nTotal {changes} changes made')

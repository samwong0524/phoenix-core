path = 'F:/swarm-ide/backend/src/runtime/workflow-engine.ts'
lines = open(path, 'r', encoding='utf-8').read().splitlines()
for i, line in enumerate(lines):
        lines[i] = line.replace("Max revisions exceeded", "\x27Max revisions exceeded\x27")
        print(f'Fixed quotes at line {i+1}')
open(path, 'w', encoding='utf-8').write('\n'.join(lines))
print('Done')

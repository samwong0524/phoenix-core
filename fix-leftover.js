const fs = require('fs');
const path = 'F:/swarm-ide/backend/src/runtime/agent-runtime.ts';
let code = fs.readFileSync(path, 'utf8');
const lines = code.split('\n');

// Remove the leftover line "return ordered.map((msg) => {"
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === 'return ordered.map((msg) => {') {
    console.log('Removing leftover at line', i, ':', lines[i]);
    lines.splice(i, 1);
    break;
  }
}

fs.writeFileSync(path, lines.join('\n'), 'utf8');
console.log('Leftover removed.');
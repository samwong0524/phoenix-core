const fs = require('fs');
const path = 'F:/swarm-ide/backend/src/runtime/agent-runtime.ts';
let code = fs.readFileSync(path, 'utf8');
const lines = code.split('\n');

// Line 709 is index 708. Replace '  });' with '  }));'
if (lines[708].trim() === '});') {
  lines[708] = lines[708].replace('});', '}));');
  console.log('Fixed line 709:', lines[708]);
} else {
  console.log('Line 709 is:', lines[708]);
  // Find the line with '  });' near the end of mapOpenRouterMessages
  for (let i = 705; i <= 715; i++) {
    if (lines[i] && lines[i].trim() === '});') {
      lines[i] = lines[i].replace('});', '}));');
      console.log('Fixed line', i+1, ':', lines[i]);
      break;
    }
  }
}

fs.writeFileSync(path, lines.join('\n'), 'utf8');
console.log('Done.');
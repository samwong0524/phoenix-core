const fs = require('fs');
const path = 'F:/swarm-ide/backend/src/runtime/agent-runtime.ts';
let code = fs.readFileSync(path, 'utf8');
const lines = code.split('\n');

// ====== FIX 1: mapOpenRouterMessages (lines 651-658) ======
const fix1Start = 651;
const fix1End = 659;
const newLines1 = [
  '  // Qwen/llama.cpp Jinja template: system messages ONLY at index 0.',
  '  // Merge ALL system messages into one at the front to avoid 400 errors.',
  '  const systemParts: string[] = [];',
  '  const nonSystem: HistoryMessage[] = [];',
  '  for (const msg of history) {',
  '    if (msg.role === "system") {',
  '      systemParts.push(msg.content as string);',
  '    } else {',
  '      nonSystem.push(msg);',
  '    }',
  '  }',
  '  const result: Array<Record<string, unknown>> = [];',
  '  if (systemParts.length > 0) {',
  '    result.push({ role: "system", content: systemParts.join("\\n\\n") });',
  '  }',
  '  return result.concat(nonSystem.map((msg) => {',
];
lines.splice(fix1Start, fix1End - fix1Start, ...newLines1);
console.log('FIX1: Replaced mapOpenRouterMessages system handling');

// ====== FIX 2: Authorization header in callFreellmapiStreaming ======
// Find the LAST occurrence of the pattern (it's in callFreellmapiStreaming)
let fixed = false;
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].includes('Authorization:') && lines[i].includes('Bearer') && lines[i].includes('apiKey')) {
    // Check context: previous line should be 'const headers'
    if (lines[i-1] && lines[i-1].includes('const headers')) {
      // Remove the Authorization line
      lines.splice(i, 1);
      // Find the closing }; of this headers block
      for (let j = i; j < lines.length; j++) {
        if (lines[j].trim() === '};') {
          // Insert conditional auth after closing brace
          lines.splice(j + 1, 0, '    if (apiKey) {', '      headers["Authorization"] = `Bearer ${apiKey}`;', '    }');
          break;
        }
      }
      fixed = true;
      console.log('FIX2: Made Authorization conditional at line', i);
      break;
    }
  }
}
if (!fixed) {
  console.log('FIX2: FAILED - could not locate header block');
}

fs.writeFileSync(path, lines.join('\n'), 'utf8');
console.log('File written successfully.');
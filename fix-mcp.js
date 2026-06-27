const fs = require('fs');
const path = 'F:/swarm-ide/backend/mcp.json';
let config = JSON.parse(fs.readFileSync(path, 'utf8'));
config.mcpServers['computer-use'].disabled = true;
config.mcpServers['tavily'].disabled = true;
config.mcpServers['chrome-devtools'].disabled = true;
fs.writeFileSync(path, JSON.stringify(config, null, 4), 'utf8');
console.log('Disabled: computer-use, tavily, chrome-devtools');
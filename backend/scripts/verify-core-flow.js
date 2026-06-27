// verify-core-flow.js â€?Verify SWARM IDE core API endpoints are working
// Run: node scripts/verify-core-flow.js
const { execSync } = require('child_process');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:3100';
let failures = 0;
let passes = 0;

function check(name, path) {
  try {
    const result = execSync(`curl -s -o /dev/null -w "%{http_code}" "${BASE}${path}"`, { encoding: 'utf8' });
    if (result.startsWith('2') || result.startsWith('3')) {
      console.log(`  âœ?${name}: ${result.trim()}`);
      passes++;
    } else {
      console.log(`  âœ?${name}: ${result.trim()}`);
      failures++;
    }
  } catch (err) {
    console.log(`  âœ?${name}: ${err.message}`);
    failures++;
  }
}

async function main() {
  console.log('\n=== Core Flow Verification ===\n');

  // 1. Health check
  check('Health', '/api/health');

  // 2. List workspaces
  check('List workspaces', '/api/workspaces');

  // 3. Get workspace ID
  let wsId = null;
  try {
    const wsRaw = execSync(`curl -s "${BASE}/api/workspaces"`, { encoding: 'utf8' });
    const wsData = JSON.parse(wsRaw);
    wsId = wsData.workspaces?.[0]?.id;
  } catch {}

  if (!wsId) {
    console.log('  âš?No workspaces found â€?skipping workspace-dependent checks');
  } else {
    // 4. List agents
    check('List agents', `/api/agents?workspaceId=${wsId}`);

    // 5. List groups
    check('List groups', `/api/groups?workspaceId=${wsId}`);

    // 6. Get messages from first group
    try {
      const groupsRaw = execSync(`curl -s "${BASE}/api/groups?workspaceId=${wsId}"`, { encoding: 'utf8' });
      const groupsData = JSON.parse(groupsRaw);
      const groupId = groupsData.groups?.[0]?.id;
      if (groupId) {
        check('Get messages', `/api/groups/${encodeURIComponent(groupId)}/messages`);
      }
    } catch {}

    // 7. Debug env
    check('Debug env', '/api/debug/env');
  }

  console.log(`\n=== Results: ${passes} passed, ${failures} failed ===\n`);
  process.exit(failures > 0 ? 1 : 0);
}

main();

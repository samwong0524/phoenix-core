// verify-core-flow.mjs â€?Verify SWARM IDE core API endpoints are working
// Run: node scripts/verify-core-flow.mjs
import { execSync } from 'child_process';

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

  check('Health', '/api/health');
  check('List workspaces', '/api/workspaces');

  let wsId = null;
  try {
    const wsRaw = execSync(`curl -s "${BASE}/api/workspaces"`, { encoding: 'utf8' });
    const wsData = JSON.parse(wsRaw);
    wsId = wsData.workspaces?.[0]?.id;
  } catch {}

  if (!wsId) {
    console.log('  âš?No workspaces found â€?skipping workspace-dependent checks');
  } else {
    check('List agents', `/api/agents?workspaceId=${wsId}`);
    check('List groups', `/api/groups?workspaceId=${wsId}`);

    try {
      const groupsRaw = execSync(`curl -s "${BASE}/api/groups?workspaceId=${wsId}"`, { encoding: 'utf8' });
      const groupsData = JSON.parse(groupsRaw);
      const groupId = groupsData.groups?.[0]?.id;
      if (groupId) {
        check('Get messages', `/api/groups/${encodeURIComponent(groupId)}/messages`);
      }
    } catch {}

    check('Debug env', '/api/debug/env');
  }

  console.log(`\n=== Results: ${passes} passed, ${failures} failed ===\n`);
  process.exit(failures > 0 ? 1 : 0);
}

main();

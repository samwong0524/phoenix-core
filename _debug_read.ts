import { getSql } from './src/db/client';
const sql = getSql();

async function main() {
  const itAdmin = '61665eaa-49f4-4964-95bd-2eb13f5251b4';
  const humanId = '5dc54b0d-087c-4f70-aa58-8bd8c1586e3d';

  const memberships = await sql`
    SELECT gm.group_id, gm.last_read_message_id, gm.joined_at, g.name
    FROM group_members gm
    LEFT JOIN groups g ON g.id = gm.group_id
    WHERE gm.user_id = ${itAdmin}::uuid
    ORDER BY gm.joined_at
  `;
  console.log('=== IT主管 memberships ===');
  console.log(JSON.stringify(memberships, null, 2));

  const humanMemberships = await sql`
    SELECT gm.group_id, gm.last_read_message_id, g.name
    FROM group_members gm
    LEFT JOIN groups g ON g.id = gm.group_id
    WHERE gm.user_id = ${humanId}::uuid
    ORDER BY gm.joined_at
  `;
  console.log('=== human memberships ===');
  console.log(JSON.stringify(humanMemberships, null, 2));

  const projGroupId = '48c382ed-8be3-4c21-8cba-63e3fd1a09c1';
  const projMembers = await sql`
    SELECT gm.user_id, a.role, gm.last_read_message_id
    FROM group_members gm
    JOIN agents a ON a.id = gm.user_id
    WHERE gm.group_id = ${projGroupId}::uuid
  `;
  console.log('=== LOSTUDIO 项目群成员 ===');
  console.log(JSON.stringify(projMembers, null, 2));

  const humanLastMsgs = await sql`
    SELECT m.group_id, m.content, m.send_time, g.name
    FROM messages m
    LEFT JOIN groups g ON g.id = m.group_id
    WHERE m.sender_id = ${humanId}::uuid
    ORDER BY m.send_time DESC LIMIT 5
  `;
  console.log('=== human 最近5条消息 ===');
  console.log(JSON.stringify(humanLastMsgs, null, 2));
}

main().catch(e => { console.error('ERROR', e); process.exit(1); });

#!/usr/bin/env node
/**
 * SWARM IDE — Command-line interface
 *
 * Usage:
 *   node bin/swarm.js <command> [options]
 *
 * Commands:
 *   status              Server health check
 *   agents <wsId>       List agents for a workspace
 *   groups <wsId>       List groups for a workspace
 *   messages <gId>      List messages in a group
 *   send <gId> <uid>    Send a text message to a group
 *   workspaces          List all workspaces
 *   workflows <wsId>    List workflows for a workspace
 *   config              Show server config
 *   watch <wsId>        Watch SSE event stream for a workspace
 *
 * Options:
 *   --port, -p          Server port (default: 3017, or SWARM_PORT env)
 *   --host              Server host (default: 127.0.0.1)
 *   --json              Raw JSON output
 *   --help, -h          Show this help
 */

const PORT = process.env.SWARM_PORT ?? 3017;
const HOST = "127.0.0.1";
const BASE = `http://${HOST}:${PORT}`;

const [cmd, ...args] = process.argv.slice(2);

function usage() {
  const help = `
SWARM IDE CLI — Usage: node bin/swarm.js <command> [options]

  Commands:
    status                Server health check
    agents <workspaceId>  List agents
    groups <workspaceId>  List groups
    messages <groupId>    List messages in a group
    send <groupId> <senderId> <text>  Send a message
    workspaces            List all workspaces
    workflows <wsId>      List workflows
    config                Show server config
    watch <workspaceId>   Subscribe to real-time events (SSE)

  Options:
    --json      Print raw JSON (no formatting)
    --help, -h  This help

  Examples:
    node bin/swarm.js status
    node bin/swarm.js agents ws-xxx --json
    node bin/swarm.js send g-xxx user-1 "hello world"
`;
  console.log(help);
}

async function getJson(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "unknown error");
    throw new Error(`${resp.status} ${resp.statusText}: ${text}`);
  }
  return resp.json();
}

function formatAgents(data) {
  if (!data.agents?.length) return "  (no agents)";
  return data.agents
    .map((a) => {
      const id = shortId(a.agentId ?? a.id);
      return `  ${id.padEnd(12)} ${(a.role ?? "").padEnd(16)} ${a.status ?? "idle"}`;
    })
    .join("\n");
}

function formatGroups(data) {
  if (!data.groups?.length) return "  (no groups)";
  return data.groups
    .map((g) => {
      const id = shortId(g.groupId ?? g.id);
      const members = g.memberIds ? ` [${g.memberIds.length} members]` : "";
      return `  ${id.padEnd(12)} ${(g.name ?? "unnamed").padEnd(16)}${members}`;
    })
    .join("\n");
}

function formatMessages(data) {
  if (!data.messages?.length) return "  (no messages)";
  return data.messages
    .slice(-20)
    .map((m) => {
      const sender = shortId(m.senderId ?? m.sender);
      const time = m.sendTime ? new Date(m.sendTime).toLocaleTimeString() : "";
      const content = (m.content ?? "").slice(0, 120);
      return `  [${time}] ${sender}: ${content}`;
    })
    .join("\n");
}

function formatWorkflows(data) {
  if (!data.workflows?.length) return "  (no workflows)";
  return data.workflows
    .map((w) => {
      const id = shortId(w.id);
      return `  ${id.padEnd(12)} ${(w.name ?? "").padEnd(24)} ${w.status ?? "draft"}`;
    })
    .join("\n");
}

function shortId(id) {
  if (!id) return "-";
  const s = String(id);
  return s.length > 10 ? s.slice(0, 10) + ".." : s;
}

function isJsonFlag(arg) {
  return arg === "--json" || arg === "-j";
}

// --- Commands ---

async function cmdStatus(json) {
  const data = await getJson(`${BASE}/api/health`);
  if (json) return console.log(JSON.stringify(data));
  console.log(`  Status: ${data.ok ? "✓ healthy" : "✗ unhealthy"}`);
}

async function cmdAgents(json) {
  const wsId = args.find((a) => !isJsonFlag(a));
  if (!wsId) {
    console.error("  Usage: swarm agents <workspaceId>");
    process.exit(1);
  }
  const data = await getJson(`${BASE}/api/agents?workspaceId=${encodeURIComponent(wsId)}`);
  if (json) return console.log(JSON.stringify(data));
  console.log("  Agents:");
  console.log(formatAgents(data));
}

async function cmdGroups(json) {
  const wsId = args.find((a) => !isJsonFlag(a));
  if (!wsId) {
    console.error("  Usage: swarm groups <workspaceId>");
    process.exit(1);
  }
  const data = await getJson(`${BASE}/api/groups?workspaceId=${encodeURIComponent(wsId)}`);
  if (json) return console.log(JSON.stringify(data));
  console.log("  Groups:");
  console.log(formatGroups(data));
}

async function cmdMessages(json) {
  const gId = args.find((a) => !isJsonFlag(a));
  if (!gId) {
    console.error("  Usage: swarm messages <groupId>");
    process.exit(1);
  }
  const data = await getJson(`${BASE}/api/groups/${encodeURIComponent(gId)}/messages`);
  if (json) return console.log(JSON.stringify(data));
  console.log("  Messages:");
  console.log(formatMessages(data));
}

async function cmdSend(json) {
  const nonFlags = args.filter((a) => !isJsonFlag(a));
  const [gId, senderId, ...textParts] = nonFlags;
  const text = textParts.join(" ");
  if (!gId || !senderId || !text) {
    console.error("  Usage: swarm send <groupId> <senderId> <message text>");
    process.exit(1);
  }
  const resp = await fetch(`${BASE}/api/groups/${encodeURIComponent(gId)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ senderId, content: text }),
  });
  const data = await resp.json();
  if (json) return console.log(JSON.stringify(data));
  console.log(`  Sent: ${data.id ?? "ok"}`);
}

async function cmdWorkspaces(json) {
  const data = await getJson(`${BASE}/api/workspaces`);
  if (json) return console.log(JSON.stringify(data));
  if (!data.workspaces?.length) {
    console.log("  (no workspaces)");
    return;
  }
  for (const w of data.workspaces) {
    const id = shortId(w.id ?? w.workspaceId);
    console.log(`  ${id.padEnd(12)} ${(w.name ?? "").padEnd(20)} ${w.createdAt ?? ""}`);
  }
}

async function cmdWorkflows(json) {
  const wsId = args.find((a) => !isJsonFlag(a));
  if (!wsId) {
    console.error("  Usage: swarm workflows <workspaceId>");
    process.exit(1);
  }
  const data = await getJson(`${BASE}/api/workflows?workspaceId=${encodeURIComponent(wsId)}`);
  if (json) return console.log(JSON.stringify(data));
  console.log("  Workflows:");
  console.log(formatWorkflows(data));
}

async function cmdConfig(json) {
  const data = await getJson(`${BASE}/api/config`);
  if (json) return console.log(JSON.stringify(data));
  console.log("  Config:");
  for (const [key, value] of Object.entries(data)) {
    const val = typeof value === "object" ? JSON.stringify(value) : String(value);
    console.log(`  ${key}: ${val}`);
  }
}

async function cmdWatch() {
  const wsId = args.find((a) => !isJsonFlag(a));
  if (!wsId) {
    console.error("  Usage: swarm watch <workspaceId>");
    process.exit(1);
  }
  console.error(`  Watching events for workspace ${wsId}... (Ctrl+C to stop)`);

  const url = `${BASE}/api/ui-stream?workspaceId=${encodeURIComponent(wsId)}&channelId=cli`;
  try {
    const resp = await fetch(url);
    if (!resp.ok || !resp.body) {
      console.error(`  Connection failed: ${resp.status}`);
      process.exit(1);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const payload = line.slice(6).trim();
          if (payload) console.log(payload);
        }
      }
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error(`  Connection error: ${err.message}`);
    }
  }
}

// --- Main ---

async function main() {
  const json = args.some((a) => isJsonFlag(a));

  switch (cmd) {
    case "status":
      return cmdStatus(json);
    case "agents":
      return cmdAgents(json);
    case "groups":
      return cmdGroups(json);
    case "messages":
      return cmdMessages(json);
    case "send":
      return cmdSend(json);
    case "workspaces":
      return cmdWorkspaces(json);
    case "workflows":
      return cmdWorkflows(json);
    case "config":
      return cmdConfig(json);
    case "watch":
      return cmdWatch();
    case "--help":
    case "-h":
    case undefined:
      return usage();
    default:
      console.error(`  Unknown command: ${cmd}`);
      usage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`  Error: ${err.message}`);
  process.exit(1);
});

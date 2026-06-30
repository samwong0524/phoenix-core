import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { invalidateSkillCache } from "@/runtime/skill-loader";

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

function parseFrontmatter(text: string) {
  const result: Record<string, unknown> = {};
  let currentListKey: string | null = null;
  let inMetadata = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const listMatch = line.match(/^\s*-\s*(.+)$/);
    if (listMatch && currentListKey) {
      const item = parseScalar(listMatch[1]);
      const existing = result[currentListKey] as unknown[];
      const list = Array.isArray(existing) ? existing : [];
      list.push(item);
      result[currentListKey] = list;
      continue;
    }

    if (inMetadata && /^\s+/.test(rawLine)) {
      const metaMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (metaMatch) {
        result.metadata = result.metadata ?? {};
        const metaValue = metaMatch[2] ?? "";
        if (metaValue.startsWith("[") && metaValue.endsWith("]")) {
          const inner = metaValue.slice(1, -1).trim();
          (result.metadata as Record<string, unknown>)[metaMatch[1]] =
            inner.length > 0 ? parseInlineList(metaValue) : [];
        } else {
          (result.metadata as Record<string, unknown>)[metaMatch[1]] = parseScalar(metaValue);
        }
      }
      continue;
    }

    const kvMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!kvMatch) continue;

    const key = kvMatch[1];
    const value = kvMatch[2] ?? "";

    currentListKey = null;
    inMetadata = false;

    if (!value) {
      if (key === "metadata") {
        result.metadata = result.metadata ?? {};
        inMetadata = true;
        continue;
      }
      currentListKey = key;
      continue;
    }

    if (key === "allowed-tools" || key === "requires") {
      const inlineList = parseInlineList(value);
      result[key] = inlineList ?? [parseScalar(value)];
      continue;
    }

    if (key === "metadata") {
      result.metadata = result.metadata ?? {};
      continue;
    }

    result[key] = parseScalar(value);
  }

  if (!result.name || !result.description) return null;
  return result;
}

function parseScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineList(value: string): string[] | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((item) => parseScalar(item))
    .filter((item) => item.length > 0);
}

async function findSkillFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results: string[] = [];

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = await findSkillFiles(fullPath);
        results.push(...nested);
        return;
      }
      if (entry.isFile() && entry.name === "SKILL.md") {
        results.push(fullPath);
      }
    })
  );

  return results;
}

function getSkillsDir(): string {
  const envDir = process.env.AGENT_SKILLS_DIR;
  const candidates = [
    envDir ? path.resolve(envDir) : null,
    path.resolve(process.cwd(), "skills"),
    path.resolve(process.cwd(), "backend", "skills"),
  ].filter((v): v is string => Boolean(v));
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0];
}

export async function GET() {
  const skillsDir = getSkillsDir();
  if (!existsSync(skillsDir)) {
    return NextResponse.json({ skills: [] });
  }

  const skillFiles = await findSkillFiles(skillsDir);
  const skills = await Promise.all(
    skillFiles.map(async (file) => {
      const raw = await fs.readFile(file, "utf-8");
      const match = raw.match(FRONTMATTER_RE);
      if (!match) return null;

      const frontmatter = parseFrontmatter(match[1]);
      if (!frontmatter) return null;

      const meta = frontmatter.metadata as Record<string, unknown> | undefined;
      const rolesRaw = meta?.roles;
      const roles: string[] = Array.isArray(rolesRaw)
        ? rolesRaw as string[]
        : typeof rolesRaw === "string"
          ? rolesRaw.split(",").map((s) => s.trim())
          : [];

      return {
        name: frontmatter.name,
        description: frontmatter.description,
        autoLoad: parseBoolean(frontmatter["auto-load"] ?? frontmatter.auto_load),
        roles,
        license: (frontmatter.license as string | undefined) ?? null,
        skillPath: file,
        skillDir: path.dirname(file),
      };
    })
  );

  return NextResponse.json({
    skills: skills.filter(Boolean).sort((a, b) => (b?.autoLoad ? 1 : 0) - (a?.autoLoad ? 1 : 0)),
  });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const skillName = searchParams.get("name");
  if (!skillName) {
    return NextResponse.json({ error: "Missing skill name" }, { status: 400 });
  }

  // Validate skill name
  if (!/^[a-z0-9_-]+$/.test(skillName)) {
    return NextResponse.json({ error: "Invalid skill name" }, { status: 400 });
  }

  const skillsDir = getSkillsDir();
  const skillDir = path.join(skillsDir, skillName);
  if (!existsSync(skillDir)) {
    return NextResponse.json({ error: `Skill "${skillName}" not found` }, { status: 404 });
  }

  await fs.rm(skillDir, { recursive: true, force: true });
  invalidateSkillCache();
  return NextResponse.json({ ok: true, deleted: skillName });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const skillName = body?.name;
  const autoLoad = body?.autoLoad;

  if (!skillName || typeof autoLoad !== "boolean") {
    return NextResponse.json({ error: "Missing name or autoLoad" }, { status: 400 });
  }
  if (!/^[a-z0-9_-]+$/.test(skillName)) {
    return NextResponse.json({ error: "Invalid skill name" }, { status: 400 });
  }

  const skillsDir = getSkillsDir();
  const skillPath = path.join(skillsDir, skillName, "SKILL.md");
  if (!existsSync(skillPath)) {
    return NextResponse.json({ error: `Skill "${skillName}" not found` }, { status: 404 });
  }

  const raw = await fs.readFile(skillPath, "utf-8");
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return NextResponse.json({ error: "Invalid skill file" }, { status: 500 });
  }

  // Replace auto-load line in frontmatter
  const newFrontmatter = match[1]
    .replace(/^(auto-load|auto_load)\s*:.*$/im, `auto-load: ${autoLoad}`);
  const newContent = `---\n${newFrontmatter}\n---\n${match[2]}`;

  await fs.writeFile(skillPath, newContent, "utf-8");
  invalidateSkillCache();
  return NextResponse.json({ ok: true, name: skillName, autoLoad });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { action, name, source_url, query } = body ?? {};

  if (action === "search_remote") {
    return searchRemoteSkills(query || "");
  }

  if (action === "install_remote") {
    if (!name || !source_url) {
      return NextResponse.json({ error: "Missing name or source_url" }, { status: 400 });
    }
    return installRemoteSkill(name, source_url);
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// ---------------------------------------------------------------------------
// Multi-source skill search
// ---------------------------------------------------------------------------

interface RemoteSkillResult {
  name: string;
  description: string;
  source_url: string;
  repo: string;
  trust_level: "official" | "community" | "unknown";
  source: string; // "github" | "lobehub" | "clawhub" | "skills.sh"
}

async function searchRemoteSkills(query: string) {
  if (!query || query.trim().length < 2) {
    return NextResponse.json({ error: "Query must be at least 2 characters" }, { status: 400 });
  }

  const q = query.trim();
  const githubToken = process.env.GITHUB_TOKEN;

  // Run all sources in parallel with individual timeouts
  const results = await Promise.allSettled([
    searchGitHub(q, githubToken),
    searchLobeHub(q),
    searchClawHub(q),
    searchSkillsSh(q),
  ]);

  // Merge and deduplicate
  const seen = new Set<string>();
  const merged: RemoteSkillResult[] = [];

  for (const r of results) {
    if (r.status === "rejected") continue;
    for (const item of r.value) {
      const key = `${item.source}:${item.name}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }

  // Sort: official/trusted first, then by name
  merged.sort((a, b) => {
    const order = { official: 0, community: 1, unknown: 2 };
    const diff = (order[a.trust_level] ?? 1) - (order[b.trust_level] ?? 1);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });

  if (merged.length === 0) {
    return NextResponse.json({
      skills: [],
      total: 0,
      message: githubToken
        ? "未找到匹配的技能。尝试不同关键词。"
        : "GitHub 代码搜索需要认证。请设置 GITHUB_TOKEN 环境变量。",
    });
  }

  return NextResponse.json({ skills: merged.slice(0, 30), total: merged.length });
}

// -- GitHub Code Search + known taps --
async function searchGitHub(query: string, githubToken: string | undefined): Promise<RemoteSkillResult[]> {
  const results: RemoteSkillResult[] = [];
  const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;

  if (githubToken) {
    const searchQueries = [
      { q: `filename:SKILL.md ${query}`, trust: "community" as const },
      { q: `filename:SKILL.md ${query} org:anthropics`, trust: "official" as const },
      { q: `filename:SKILL.md ${query} org:openai`, trust: "official" as const },
    ];

    for (const { q, trust } of searchQueries) {
      try {
        const url = `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=5`;
        const res = await fetchWithTimeout(url, { headers });
        if (!res.ok) continue;
        const data = await res.json();
        if (!data.items) continue;

        for (const item of data.items) {
          const repo = item.repository?.full_name;
          const fileUrl = item.html_url;
          if (!repo || !fileUrl) continue;

          const rawUrl = toRawGitHubUrl(fileUrl);
          const skillName = extractSkillName(item.path);

          results.push({
            name: skillName,
            description: `from ${repo}`,
            source_url: rawUrl,
            repo,
            trust_level: trust,
            source: "github",
          });

          if (results.length >= 8) break;
        }
        if (results.length >= 8) break;
      } catch {
        continue;
      }
    }
  }

  // Fallback: search known repos without token
  if (results.length === 0) {
    const knownRepos = [
      "anthropics/skills", "openai/skills", "huggingface/skills",
      "VoltAgent/awesome-agent-skills", "garrytan/gstack", "MiniMax-AI/cli",
    ];
    for (const repo of knownRepos) {
      try {
        const url = `https://api.github.com/repos/${repo}/contents/`;
        const res = await fetchWithTimeout(url, { headers });
        if (!res.ok) continue;
        const contents = await res.json();
        if (!Array.isArray(contents)) continue;

        for (const entry of contents) {
          if (entry.type !== "dir") continue;
          const dirName = entry.name.toLowerCase();
          if (!dirName.includes("skill") && !dirName.includes("plugin") && !dirName.includes("tool")) continue;

          const dirUrl = `https://api.github.com/repos/${repo}/contents/${entry.path}`;
          const dirRes = await fetchWithTimeout(dirUrl, { headers });
          if (!dirRes.ok) continue;
          const dirContents = await dirRes.json();
          if (!Array.isArray(dirContents)) continue;

          for (const item of dirContents) {
            if (item.name !== "SKILL.md" && item.name !== "README.md") continue;

            let desc = `from ${repo}/${entry.name}`;
            if (item.name === "SKILL.md" && item.url) {
              try {
                const contentRes = await fetchWithTimeout(item.url, { headers });
                if (contentRes.ok) {
                  const contentData = await contentRes.json();
                  const content = Buffer.from(contentData.content, "base64").toString("utf-8");
                  const descMatch = content.match(/description:\s*(.+)/i);
                  if (descMatch) desc = descMatch[1].trim();
                }
              } catch { /* skip */ }
            }

            const rawUrl = `https://raw.githubusercontent.com/${repo}/main/${entry.path}/SKILL.md`;
            results.push({
              name: entry.name,
              description: desc,
              source_url: rawUrl,
              repo,
              trust_level: "community",
              source: "github",
            });

            if (results.length >= 8) break;
          }
          if (results.length >= 8) break;
        }
        if (results.length >= 8) break;
      } catch {
        continue;
      }
    }
  }

  return results;
}

// -- LobeHub (14,500+ agents) --
async function searchLobeHub(query: string): Promise<RemoteSkillResult[]> {
  try {
    const res = await fetchWithTimeout("https://chat-agents.lobehub.com/index.json", {}, 5000);
    if (!res.ok) return [];
    const data = await res.json();

    const queryLower = query.toLowerCase();
    const agents = data?.agents ?? data;
    if (!Array.isArray(agents)) return [];

    const results: RemoteSkillResult[] = [];
    for (const agent of agents) {
      const meta = agent.meta ?? agent;
      const title = meta.title ?? agent.identifier ?? "";
      const desc = meta.description ?? "";
      const tags = Array.isArray(meta.tags) ? meta.tags : [];
      const searchable = `${title} ${desc} ${tags.join(" ")}`.toLowerCase();

      if (searchable.includes(queryLower)) {
        const identifier = agent.identifier ?? title.toLowerCase().replace(/\s+/g, "-");
        results.push({
          name: identifier,
          description: desc.substring(0, 200),
          source_url: `https://chat-agents.lobehub.com/${identifier}.json`,
          repo: "lobehub/lobe-chat-agents",
          trust_level: "community",
          source: "lobehub",
        });

        if (results.length >= 8) break;
      }
    }

    return results;
  } catch {
    return [];
  }
}

// -- ClawHub --
async function searchClawHub(query: string): Promise<RemoteSkillResult[]> {
  try {
    const res = await fetchWithTimeout(
      `https://clawhub.ai/api/v1/skills?search=${encodeURIComponent(query)}&limit=8`,
      {}, 5000
    );
    if (!res.ok) return [];
    const data = await res.json();

    const items = (data.items ?? data) as Array<{
      slug?: string;
      displayName?: string;
      name?: string;
      summary?: string;
      description?: string;
      tags?: string[] | Record<string, unknown>;
    }>;
    if (!Array.isArray(items)) return [];

    return items.map((item) => {
      const slug = item.slug ?? "unknown";
      const displayName = item.displayName ?? item.name ?? slug;
      const summary = item.summary ?? item.description ?? "";
      return {
        name: slug,
        description: summary.substring(0, 200),
        source_url: `https://clawhub.ai/skills/${slug}`,
        repo: "clawhub",
        trust_level: "community",
        source: "clawhub",
      };
    });
  } catch {
    return [];
  }
}

// -- skills.sh --
async function searchSkillsSh(query: string): Promise<RemoteSkillResult[]> {
  try {
    const res = await fetchWithTimeout(
      `https://skills.sh/api/search?q=${encodeURIComponent(query)}&limit=8`,
      {}, 5000
    );
    if (!res.ok) return [];
    const data = await res.json();

    const skills = (data.skills ?? data) as Array<{
      id?: string;
      name?: string;
      source?: string;
      skillId?: string;
      installs?: number;
    }>;
    if (!Array.isArray(skills)) return [];

    return skills.map((item) => {
      const canonical = item.id ?? "";
      const parts = canonical.split("/");
      const repo = item.source ?? (parts.length >= 2 ? `${parts[0]}/${parts[1]}` : "unknown");
      const skillPath = item.skillId ?? (parts.length >= 3 ? parts.slice(2).join("/") : "");
      const name = item.name ?? skillPath.split("/").pop() ?? "unknown";
      const installs = typeof item.installs === "number" ? ` · ${item.installs.toLocaleString()} installs` : "";

      return {
        name,
        description: `Indexed by skills.sh from ${repo}${installs}`,
        source_url: `https://skills.sh/${canonical}`,
        repo,
        trust_level: "community",
        source: "skills.sh",
      };
    });
  } catch {
    return [];
  }
}

// -- Utility: fetch with timeout --
async function fetchWithTimeout(url: string, init: RequestInit, timeout = 4000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function installRemoteSkill(name: string, sourceUrl: string) {
  if (!/^[a-z0-9_-]+$/.test(name)) {
    return NextResponse.json({ error: "Invalid skill name" }, { status: 400 });
  }

  const urlObj = (() => { try { return new URL(sourceUrl); } catch { return null; } })();
  if (!urlObj) {
    return NextResponse.json({ error: "Invalid source URL" }, { status: 400 });
  }

  // Determine source type and validate
  const hostname = urlObj.hostname;
  const isGitHub = hostname.endsWith("github.com") || hostname.endsWith("githubusercontent.com");
  const isLobeHub = hostname === "chat-agents.lobehub.com";
  const isClawHub = hostname === "clawhub.ai";
  const isSkillsSh = hostname === "skills.sh";

  if (!isGitHub && !isLobeHub && !isClawHub && !isSkillsSh) {
    return NextResponse.json({ error: "Only GitHub, LobeHub, ClawHub, and skills.sh sources are allowed" }, { status: 400 });
  }

  const skillsDir = getSkillsDir();
  const skillDir = path.join(skillsDir, name);
  const skillPath = path.join(skillDir, "SKILL.md");

  if (existsSync(skillPath)) {
    return NextResponse.json({ error: `Skill "${name}" already installed` }, { status: 409 });
  }

  let content: string;

  if (isLobeHub) {
    // LobeHub: download JSON and convert to SKILL.md
    content = await convertLobeHubAgent(sourceUrl, name);
  } else if (isClawHub) {
    // ClawHub: redirect to skills.sh-style install or fetch from API
    content = await fetchClawHubSkill(sourceUrl, name);
  } else if (isSkillsSh) {
    // skills.sh: resolve the actual GitHub raw URL from the detail page
    content = await resolveSkillsShInstall(sourceUrl, name);
  } else {
    // GitHub raw URL
    content = await fetchRawSkill(sourceUrl);
  }

  // Validate frontmatter
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return NextResponse.json({ error: "Invalid SKILL.md format (missing frontmatter)" }, { status: 400 });
  }
  const meta = parseFrontmatter(match[1]);
  if (!meta || !meta.name || !meta.description) {
    return NextResponse.json({ error: "Invalid frontmatter (missing name or description)" }, { status: 400 });
  }

  // Security scan
  const scanResult = scanSkillContent(content);
  if (!scanResult.safe) {
    return NextResponse.json({ error: `Security scan failed: ${scanResult.reason}` }, { status: 403 });
  }

  // Create directory and save
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(skillPath, content, "utf-8");

  return NextResponse.json({ ok: true, name, path: skillPath });
}

async function fetchRawSkill(sourceUrl: string): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error(`Failed to download: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

async function convertLobeHubAgent(sourceUrl: string, name: string): Promise<string> {
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch LobeHub agent: ${res.status} ${res.statusText}`);
  }
  const agent = await res.json();
  const meta = agent.meta ?? agent;
  const title = meta.title ?? name;
  const description = meta.description ?? "LobeHub agent";
  const systemPrompt = meta.systemPrompt ?? agent.systemRole ?? "";

  // Convert to SKILL.md format
  const frontmatter = `---
name: ${name}
description: ${description}
auto-load: false
source: lobehub
license: MIT
metadata:
  roles: []
---`;

  const body = systemPrompt
    ? `\n## System Prompt\n\n${systemPrompt}\n`
    : `\n## Description\n\n${description}\n`;

  return `${frontmatter}\n${body}`;
}

async function fetchClawHubSkill(sourceUrl: string, name: string): Promise<string> {
  // ClawHub: fetch from API and convert to SKILL.md
  const slug = sourceUrl.split("/").pop() ?? name;
  const apiUrl = `https://clawhub.ai/api/v1/skills/${slug}`;
  const res = await fetch(apiUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch ClawHub skill: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  const displayName = data.displayName ?? data.name ?? slug;
  const summary = data.summary ?? data.description ?? "ClawHub skill";

  const frontmatter = `---
name: ${name}
description: ${summary}
auto-load: false
source: clawhub
metadata:
  roles: []
---

## Description

${summary}
`;
  return frontmatter;
}

async function resolveSkillsShInstall(sourceUrl: string, _name: string): Promise<string> {
  // skills.sh URLs point to detail pages, not raw SKILL.md
  // Try to find the raw GitHub URL from the canonical identifier
  // Format: https://skills.sh/owner/repo/skill-path
  const parts = sourceUrl.replace("https://skills.sh/", "").split("/");
  if (parts.length >= 3) {
    const owner = parts[0];
    const repo = parts[1];
    const skillPath = parts.slice(2).join("/");

    // Try common locations for SKILL.md
    const candidates = [
      `https://raw.githubusercontent.com/${owner}/${repo}/main/${skillPath}/SKILL.md`,
      `https://raw.githubusercontent.com/${owner}/${repo}/main/skills/${skillPath}/SKILL.md`,
      `https://raw.githubusercontent.com/${owner}/${repo}/main/.agents/skills/${skillPath}/SKILL.md`,
      `https://raw.githubusercontent.com/${owner}/${repo}/main/.claude/skills/${skillPath}/SKILL.md`,
    ];

    for (const url of candidates) {
      try {
        const res = await fetch(url);
        if (res.ok) return res.text();
      } catch {
        continue;
      }
    }
  }

  throw new Error("Could not resolve SKILL.md from skills.sh URL");
}

function toRawGitHubUrl(url: string): string {
  // github.com/owner/repo/blob/branch/path/SKILL.md
  // → raw.githubusercontent.com/owner/repo/branch/path/SKILL.md
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)/);
  if (m) {
    return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4]}`;
  }
  return url;
}

function extractSkillName(filePath: string): string {
  // skills/skill-name/SKILL.md → skill-name
  const parts = filePath.split("/");
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === "skills" || parts[i] === "skill") {
      return parts[i + 1].replace(/[^a-z0-9_-]/gi, "").toLowerCase();
    }
  }
  // Fallback: use parent directory name
  const dirName = path.basename(path.dirname(filePath));
  return dirName.replace(/[^a-z0-9_-]/gi, "").toLowerCase();
}

function scanSkillContent(content: string): { safe: boolean; reason?: string } {
  const dangerous = [
    { pattern: /\beval\s*\(/i, reason: "eval() detected" },
    { pattern: /\bexec\s*\(/i, reason: "exec() detected" },
    { pattern: /\bsubprocess\b/i, reason: "subprocess import detected" },
    { pattern: /\bchild_process\b/i, reason: "child_process detected" },
    { pattern: /http:\/\/127\./i, reason: "localhost access detected" },
    { pattern: /http:\/\/10\./i, reason: "internal network access detected" },
    { pattern: /http:\/\/192\.168\./i, reason: "internal network access detected" },
    { pattern: /<script/i, reason: "script tag detected" },
    { pattern: /on(?:load|error|click)\s*=/i, reason: "inline event handler detected" },
  ];

  for (const { pattern, reason } of dangerous) {
    if (pattern.test(content)) return { safe: false, reason };
  }
  return { safe: true };
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y";
}

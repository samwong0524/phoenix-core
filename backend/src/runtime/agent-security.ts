import { getSkillLoader } from "./skill-loader";

export const TRUSTED_SKILL_REPOS = [
  "openai/skills",
  "anthropics/skills",
  "massive/MassiveToolSkills",
];

/** Search GitHub code for SKILL.md files matching the query */
export async function searchGitHubSkills(query: string, maxResults: number): Promise<Array<{
  name: string;
  description: string;
  source_url: string;
  trust_level: string;
  repo: string;
}>> {
  const allResults: Array<{ name: string; description: string; source_url: string; trust_level: string; repo: string }> = [];

  // First, search trusted repos
  for (const repo of TRUSTED_SKILL_REPOS) {
    try {
      const url = `https://api.github.com/search/code?q=SKILL.md+${encodeURIComponent(query)}+repo:${repo}&per_page=${maxResults}`;
      const res = await fetch(url, {
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "SWARM-IDE/1.0",
        },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue; // skip repo if not accessible
      const data = await res.json();
      for (const item of (data.items ?? [])) {
        allResults.push({
          name: item.name || item.path?.split("/").pop() || "unknown",
          description: `Skill from trusted repo ${item.repository?.full_name}`,
          source_url: item.html_url || item.git_url || "",
          trust_level: "trusted",
          repo: item.repository?.full_name || repo,
        });
      }
      if (allResults.length >= maxResults) break;
    } catch {
      // skip unavailable repos
    }
  }

  // Then, search GitHub globally
  if (allResults.length < maxResults) {
    const remaining = maxResults - allResults.length;
    try {
      const url = `https://api.github.com/search/code?q=SKILL.md+${encodeURIComponent(query)}&per_page=${remaining}`;
      const res = await fetch(url, {
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "User-Agent": "SWARM-IDE/1.0",
        },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        for (const item of (data.items ?? [])) {
          // Skip already-added from trusted repos
          if (allResults.some(r => r.source_url === item.html_url)) continue;
          allResults.push({
            name: item.name || item.path?.split("/").pop() || "unknown",
            description: `Skill from ${item.repository?.full_name}`,
            source_url: item.html_url || item.git_url || "",
            trust_level: "community",
            repo: item.repository?.full_name || "unknown",
          });
        }
      }
    } catch {
      // GitHub search unavailable
    }
  }

  if (allResults.length === 0) {
    // Fallback: search local skills
    return searchLocalSkills(query);
  }

  return allResults.slice(0, maxResults);
}

/** Search local skills directory */
export async function searchLocalSkills(query: string): Promise<Array<{
  name: string;
  description: string;
  source_url: string;
  trust_level: string;
  repo: string;
}>> {
  const loader = await getSkillLoader();
  const allSkills = await loader.listSkills();
  const skillsMeta = await loader.listAutoLoadSkills();
  const queryLower = query.toLowerCase();

  const results: Array<{ name: string; description: string; source_url: string; trust_level: string; repo: string }> = [];
  for (const skill of skillsMeta) {
    if (skill.name.toLowerCase().includes(queryLower) ||
        skill.description.toLowerCase().includes(queryLower)) {
      results.push({
        name: skill.name,
        description: skill.description,
        source_url: `local://${skill.skillDir}`,
        trust_level: "local",
        repo: "local",
      });
    }
  }
  return results;
}

/** Convert a GitHub URL to a raw content URL */
export function toRawGitHubUrl(url: string): string {
  // Already a raw URL
  if (url.startsWith("https://raw.githubusercontent.com")) return url;

  // github.com/blob/... → raw.githubusercontent.com
  const blobMatch = url.match(/https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)/);
  if (blobMatch) {
    return `https://raw.githubusercontent.com/${blobMatch[1]}/${blobMatch[2]}/${blobMatch[3]}`;
  }

  // github.com/.../tree/... → not a file URL, try to append SKILL.md
  const treeMatch = url.match(/https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)(.*)/);
  if (treeMatch) {
    return `https://raw.githubusercontent.com/${treeMatch[1]}/${treeMatch[2]}/${treeMatch[3]}${treeMatch[4]}/SKILL.md`;
  }

  return url;
}

/** Fetch SKILL.md content from a URL */
export async function fetchSkillContent(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "Accept": "text/plain",
      "User-Agent": "SWARM-IDE/1.0",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch skill from ${url}: HTTP ${res.status}`);
  }
  return res.text();
}

/** Security scan: reject skill content with dangerous patterns */
export function scanSkillContent(content: string): { ok: true } | { ok: false; reason: string } {
  const dangerousPatterns: Array<{ re: RegExp; reason: string }> = [
    { re: /\bexec\s*\(/i, reason: "contains exec() call" },
    { re: /\beval\s*\(/i, reason: "contains eval() call" },
    { re: /\bbash\b.*\|.*\bnode\b/i, reason: "contains bash piping to node" },
    { re: /fetch\s*\(\s*["']https?:\/\/(127\.|localhost|0\.0\.0\.0)/i, reason: "contains fetch to internal IP" },
    { re: /http:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|10\.|192\.168\.)/i, reason: "contains internal network URL" },
    { re: /```bash\n.*?(exec|eval|curl.*\|.*sh)/is, reason: "contains dangerous bash code block" },
    { re: /```python\n.*?(exec|eval|__import__|subprocess)/is, reason: "contains dangerous python code block" },
  ];
  for (const { re, reason } of dangerousPatterns) {
    if (re.test(content)) {
      return { ok: false, reason };
    }
  }
  return { ok: true };
}

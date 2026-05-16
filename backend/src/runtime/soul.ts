import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

const PROMPTS_DIR = path.join(process.cwd(), "src", "prompts");

async function readMd(filename: string): Promise<string | null> {
  const filePath = path.join(PROMPTS_DIR, filename);
  if (!existsSync(filePath)) return null;
  return fs.readFile(filePath, "utf-8");
}

let cachedSoul: string | null = null;
const cachedRoles = new Map<string, string>();

export async function getSoul(): Promise<string> {
  if (cachedSoul !== null) return cachedSoul;
  const content = await readMd("soul.md");
  cachedSoul = content ?? "";
  return cachedSoul;
}

export async function getRoleTemplate(role: string): Promise<string> {
  if (cachedRoles.has(role)) return cachedRoles.get(role)!;
  const filename = `${role.toLowerCase()}.md`;
  const content = await readMd(`roles/${filename}`);
  if (content) cachedRoles.set(role, content);
  return content ?? "";
}

// Known behavior roles — these have dedicated templates in roles/
const BEHAVIOR_ROLES = [
  "coordinator", "worker", "assistant",
  "reviewer", "researcher", "specialist",
  "creator", "editor",
];

// Keyword → behavior role mapping.
// Used when an arbitrary role name (e.g. "frontend", "PM") is passed
// to create(). Maps it to the closest behavior template.
const ROLE_KEYWORDS: [string, string][] = [
  // coordinator
  ["lead", "coordinator"],
  ["manage", "coordinator"],
  ["coord", "coordinator"],
  ["director", "coordinator"],
  ["cto", "coordinator"],
  ["pm", "coordinator"],
  ["supervise", "coordinator"],
  ["oversee", "coordinator"],
  ["product", "coordinator"],
  ["manager", "coordinator"],
  ["coordinator", "coordinator"],
  // reviewer
  ["review", "reviewer"],
  ["reviewer", "reviewer"],
  ["audit", "reviewer"],
  ["qa", "reviewer"],
  ["test", "reviewer"],
  ["quality", "reviewer"],
  ["inspector", "reviewer"],
  // researcher
  ["research", "researcher"],
  ["researcher", "researcher"],
  ["analyst", "researcher"],
  ["analyst", "researcher"],
  ["investigator", "researcher"],
  ["search", "researcher"],
  ["explorer", "researcher"],
  // specialist (domain experts)
  ["developer", "specialist"],
  ["engineer", "specialist"],
  ["coder", "specialist"],
  ["programmer", "specialist"],
  ["designer", "specialist"],
  ["architect", "specialist"],
  ["frontend", "specialist"],
  ["backend", "specialist"],
  ["fullstack", "specialist"],
  ["full-stack", "specialist"],
  ["mobile", "specialist"],
  ["data", "specialist"],
  ["devops", "specialist"],
  ["security", "specialist"],
  ["infra", "specialist"],
  ["database", "specialist"],
  ["ml", "specialist"],
  ["ai", "specialist"],
  ["game", "specialist"],
  ["ui", "specialist"],
  ["ux", "specialist"],
  ["seo", "specialist"],
  ["marketing", "specialist"],
  ["sales", "specialist"],
  ["support", "specialist"],
  // Chinese keywords
  ["全栈", "specialist"],
  ["前端", "specialist"],
  ["后端", "specialist"],
  ["设计", "specialist"],
  ["工程师", "specialist"],
  // creator
  ["content", "creator"],
  ["writer", "creator"],
  ["copywriter", "creator"],
  ["copy", "creator"],
  ["script", "creator"],
  ["creative", "creator"],
  ["operation", "creator"],
  ["operations", "creator"],
  ["social", "creator"],
  ["social media", "creator"],
  ["运营", "creator"],
  ["策划", "creator"],
  ["文案", "creator"],
  // editor
  ["editing", "editor"],
  ["editor", "editor"],
  ["video", "editor"],
  ["post", "editor"],
  ["剪辑", "editor"],
  ["后期", "editor"],
];

/**
 * Resolve an arbitrary role name to a known behavior role.
 * 1. Exact match → return as-is
 * 2. Keyword match in role/guidance → return matched behavior role
 * 3. Fallback → "worker" (safe default: execute when asked, don't coordinate)
 */
export function resolveBehaviorRole(role: string, guidance?: string): string {
  const lower = role.toLowerCase().trim();
  const guide = (guidance ?? "").toLowerCase().trim();
  const searchTarget = `${lower} ${guide}`;

  // 1. Exact match
  if (BEHAVIOR_ROLES.includes(lower)) return lower;

  // 2. Keyword match (longer keywords first to avoid partial matches)
  const sorted = [...ROLE_KEYWORDS].sort((a, b) => b[0].length - a[0].length);
  for (const [keyword, behavior] of sorted) {
    if (searchTarget.includes(keyword)) return behavior;
  }

  // 3. Fallback — worker is the safest default
  return "worker";
}

export async function buildSystemPrompt(
  role: string,
  extraGuidance?: string
): Promise<string> {
  const soul = await getSoul();
  const behaviorRole = resolveBehaviorRole(role, extraGuidance);
  const roleTemplate = await getRoleTemplate(behaviorRole);

  const parts = [soul, roleTemplate, extraGuidance ?? ""].filter((p) => p.trim());
  return parts.join("\n\n---\n\n");
}

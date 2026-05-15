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

export async function buildSystemPrompt(role: string, extraGuidance?: string): Promise<string> {
  const soul = await getSoul();
  const roleTemplate = await getRoleTemplate(role);

  const parts = [soul, roleTemplate, extraGuidance ?? ""].filter((p) => p.trim());
  return parts.join("\n\n---\n\n");
}

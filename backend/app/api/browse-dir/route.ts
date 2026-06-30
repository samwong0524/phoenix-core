export const runtime = "nodejs";

import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * GET /api/browse-dir?path=<dir>
 *
 * Browse local filesystem directories for the folder picker UI.
 * - No path param → return safe roots (AGENT_WORKDIR, home dir)
 * - With path param → return subdirectories of that path
 *
 * Only returns directories (not files) since we're picking a working directory.
 *
 * Security: paths are restricted to safe roots to prevent full filesystem enumeration.
 */

/** Directories that are always blocked from browsing */
const BLOCKED_PREFIXES = new Set([
  "System Volume Information",
  "Windows",
  "$Recycle.Bin",
  "$SysReset",
  "Recovery",
  "ProgramData",
]);

const BLOCKED_PATH_PREFIXES = [
  "C:\\Windows",
  "/proc",
  "/sys",
  "/dev",
  "/etc",
  "/var",
  "/usr",
  "/boot",
];

function isPathAllowed(resolved: string): boolean {
  const normalized = resolved.replace(/\\/g, "/").toLowerCase();
  for (const blocked of BLOCKED_PATH_PREFIXES) {
    if (normalized.startsWith(blocked.replace(/\\/g, "/").toLowerCase())) {
      return false;
    }
  }
  return true;
}

function getSafeRoots(): Array<{ name: string; fullPath: string }> {
  const roots: Array<{ name: string; fullPath: string }> = [];
  const seen = new Set<string>();

  // AGENT_WORKDIR is the primary safe root
  const workdir = process.env.AGENT_WORKDIR;
  if (workdir && existsSync(workdir)) {
    const resolved = path.resolve(workdir);
    roots.push({ name: "Workspace", fullPath: resolved });
    seen.add(resolved.toLowerCase());
  }

  // User home directory
  const home = os.homedir();
  if (home && existsSync(home) && !seen.has(home.toLowerCase())) {
    roots.push({ name: "Home", fullPath: home });
    seen.add(home.toLowerCase());
  }

  // Desktop and Documents as convenient shortcuts
  const desktop = path.join(home, "Desktop");
  if (existsSync(desktop) && !seen.has(desktop.toLowerCase())) {
    roots.push({ name: "Desktop", fullPath: desktop });
    seen.add(desktop.toLowerCase());
  }
  const docs = path.join(home, "Documents");
  if (existsSync(docs) && !seen.has(docs.toLowerCase())) {
    roots.push({ name: "Documents", fullPath: docs });
    seen.add(docs.toLowerCase());
  }

  return roots;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const reqPath = url.searchParams.get("path")?.trim();

  // No path → return safe roots (not all system drives)
  if (!reqPath) {
    const roots = getSafeRoots();
    return Response.json({ path: "", entries: roots });
  }

  // Validate path exists and is a directory
  const resolved = path.resolve(reqPath);

  // Security: block sensitive system paths
  if (!isPathAllowed(resolved)) {
    return Response.json({ error: "Access denied: this path is restricted" }, { status: 403 });
  }

  if (!existsSync(resolved)) {
    return Response.json({ error: `Path does not exist: ${resolved}` }, { status: 404 });
  }

  let stat;
  try {
    stat = statSync(resolved);
  } catch {
    return Response.json({ error: `Cannot access path: ${resolved}` }, { status: 403 });
  }

  if (!stat.isDirectory()) {
    return Response.json({ error: `Not a directory: ${resolved}` }, { status: 400 });
  }

  // Read directory contents (directories only)
  let entries: Array<{ name: string; fullPath: string }>;
  try {
    const items = readdirSync(resolved, { withFileTypes: true });
    entries = items
      .filter((item) => {
        if (!item.isDirectory()) return false;
        const name = item.name;
        // Skip hidden/system directories
        if (name.startsWith(".") || name.startsWith("$")) return false;
        if (BLOCKED_PREFIXES.has(name)) return false;
        if (name === "node_modules" || name === "__pycache__") return false;
        return true;
      })
      .map((item) => ({
        name: item.name,
        fullPath: path.join(resolved, item.name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } catch (err) {
    return Response.json(
      { error: `Cannot read directory: ${err instanceof Error ? err.message : "Permission denied"}` },
      { status: 403 },
    );
  }

  // Compute parent path for "go up" navigation
  const parent = path.dirname(resolved);
  const hasParent = parent !== resolved && isPathAllowed(parent);

  return Response.json({
    path: resolved,
    parent: hasParent ? parent : null,
    entries,
  });
}

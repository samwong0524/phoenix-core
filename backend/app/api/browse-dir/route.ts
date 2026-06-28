export const runtime = "nodejs";

import { readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

/**
 * GET /api/browse-dir?path=<dir>
 *
 * Browse local filesystem directories for the folder picker UI.
 * - No path param → return system roots (Windows drives, or / on Unix)
 * - With path param → return subdirectories of that path
 *
 * Only returns directories (not files) since we're picking a working directory.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const reqPath = url.searchParams.get("path")?.trim();

  // No path → return system roots
  if (!reqPath) {
    const roots = getSystemRoots();
    return Response.json({ path: "", entries: roots });
  }

  // Validate path exists and is a directory
  const resolved = path.resolve(reqPath);
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
        if (name === "System Volume Information" || name === "node_modules" || name === "__pycache__") return false;
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
  const hasParent = parent !== resolved; // true unless we're at root

  return Response.json({
    path: resolved,
    parent: hasParent ? parent : null,
    entries,
  });
}

function getSystemRoots(): Array<{ name: string; fullPath: string }> {
  if (process.platform === "win32") {
    // On Windows, list available drive letters by checking if they exist
    const drives: Array<{ name: string; fullPath: string }> = [];
    for (let code = 65; code <= 90; code++) {
      // A-Z
      const drive = String.fromCharCode(code) + ":\\";
      if (existsSync(drive)) {
        drives.push({ name: `${String.fromCharCode(code)}:`, fullPath: drive });
      }
    }
    return drives.length > 0 ? drives : [{ name: "C:", fullPath: "C:\\" }];
  }
  // Unix/macOS
  return [{ name: "/", fullPath: "/" }];
}

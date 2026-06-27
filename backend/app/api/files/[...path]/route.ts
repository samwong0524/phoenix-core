export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

const UPLOADS_ROOT = path.resolve(process.cwd(), "public", "uploads");

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown",
  csv: "text/csv", json: "application/json", xml: "application/xml",
  html: "text/html", css: "text/css", js: "text/javascript", ts: "text/typescript",
  yaml: "text/yaml", yml: "text/yaml", sh: "text/x-sh", sql: "text/x-sql",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  rb: "text/x-ruby", swift: "text/x-swift", kt: "text/x-kotlin",
  rs: "text/x-rust", go: "text/x-go", java: "text/x-java", c: "text/x-c", cpp: "text/x-c++", h: "text/x-c",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const segments = (await params).path;
    if (!segments || segments.length === 0) {
      return new Response("Not found", { status: 404 });
    }

    // Security: prevent path traversal
    const joinedPath = segments.join("/");
    const normalized = path.normalize(joinedPath);
    if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
      return new Response("Forbidden", { status: 403 });
    }

    const fullPath = path.join(UPLOADS_ROOT, normalized);
    const realPath = path.resolve(fullPath);
    if (!realPath.startsWith(UPLOADS_ROOT)) {
      return new Response("Forbidden", { status: 403 });
    }

    if (!existsSync(realPath)) {
      return new Response("Not found", { status: 404 });
    }

    const ext = path.extname(realPath).replace(/^\./, "").toLowerCase();
    const mimeType = MIME_MAP[ext] || "application/octet-stream";

    const buffer = await fs.readFile(realPath);
    const headers = new Headers({
      "Content-Type": mimeType,
      "Content-Length": String(buffer.length),
      "Cache-Control": "public, max-age=31536000, immutable",
    });

    return new Response(buffer, { headers });
  } catch {
    return new Response("Internal server error", { status: 500 });
  }
}

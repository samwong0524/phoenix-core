export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_EXTENSIONS = new Set([
  // Images
  "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico",
  // Documents
  "pdf", "doc", "docx", "txt", "md", "csv", "xlsx", "pptx",
  // Code
  "js", "ts", "tsx", "py", "rs", "go", "java", "c", "cpp", "h", "css", "html", "json", "yaml", "yml", "xml", "sh", "sql", "rb", "swift", "kt",
]);

const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico",
]);

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown",
  csv: "text/csv", json: "application/json", xml: "application/xml",
  html: "text/html", css: "text/css", js: "text/javascript", ts: "text/typescript",
  yaml: "text/yaml", yml: "text/yaml", sh: "text/x-sh", sql: "text/x-sql",
};

function getUploadDir(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const dir = path.resolve(process.cwd(), "public", "uploads", year, month);
  return dir;
}

function generateFileName(originalName: string): { fileName: string; ext: string } {
  const ext = path.extname(originalName).replace(/^\./, "").toLowerCase();
  const safeExt = ext || "bin";
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const base = path.basename(originalName, path.extname(originalName))
    .replace(/[^a-zA-Z0-9一-鿿_-\s]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 50) || "file";
  return { fileName: `${timestamp}-${random}-${base}.${safeExt}`, ext: safeExt };
}

function getMimeType(ext: string): string {
  return MIME_MAP[ext] || "application/octet-stream";
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Validate size
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `文件过大（最大 10MB）` }, { status: 413 });
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "文件为空" }, { status: 400 });
    }

    const { fileName, ext } = generateFileName(file.name);

    // Validate extension
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json({ error: `不支持的文件类型: .${ext}` }, { status: 400 });
    }

    // Create directory and save
    const uploadDir = getUploadDir();
    await fs.mkdir(uploadDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    const filePath = path.join(uploadDir, fileName);
    await fs.writeFile(filePath, buffer);

    const year = path.basename(path.dirname(uploadDir));
    const month = path.basename(uploadDir);
    const url = `/api/files/${year}/${month}/${fileName}`;

    return NextResponse.json({
      ok: true,
      url,
      name: file.name,
      size: file.size,
      type: getMimeType(ext),
      isImage: IMAGE_EXTENSIONS.has(ext),
    });
  } catch (err) {
    console.error("[upload] Error:", err);
    return NextResponse.json({ error: "上传失败" }, { status: 500 });
  }
}

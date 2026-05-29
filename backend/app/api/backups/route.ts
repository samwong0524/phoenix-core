export const runtime = "nodejs";

import { store } from "@/lib/storage";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const backupId = url.searchParams.get("backupId");

  if (backupId) {
    const data = await store.getBackupData({ backupId });
    return Response.json({
      id: data.id,
      workspaceId: data.workspaceId,
      createdAt: data.createdAt,
      data: data.data,
    });
  }

  const backups = await store.listBackups(
    workspaceId ? { workspaceId } : {}
  );
  return Response.json({ backups });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    action: "create" | "restore";
    backupId?: string;
  } | null;
  if (!body) {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action === "create") {
    const url = new URL(req.url);
    const workspaceId = url.searchParams.get("workspaceId");
    if (!workspaceId) {
      return Response.json({ error: "Missing workspaceId" }, { status: 400 });
    }
    const result = await store.backupWorkspace({ workspaceId });
    return Response.json({ ok: true, backupId: result.id, createdAt: result.createdAt }, { status: 201 });
  }

  if (body.action === "restore") {
    if (!body.backupId) {
      return Response.json({ error: "Missing backupId" }, { status: 400 });
    }
    const result = await store.restoreBackup({ backupId: body.backupId });
    return Response.json({ ok: true, workspaceId: result.workspaceId, restoredAt: result.restoredAt });
  }

  return Response.json({ error: "Unknown action. Use 'create' or 'restore'." }, { status: 400 });
}

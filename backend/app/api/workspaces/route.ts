export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { getTemplate } from "@/lib/templates";

export async function GET() {
  try {
    const workspaces = await store.listWorkspaces();
    return Response.json({ workspaces });
  } catch (e) {
    return Response.json(
      {
        error: "Database not ready",
        message: e instanceof Error ? e.message : String(e),
        hint: "Run POST /api/admin/init-db after starting Postgres",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      name?: string;
      templateId?: string;
    } | null;

    const name = body?.name ?? "Default Workspace";
    const templateId = body?.templateId;

    // Template-based creation
    if (templateId && templateId !== "blank") {
      const template = getTemplate(templateId);
      if (!template) {
        return Response.json(
          { error: "Unknown template", templateId },
          { status: 400 }
        );
      }

      // Resolve locale from cookie
      const cookieHeader = req.headers.get("cookie") ?? "";
      const localeMatch = cookieHeader.match(/swarm-locale=(zh|en)/);
      const locale = (localeMatch?.[1] as "zh" | "en") ?? "zh";

      const result = await store.createWorkspaceFromTemplate({
        template,
        name,
        locale,
      });
      return Response.json(result, { status: 201 });
    }

    // Default: blank workspace (backward compatible)
    const result = await store.createWorkspaceWithDefaults({ name });
    return Response.json(result, { status: 201 });
  } catch (e) {
    return Response.json(
      {
        error: "Failed to create workspace",
        message: e instanceof Error ? e.message : String(e),
        hint: "Check DATABASE_URL, start Postgres, then POST /api/admin/init-db",
      },
      { status: 500 }
    );
  }
}

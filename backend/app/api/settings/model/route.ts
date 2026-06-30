export const runtime = "nodejs";

import { setRuntimeSetting, getRuntimeSetting } from "@/runtime/agent-runtime";

function checkAdminAuth(req: Request): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${token}`;
}

export async function GET() {
  const model = getRuntimeSetting("freellmapi_model") ?? "auto";
  return Response.json({ model });
}

export async function POST(req: Request) {
  if (!checkAdminAuth(req)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { model?: string };
  if (body.model) {
    try {
      setRuntimeSetting("freellmapi_model", body.model);
      return Response.json({ ok: true, model: body.model });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Invalid model" },
        { status: 400 },
      );
    }
  }
  return Response.json({ ok: true, model: "auto" });
}

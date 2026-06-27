export const runtime = "nodejs";

import { setRuntimeSetting, getRuntimeSetting } from "@/runtime/agent-runtime";

export async function GET() {
  const model = getRuntimeSetting("freellmapi_model") ?? "auto";
  return Response.json({ model });
}

export async function POST(req: Request) {
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

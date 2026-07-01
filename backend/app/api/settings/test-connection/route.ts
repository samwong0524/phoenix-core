export const runtime = "nodejs";

import { getSetting } from "@/lib/settings";

export async function POST() {
  const baseUrl = getSetting("llm_base_url") ?? process.env.FREELLMAPI_URL ?? "http://127.0.0.1:8080/v1";
  const apiKey = getSetting("llm_api_key") ?? process.env.FREELLMAPI_API_KEY ?? "";
  const model = getSetting("llm_model") ?? process.env.FREELLMAPI_MODEL ?? "auto";

  const endpoint = baseUrl.replace(/\/+$/, "") + "/chat/completions";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const payload = {
    model,
    messages: [{ role: "user", content: "Say hi." }],
    max_tokens: 10,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return Response.json(
        { ok: false, status: res.status, error: text.substring(0, 500) },
        { status: 200 }
      );
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content ?? "";
    return Response.json({
      ok: true,
      status: res.status,
      reply: reply.substring(0, 200),
      model: data.model ?? model,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, status: 0, error: msg.substring(0, 500) }, { status: 200 });
  }
}

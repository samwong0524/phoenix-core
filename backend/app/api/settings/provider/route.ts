export const runtime = "nodejs";

import { getSetting, setSetting } from "@/lib/settings";

export async function GET() {
  const config = {
    llmProvider: getSetting("llm_provider") ?? process.env.LLM_PROVIDER ?? "freellmapi",
    baseUrl: getSetting("llm_base_url") ?? process.env.FREELLMAPI_URL ?? "http://127.0.0.1:8080/v1",
    apiKey: getSetting("llm_api_key") ?? process.env.FREELLMAPI_API_KEY ?? "",
    model: getSetting("llm_model") ?? process.env.FREELLMAPI_MODEL ?? "",
  };
  // Never expose full API key in GET, just show masked
  return Response.json({
    ...config,
    apiKeyMasked: config.apiKey ? config.apiKey.slice(0, 4) + "..." + config.apiKey.slice(-4) : "(empty)",
    hasApiKey: config.apiKey !== "",
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    llmProvider?: string;
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  };

  if (body.llmProvider !== undefined) setSetting("llm_provider", body.llmProvider);
  if (body.baseUrl !== undefined) setSetting("llm_base_url", body.baseUrl);
  if (body.apiKey !== undefined) setSetting("llm_api_key", body.apiKey);
  if (body.model !== undefined) setSetting("llm_model", body.model);

  return Response.json({ ok: true });
}

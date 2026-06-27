export const runtime = "nodejs";

// Cache models for 60s to avoid hitting FreeLLMAPI on every page load
let modelsCache: Array<{ id: string; displayName: string; platform: string }> | null = null;
let modelsCacheTime = 0;
const MODELS_CACHE_TTL = 60_000;

export async function GET() {
  const now = Date.now();
  if (modelsCache && now - modelsCacheTime < MODELS_CACHE_TTL) {
    return Response.json({ models: modelsCache });
  }

  const baseUrl = process.env.FREELLMAPI_URL ?? "http://127.0.0.1:3001/v1";
  const apiKey = process.env.FREELLMAPI_API_KEY;

  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return Response.json({ models: [] });
    }

    const data = (await res.json()) as { data: Array<{ id: string; owned_by: string; name: string; context_window: number | null }> };
    const models = (data.data ?? []).map((m) => ({
      id: m.id,
      displayName: m.name ?? m.id,
      platform: m.owned_by,
    }));

    modelsCache = models;
    modelsCacheTime = now;
    return Response.json({ models });
  } catch {
    return Response.json({ models: modelsCache ?? [] });
  }
}
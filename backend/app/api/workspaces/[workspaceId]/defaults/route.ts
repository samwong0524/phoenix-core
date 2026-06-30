export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { isAuthEnabled, requireSession, getSession, AuthError } from "@/lib/auth";
import { requireWorkspaceRole, RbacError } from "@/lib/rbac";
import { checkRateLimit, RATE_LIMITS, withRateLimitHeaders, rateLimitExceededResponse } from "@/lib/rate-limiter";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params;

  try {
    // Rate limiting
    const session = await getSession(req);
    const userId = session?.id ?? "anonymous";
    const limit = checkRateLimit(`user:${userId}:api`, RATE_LIMITS.api);
    if (!limit.allowed) return rateLimitExceededResponse(limit);

    // Auth check: require login + workspace membership when auth is enabled
    if (isAuthEnabled()) {
      if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
      await requireWorkspaceRole(session, workspaceId, "viewer");
    }

    const result = await store.ensureWorkspaceDefaults({ workspaceId });
    return withRateLimitHeaders(Response.json(result), limit);
  } catch (e) {
    if (e instanceof AuthError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    if (e instanceof RbacError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    return Response.json(
      {
        error: "Failed to load workspace defaults",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}

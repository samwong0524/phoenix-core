export const runtime = "nodejs";

import { store } from "@/lib/storage";
import { getTemplate } from "@/lib/templates";
import { isAuthEnabled, getSession, AuthError } from "@/lib/auth";
import { addWorkspaceMember } from "@/lib/rbac";
import { checkRateLimit, RATE_LIMITS, withRateLimitHeaders, rateLimitExceededResponse } from "@/lib/rate-limiter";
import { apiOk, apiCreated, apiError, apiErrorFromCatch } from "@/lib/api-response";

/** Extract meaningful error message from postgres.js AggregateError and other non-standard errors */
function extractErrorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  // postgres.js AggregateError has .errors array
  const errors = (e as any)?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.map((err: any) => err?.message ?? String(err)).join("; ");
  }
  // postgres.js error code
  const code = (e as any)?.code;
  if (code) return code;
  return String(e);
}

export async function GET(req: Request) {
  try {
    // Rate limiting
    const session = await getSession(req);
    const userId = session?.id ?? "anonymous";
    const limit = checkRateLimit(`user:${userId}:api`, RATE_LIMITS.api);
    if (!limit.allowed) return rateLimitExceededResponse(limit);

    // Auth check: require login when auth is enabled
    if (isAuthEnabled()) {
      if (!session) return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const workspaces = await store.listWorkspaces();
    return withRateLimitHeaders(apiOk({ workspaces }), limit);
  } catch (e) {
    if (e instanceof AuthError) return apiErrorFromCatch(e);
    return apiError("DB_ERROR", `Database not ready: ${extractErrorMessage(e)}`, 500);
  }
}

export async function POST(req: Request) {
  try {
    // Rate limiting
    const session = await getSession(req);
    const userId = session?.id ?? "anonymous";
    const limit = checkRateLimit(`user:${userId}:api`, RATE_LIMITS.api);
    if (!limit.allowed) return rateLimitExceededResponse(limit);

    // Auth check: require login when auth is enabled
    if (isAuthEnabled()) {
      if (!session) return apiError("UNAUTHORIZED", "Authentication required", 401);
    }

    const body = (await req.json().catch(() => null)) as {
      name?: string;
      templateId?: string;
    } | null;

    const name = body?.name ?? "Default Workspace";
    const templateId = body?.templateId;

    let result: { workspaceId: string; [key: string]: unknown };

    // Template-based creation
    if (templateId && templateId !== "blank") {
      const template = getTemplate(templateId);
      if (!template) {
        return apiError("NOT_FOUND", `Unknown template: ${templateId}`, 400);
      }

      // Resolve locale from cookie
      const cookieHeader = req.headers.get("cookie") ?? "";
      const localeMatch = cookieHeader.match(/swarm-locale=(zh|en)/);
      const locale = (localeMatch?.[1] as "zh" | "en") ?? "zh";

      result = await store.createWorkspaceFromTemplate({
        template,
        name,
        locale,
      });
    } else {
      // Default: blank workspace (backward compatible)
      result = await store.createWorkspaceWithDefaults({ name });
    }

    // Auto-seed the creator as workspace owner in workspace_members
    if (session) {
      await addWorkspaceMember(result.workspaceId, session.id, "owner");
    }

    return withRateLimitHeaders(apiCreated(result), limit);
  } catch (e) {
    if (e instanceof AuthError) return apiErrorFromCatch(e);
    return apiError("DB_ERROR", `Failed to create workspace: ${extractErrorMessage(e)}`, 500);
  }
}

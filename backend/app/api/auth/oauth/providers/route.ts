import { getOAuthProvider, isAuthEnabled } from "@/lib/auth";

export async function GET() {
  if (!isAuthEnabled()) {
    return Response.json({ providers: [] });
  }

  const providers: { id: string; name: string }[] = [];
  if (getOAuthProvider("github")) providers.push({ id: "github", name: "GitHub" });
  if (getOAuthProvider("google")) providers.push({ id: "google", name: "Google" });

  return Response.json({ providers });
}

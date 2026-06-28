import { store } from "@/lib/storage";
import HomePageContent from "./_components/home-content";
import SystemStatus from "./_components/system-status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  let workspaces:
    | Array<{ id: string; name: string; createdAt: string }>
    | null = null;
  let dbError = false;

  try {
    workspaces = await store.listWorkspaces();
  } catch {
    dbError = true;
  }

  return (
    <HomePageContent workspaces={workspaces ?? []} dbError={dbError}>
      <SystemStatus />
    </HomePageContent>
  );
}

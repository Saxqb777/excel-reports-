import { headers } from "next/headers";
import { getProjectByDomain } from "@/lib/data/projects";
import { ShareView, shareMetadata } from "./s/[token]/ShareView";
import { ProjectsHome } from "./ProjectsHome";
import { DashboardView } from "./p/[slug]/DashboardView";

export const dynamic = "force-dynamic";

/** On a project's own hostname (settings.domains) the root is that project's shared dashboard, not the Meridian home. */
export async function generateMetadata() {
  const host = (await headers()).get("host");
  const owned = await getProjectByDomain(host);
  return owned ? shareMetadata(owned, host) : { title: "Meridian" };
}

export default async function Home(props: PageProps<"/">) {
  const host = (await headers()).get("host");
  const owned = await getProjectByDomain(host);
  // settings.rootView = "dashboard" puts the working dashboard at the root instead of the read-only view.
  if (owned) return owned.settings.rootView === "dashboard" ? <DashboardView project={owned} /> : <ShareView project={owned} searchParams={await props.searchParams} />;
  return <ProjectsHome />;
}

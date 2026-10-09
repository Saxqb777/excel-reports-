import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getProjectByDomain } from "@/lib/data/projects";
import { ProjectsHome } from "../ProjectsHome";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports and analytics" };

/** Always the admin home, even on a hostname whose root serves a client dashboard. */
export default async function ProjectsPage() {
  // A hostname that belongs to one project never lists the others; the admin home lives on the app's own address.
  if (await getProjectByDomain((await headers()).get("host"))) notFound();
  return <ProjectsHome />;
}

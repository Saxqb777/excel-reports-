import { ProjectsHome } from "../ProjectsHome";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reports and analytics" };

/** Always the admin home, even on a hostname whose root serves a client dashboard. */
export default function ProjectsPage() {
  return <ProjectsHome />;
}

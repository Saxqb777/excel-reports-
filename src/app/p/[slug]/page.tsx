import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getProjectBySlug } from "@/lib/data/projects";
import { shareMetadata } from "@/app/s/[token]/ShareView";
import { DashboardView } from "./DashboardView";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/p/[slug]">) {
  const { slug } = await props.params;
  const project = await getProjectBySlug(slug);
  return shareMetadata(project, (await headers()).get("host"));
}

export default async function ProjectPage(props: PageProps<"/p/[slug]">) {
  const { slug } = await props.params;
  const project = await getProjectBySlug(slug);
  if (!project) notFound();
  if (project.slug !== slug) redirect(`/p/${project.slug}`);
  return <DashboardView project={project} />;
}

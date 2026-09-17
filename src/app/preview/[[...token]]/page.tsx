import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getProjectByDomain, getProjectBySlug, getProjectByShareToken, type ProjectSummary } from "@/lib/data/projects";
import { shareMetadata } from "../../s/[token]/ShareView";

export const dynamic = "force-dynamic";

async function resolve(parts: string[] | undefined): Promise<{ project: ProjectSummary | null; host: string | null; href: string }> {
  const host = (await headers()).get("host");
  if (parts?.[0] === "p" && parts[1]) return { project: await getProjectBySlug(parts[1]), host, href: `/p/${parts[1]}` };
  const token = parts?.[0];
  if (token) return { project: await getProjectByShareToken(token), host, href: `/s/${token}` };
  return { project: await getProjectByDomain(host), host, href: "/" };
}

export async function generateMetadata(props: PageProps<"/preview/[[...token]]">) {
  const { token } = await props.params;
  const { project, host } = await resolve(token);
  return shareMetadata(project && project.shareEnabled ? project : null, host);
}

/** What link-preview crawlers receive instead of the full dashboard: small, instant, same title, description and image. */
export default async function PreviewPage(props: PageProps<"/preview/[[...token]]">) {
  const { token } = await props.params;
  const { project, href } = await resolve(token);
  if (!project || !project.shareEnabled) notFound();
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <div className="label mb-2">{project.clientName ?? "Reports and analytics"}</div>
      <h1 className="text-xl font-semibold text-ink">{project.name}</h1>
      <p className="mt-2 text-ink-2">Live reports and analytics, updated with every new version of the sheet.</p>
      <a href={href} className="btn btn-accent mt-6 inline-block">Open the live dashboard</a>
    </main>
  );
}

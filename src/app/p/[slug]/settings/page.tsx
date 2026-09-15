import Link from "next/link";
import { notFound } from "next/navigation";
import { getProjectBySlug, listUploads } from "@/lib/data/projects";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage(props: PageProps<"/p/[slug]/settings">) {
  const { slug } = await props.params;
  const project = await getProjectBySlug(slug);
  if (!project) notFound();
  const uploads = await listUploads(project.id);
  return (
    <main className="min-h-screen bg-bg">
      <header className="flex h-11 items-center justify-between border-b border-line px-4">
        <div className="flex items-center gap-3"><Link href="/" className="label hover:text-ink">Meridian</Link><span className="h-4 w-px bg-line" /><Link href={`/p/${project.slug}`} className="text-[13px] font-semibold text-ink hover:text-accent">{project.name}</Link><span className="label">Settings</span></div>
        <Link href={`/p/${project.slug}`} className="btn h-7 px-3 py-0 text-[11px] leading-7">Back to dashboard</Link>
      </header>
      <SettingsForm project={project} uploads={uploads} />
    </main>
  );
}

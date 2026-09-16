import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getProjectBySlug, listUploads } from "@/lib/data/projects";
import { SettingsForm } from "./SettingsForm";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";

export const dynamic = "force-dynamic";

export default async function SettingsPage(props: PageProps<"/p/[slug]/settings">) {
  const { slug } = await props.params;
  const project = await getProjectBySlug(slug);
  if (!project) notFound();
  if (project.slug !== slug) redirect(`/p/${project.slug}/settings`);
  const uploads = await listUploads(project.id);
  return (
    <main className="min-h-screen bg-bg">
      <header className="flex h-11 items-center justify-between border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-3"><Link href="/" className="label hidden hover:text-ink sm:inline">Meridian</Link><span className="hidden h-4 w-px bg-line sm:block" /><Link href={`/p/${project.slug}`} className="truncate text-[14px] font-semibold text-ink hover:text-accent">{project.name}</Link><span className="label shrink-0">Settings</span></div>
        <div className="flex shrink-0 items-center gap-2"><ThemeToggle compact /><Link href={`/p/${project.slug}`} className="btn h-7 whitespace-nowrap px-3 py-0 text-[14px] leading-7"><span className="sm:hidden">Back</span><span className="hidden sm:inline">Back to dashboard</span></Link></div>
      </header>
      <SettingsForm project={project} uploads={uploads} />
    </main>
  );
}

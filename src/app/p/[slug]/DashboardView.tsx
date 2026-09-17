import Link from "next/link";
import { getCurrentUpload, getSnapshot, type ProjectSummary } from "@/lib/data/projects";
import { getIntelligence } from "@/lib/data/intelligence";
import { DashboardClient } from "@/components/dashboard/DashboardClient";

/** The working dashboard (upload, edit, ask, history, settings). Served at /p/<slug>, and at "/" on a domain whose project sets settings.rootView = "dashboard". */
export async function DashboardView({ project }: { project: ProjectSummary }) {
  const [snapshot, upload] = await Promise.all([getSnapshot(project), getCurrentUpload(project)]);
  if (!snapshot) {
    return (
      <main className="mx-auto max-w-xl px-6 py-24">
        <div className="label mb-2">{project.name}</div>
        <h1 className="text-xl font-medium">No data yet.</h1>
        <p className="mt-2 text-ink-2">Upload the first workbook to build this dashboard.</p>
        <Link href="/projects" className="btn mt-6 inline-block">Back to projects</Link>
      </main>
    );
  }
  const intelligence = await getIntelligence(project, snapshot).catch((e) => { console.error(e); return null; });
  return <DashboardClient projectId={project.id} slug={project.slug} name={project.name} clientName={project.clientName} theme={project.theme} layout={project.layout} snapshot={snapshot} upload={upload} intelligence={intelligence} share={{ token: project.shareToken, enabled: project.shareEnabled, hasPassword: project.hasSharePassword }} />;
}

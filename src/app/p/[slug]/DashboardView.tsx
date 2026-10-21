import { getCurrentUpload, getSnapshot, type ProjectSummary } from "@/lib/data/projects";
import { getIntelligence } from "@/lib/data/intelligence";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { EmptyProject } from "@/components/dashboard/EmptyProject";
import { hasUpdateAccess } from "@/lib/share/auth";
import { cadenceOf } from "@/lib/dashboard/cadence";

/** The working dashboard (upload, edit, ask, history, settings). Served at /p/<slug>, and at "/" on a domain whose project sets settings.rootView = "dashboard". */
export async function DashboardView({ project, homeHref = "/projects" }: { project: ProjectSummary; homeHref?: string | null }) {
  const [snapshot, upload, unlocked] = await Promise.all([getSnapshot(project), getCurrentUpload(project), hasUpdateAccess(project.id)]);
  if (!snapshot) return <EmptyProject projectId={project.id} name={project.name} locked={project.hasUpdateLock && !unlocked} homeHref={homeHref} />;
  const intelligence = await getIntelligence(project, snapshot).catch((e) => { console.error(e); return null; });
  return <DashboardClient homeHref={homeHref} projectId={project.id} slug={project.slug} name={project.name} clientName={project.clientName} theme={project.theme} layout={project.layout} snapshot={snapshot} upload={upload} intelligence={intelligence} share={{ token: project.shareToken, enabled: project.shareEnabled, hasPassword: project.hasSharePassword }} updateLocked={project.hasUpdateLock && !unlocked} description={project.description} cadence={cadenceOf(project.settings)} ui={project.settings.ui === "v2" ? "v2" : "v1"} />;
}

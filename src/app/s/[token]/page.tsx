import { notFound } from "next/navigation";
import { getCurrentUpload, getProjectByShareToken, getSnapshot } from "@/lib/data/projects";
import { getIntelligence } from "@/lib/data/intelligence";
import { hasShareAccess } from "@/lib/share/auth";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { PasswordGate } from "./PasswordGate";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/s/[token]">) {
  const { token } = await props.params;
  const project = await getProjectByShareToken(token);
  return { title: project ? `${project.name} · ${project.clientName ?? "Meridian"}` : "Meridian", robots: { index: false } };
}

export default async function SharePage(props: PageProps<"/s/[token]">) {
  const { token } = await props.params;
  const sp = await props.searchParams;
  const project = await getProjectByShareToken(token);
  if (!project || !project.shareEnabled) notFound();
  if (!(await hasShareAccess(project))) return <PasswordGate token={token} name={project.name} clientName={project.clientName} primary={project.theme.primary} />;
  const [snapshot, upload] = await Promise.all([getSnapshot(project), getCurrentUpload(project)]);
  if (!snapshot) return <main className="mx-auto max-w-xl px-6 py-24 text-ink-2">This dashboard has no data yet.</main>;
  const intelligence = await getIntelligence(project, snapshot).catch(() => null);
  const board = sp.board === "1";
  const print = sp.print === "1";
  return <DashboardClient projectId={project.id} name={project.name} clientName={project.clientName} theme={project.theme} layout={project.layout} snapshot={snapshot} upload={upload} intelligence={intelligence} readOnly homeHref={null} boardroom={board} print={print ? { page: typeof sp.page === "string" ? sp.page : undefined, theme: sp.theme === "light" ? "light" : sp.theme === "dark" ? "dark" : undefined } : undefined} />;
}

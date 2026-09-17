import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUpload, getSnapshot, type ProjectSummary } from "@/lib/data/projects";
import { getIntelligence } from "@/lib/data/intelligence";
import { hasShareAccess } from "@/lib/share/auth";
import { DashboardClient } from "@/components/dashboard/DashboardClient";
import { PasswordGate } from "./PasswordGate";

type SearchParams = Record<string, string | string[] | undefined>;

/** Absolute origin for link previews: the host the visitor used, so the preview image comes from the same address. */
function originFor(host: string | null): string | null {
  if (!host) return process.env.NEXT_PUBLIC_APP_URL ?? null;
  const insecure = host.startsWith("localhost") || host.startsWith("127.");
  return `${insecure ? "http" : "https"}://${host}`;
}

/** Title, description and preview image for a shared dashboard, used by the share link and by vanity domains. */
export function shareMetadata(project: ProjectSummary | null, host: string | null): Metadata {
  if (!project) return { title: "Reports and analytics", robots: { index: false } };
  const title = `${project.name} · Reports and analytics`;
  const description = `${project.clientName ? `${project.clientName} · ` : ""}live reports and analytics, updated with every new version of the sheet.`;
  const origin = originFor(host);
  const image = `${origin ?? ""}/og/${project.shareToken}`;
  return {
    title, description, robots: { index: false },
    openGraph: { title, description, type: "website", siteName: project.clientName ?? project.name, images: [{ url: image, width: 1200, height: 630, alt: title }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

/** The read-only dashboard behind a share link (or a vanity domain), with the optional password gate. */
export async function ShareView({ project, searchParams }: { project: ProjectSummary; searchParams: SearchParams }) {
  if (!project.shareEnabled) notFound();
  if (!(await hasShareAccess(project))) return <PasswordGate token={project.shareToken} name={project.name} clientName={project.clientName} primary={project.theme.primary} />;
  const [snapshot, upload] = await Promise.all([getSnapshot(project), getCurrentUpload(project)]);
  if (!snapshot) return <main className="mx-auto max-w-xl px-6 py-24 text-ink-2">This dashboard has no data yet.</main>;
  const intelligence = await getIntelligence(project, snapshot).catch(() => null);
  const sp = searchParams;
  const board = sp.board === "1";
  const print = sp.print === "1";
  return <DashboardClient projectId={project.id} name={project.name} clientName={project.clientName} theme={project.theme} layout={project.layout} snapshot={snapshot} upload={upload} intelligence={intelligence} readOnly homeHref={null} boardroom={board} print={print ? { page: typeof sp.page === "string" ? sp.page : undefined, theme: sp.theme === "light" ? "light" : sp.theme === "dark" ? "dark" : undefined } : undefined} />;
}

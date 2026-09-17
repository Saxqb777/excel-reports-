import Link from "next/link";
import { headers } from "next/headers";
import { getProjectByDomain, getSnapshot, listProjects } from "@/lib/data/projects";
import { ShareView, shareMetadata } from "./s/[token]/ShareView";
import { formatDateTime } from "@/lib/engine/format";
import { MiniDashboard } from "@/components/dashboard/MiniDashboard";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";
import { ProjectCardMenu } from "@/components/dashboard/ProjectCardMenu";

export const dynamic = "force-dynamic";

/** On a project's own hostname (settings.domains) the root is that project's shared dashboard, not the Meridian home. */
export async function generateMetadata() {
  const host = (await headers()).get("host");
  const owned = await getProjectByDomain(host);
  return owned ? shareMetadata(owned, host) : { title: "Meridian" };
}

export default async function Home(props: PageProps<"/">) {
  const host = (await headers()).get("host");
  const owned = await getProjectByDomain(host);
  if (owned) return <ShareView project={owned} searchParams={await props.searchParams} />;
  const projects = await listProjects();
  const withData = await Promise.all(projects.map(async (p) => ({ ...p, snapshot: await getSnapshot(p).catch(() => null) })));
  return (
    <main className="min-h-screen bg-bg">
      <header className="flex h-11 items-center justify-between border-b border-line px-4">
        <span className="label-strong">Meridian</span>
        <div className="flex items-center gap-3">
          <span className="label hidden sm:inline">{projects.length} project{projects.length === 1 ? "" : "s"}</span>
          <ThemeToggle compact />
          <Link href="/new" className="btn btn-accent h-7 px-3 py-0 text-[14px] leading-7">New project</Link>
        </div>
      </header>
      {projects.length === 0 ? (
        <div className="px-6 py-24 text-ink-2">No projects yet. <Link href="/new" className="text-accent underline-offset-2 hover:underline">Create the first one</Link> by uploading a workbook.</div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3">
          {withData.map((p) => (
            <li key={p.id} className="group relative border-b border-line bg-bg md:border-r">
              <ProjectCardMenu projectId={p.id} slug={p.slug} name={p.name} />
              <Link href={`/p/${p.slug}`} className="block">
                <div className="relative border-b border-line">
                  {p.snapshot ? <MiniDashboard layout={p.layout} snapshot={p.snapshot} theme={p.theme} /> : <div className="flex h-48 items-center justify-center text-[14.5px] text-ink-3">No data yet</div>}
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,var(--bg)_0%,transparent_28%)]" />
                  <span className="label absolute bottom-2 right-3 opacity-0 transition-opacity group-hover:opacity-100">Open →</span>
                </div>
                <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      {p.theme.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.theme.logoUrl} alt="" className="h-5 w-auto max-w-[80px] object-contain" />
                      ) : <span className="num flex h-5 min-w-5 items-center justify-center px-1 text-[14px] font-semibold" style={{ background: p.theme.primary, color: "#fff" }}>{(p.theme.monogram ?? p.name.slice(0, 2)).toUpperCase()}</span>}
                      <span className="truncate text-[14px] font-semibold text-ink">{p.name}</span>
                      {p.clientName && <span className="truncate text-[14.5px] text-ink-3">{p.clientName}</span>}
                    </div>
                    {p.description && <p className="mt-1 truncate text-[14.5px] text-ink-2">{p.description}</p>}
                  </div>
                  <div className="num shrink-0 text-[14px] leading-relaxed text-ink-3 sm:text-right">
                    {p.upload ? <><div><span className="text-ink-2">v{p.upload.versionNo}</span> · {p.upload.rowCount} rows</div><div>{formatDateTime(p.upload.uploadedAt)}</div></> : "No upload yet"}
                  </div>
                </div>
              </Link>
            </li>
          ))}
          <li className="border-b border-line md:border-r">
            <Link href="/new" className="flex h-full min-h-40 flex-col items-center justify-center gap-1 px-4 py-8 text-ink-3 transition-colors hover:bg-bg-hover hover:text-ink">
              <span className="text-[22px] leading-none">+</span>
              <span className="text-[14.5px] font-semibold">New project</span>
              <span className="text-[14px]">Upload a workbook and get a dashboard</span>
            </Link>
          </li>
        </ul>
      )}
    </main>
  );
}

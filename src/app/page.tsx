import Link from "next/link";
import { getSnapshot, listProjects } from "@/lib/data/projects";
import { formatDateTime } from "@/lib/engine/format";
import { MiniDashboard } from "@/components/dashboard/MiniDashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const projects = await listProjects();
  const withData = await Promise.all(projects.map(async (p) => ({ ...p, snapshot: await getSnapshot(p).catch(() => null) })));
  return (
    <main className="min-h-screen bg-bg">
      <header className="flex h-11 items-center justify-between border-b border-line px-4">
        <span className="label-strong">Meridian</span>
        <div className="flex items-center gap-3">
          <span className="label">{projects.length} project{projects.length === 1 ? "" : "s"}</span>
          <Link href="/new" className="btn btn-accent h-7 px-3 py-0 text-[11px] leading-7">New project</Link>
        </div>
      </header>
      {projects.length === 0 ? (
        <div className="px-6 py-24 text-ink-2">No projects yet. <Link href="/new" className="text-accent underline-offset-2 hover:underline">Create the first one</Link> by uploading a workbook.</div>
      ) : (
        <ul className="grid grid-cols-1 gap-px bg-line md:grid-cols-2 2xl:grid-cols-3">
          {withData.map((p) => (
            <li key={p.id} className="group bg-bg">
              <Link href={`/p/${p.slug}`} className="block">
                <div className="relative border-b border-line">
                  {p.snapshot ? <MiniDashboard layout={p.layout} snapshot={p.snapshot} theme={p.theme} /> : <div className="flex h-48 items-center justify-center text-[12px] text-ink-3">No data yet</div>}
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,var(--bg)_0%,transparent_28%)]" />
                  <span className="label absolute bottom-2 right-3 opacity-0 transition-opacity group-hover:opacity-100">Open →</span>
                </div>
                <div className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      {p.theme.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.theme.logoUrl} alt="" className="h-5 w-auto max-w-[80px] object-contain" />
                      ) : <span className="num flex h-5 min-w-5 items-center justify-center px-1 text-[10px] font-semibold" style={{ background: p.theme.primary, color: "#fff" }}>{(p.theme.monogram ?? p.name.slice(0, 2)).toUpperCase()}</span>}
                      <span className="truncate text-[14px] font-semibold text-ink">{p.name}</span>
                      {p.clientName && <span className="truncate text-[12px] text-ink-3">{p.clientName}</span>}
                    </div>
                    {p.description && <p className="mt-1 truncate text-[12px] text-ink-2">{p.description}</p>}
                  </div>
                  <div className="num shrink-0 text-right text-[11px] leading-relaxed text-ink-3">
                    {p.upload ? <><div><span className="text-ink-2">v{p.upload.versionNo}</span> · {p.upload.rowCount} rows</div><div>{formatDateTime(p.upload.uploadedAt)}</div><div>by {p.upload.uploadedBy}</div></> : "No upload yet"}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

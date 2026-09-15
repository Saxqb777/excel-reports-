import Link from "next/link";
import { listProjects } from "@/lib/data/projects";
import { formatDateTime } from "@/lib/engine/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const projects = await listProjects();
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
        <ul className="grid grid-cols-1 gap-px bg-line md:grid-cols-2 xl:grid-cols-3">
          {projects.map((p) => (
            <li key={p.id} className="bg-bg">
              <Link href={`/p/${p.slug}`} className="block p-5 transition-colors hover:bg-bg-hover">
                <div className="flex items-center gap-2.5">
                  <span className="num flex h-5 min-w-5 items-center justify-center px-1 text-[10px] font-semibold" style={{ background: p.theme.primary, color: "#fff" }}>{(p.theme.monogram ?? p.name.slice(0, 2)).toUpperCase()}</span>
                  <span className="text-[14px] font-semibold text-ink">{p.name}</span>
                  {p.clientName && <span className="text-[12px] text-ink-3">{p.clientName}</span>}
                </div>
                {p.description && <p className="mt-2 text-[12.5px] text-ink-2">{p.description}</p>}
                <div className="num mt-4 text-[11px] text-ink-3">
                  {p.upload ? <>v{p.upload.versionNo} · {p.upload.rowCount} rows · {formatDateTime(p.upload.uploadedAt)} · {p.upload.uploadedBy}</> : "No upload yet"}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

import Link from "next/link";
import { getSnapshot, listProjects } from "@/lib/data/projects";
import { computeMetric } from "@/lib/engine/metrics";
import { formatDateTime, formatNumber } from "@/lib/engine/format";
import type { KpiWidget } from "@/lib/dashboard/types";
import type { Snapshot } from "@/lib/schema/types";
import { ThemeToggle } from "@/components/dashboard/ThemeToggle";
import { ProjectCardMenu } from "@/components/dashboard/ProjectCardMenu";

/** The first three headline figures of a project's first page, computed over all its rows. */
function headline(layout: { pages: { widgets: unknown[] }[] }, snapshot: Snapshot | null): { title: string; value: string }[] {
  if (!snapshot) return [];
  const all = new Uint8Array(snapshot.n).fill(1);
  const kpis = (layout.pages[0]?.widgets ?? []).filter((w): w is KpiWidget => (w as KpiWidget).type === "kpi").slice(0, 3);
  return kpis.map((w) => ({ title: w.title, value: formatNumber(computeMetric(snapshot, all, w.metric), w.metric.format ?? "integer", w.metric.currency, true, w.metric.decimals) }));
}

/** The admin home: every project as a card with its headline figures. Served at /projects, and at / on the app's own hostname. */
export async function ProjectsHome() {
  const projects = await listProjects();
  const cards = await Promise.all(projects.map(async (p) => {
    const snapshot = await getSnapshot(p).catch(() => null);
    const domains = Array.isArray(p.settings.domains) ? (p.settings.domains as string[]) : [];
    return { ...p, figures: headline(p.layout, snapshot), domain: domains[0] ?? null };
  }));
  const latest = projects.map((p) => p.upload?.uploadedAt).filter(Boolean).sort().at(-1);
  return (
    <main className="min-h-screen bg-bg">
      <header className="flex h-11 items-center justify-between border-b border-line px-4">
        <span className="label-strong">Reports and analytics</span>
        <div className="flex items-center gap-3">
          <ThemeToggle compact />
          <Link href="/new" className="btn btn-accent h-7 px-3 py-0 text-[14px] leading-7">New project</Link>
        </div>
      </header>
      <section className="mx-auto max-w-[1440px] px-4 pb-12 pt-7 sm:px-6">
        <div className="mb-6">
          <h1 className="text-[24px] font-semibold leading-tight text-ink">All dashboards</h1>
          <p className="mt-1 text-[14.5px] text-ink-3">
            {projects.length} dashboard{projects.length === 1 ? "" : "s"}{latest ? <> · last update {formatDateTime(latest)}</> : null}
          </p>
        </div>
        {projects.length === 0 ? (
          <div className="border border-line px-6 py-20 text-center text-ink-2">No dashboards yet. <Link href="/new" className="text-accent underline-offset-2 hover:underline">Create the first one</Link> by uploading a workbook.</div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((p) => (
              <li key={p.id} className="group relative flex flex-col border border-line bg-bg-elev transition-colors hover:border-[var(--line-strong)]">
                <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: p.theme.primary }} aria-hidden />
                <ProjectCardMenu projectId={p.id} slug={p.slug} name={p.name} />
                <Link href={`/p/${p.slug}`} className="flex flex-1 flex-col gap-4 px-5 pb-4 pt-5">
                  <div className="flex items-start gap-3 pr-10">
                    {p.theme.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.theme.logoUrl} alt="" className="mt-0.5 h-8 w-auto max-w-[96px] object-contain" />
                    ) : (
                      <span className="num flex h-8 min-w-8 shrink-0 items-center justify-center px-1.5 text-[14px] font-semibold" style={{ background: p.theme.primary, color: "#fff" }}>{(p.theme.monogram ?? p.name.slice(0, 2)).toUpperCase()}</span>
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-[16px] font-semibold leading-snug text-ink">{p.name}</div>
                      {p.description && <p className="truncate-2 mt-0.5 text-[14px] leading-snug text-ink-3">{p.description}</p>}
                    </div>
                  </div>
                  {p.figures.length > 0 ? (
                    <dl className="grid grid-cols-3 gap-3 border-t border-line pt-4">
                      {p.figures.map((f) => (
                        <div key={f.title} className="min-w-0">
                          <dt className="label truncate" title={f.title}>{f.title}</dt>
                          <dd className="num mt-1 truncate text-[18px] font-bold leading-none text-ink sm:text-[21px]">{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <div className="border-t border-line pt-4 text-[14px] text-ink-3">No data yet. Open it to upload the workbook.</div>
                  )}
                  <div className="mt-auto flex items-center justify-between gap-3 text-[13.5px] text-ink-3">
                    <span className="num truncate">{p.upload ? <>Updated {formatDateTime(p.upload.uploadedAt)} · v{p.upload.versionNo}</> : "No upload yet"}</span>
                    <span className="shrink-0 font-semibold text-ink-2 transition-colors group-hover:text-ink">Open →</span>
                  </div>
                </Link>
                {p.domain && (
                  <a href={`https://${p.domain}`} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 border-t border-line px-5 py-2.5 text-[13.5px] text-ink-3 transition-colors hover:bg-bg-hover hover:text-ink">
                    <span className="truncate">{p.domain}</span>
                    <span aria-hidden>↗</span>
                  </a>
                )}
              </li>
            ))}
            <li>
              <Link href="/new" className="flex h-full min-h-48 flex-col items-center justify-center gap-1 border border-dashed border-line px-4 py-8 text-ink-3 transition-colors hover:border-[var(--line-strong)] hover:text-ink">
                <span className="text-[24px] leading-none">+</span>
                <span className="text-[15px] font-semibold">New project</span>
                <span className="text-[14px]">Upload a workbook and get a dashboard</span>
              </Link>
            </li>
          </ul>
        )}
      </section>
    </main>
  );
}

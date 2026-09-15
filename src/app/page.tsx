import { buildInfo, envChecks, pingDatabase } from "@/lib/env";

export const dynamic = "force-dynamic";

function Row({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="grid grid-cols-[14px_220px_1fr] items-baseline gap-4 border-t border-line py-3">
      <span className={`num ${ok ? "text-pos" : "text-warn"}`}>{ok ? "●" : "○"}</span>
      <span className="num">{label}</span>
      <span className="text-ink-2">{detail}</span>
    </div>
  );
}

export default async function Page() {
  const build = buildInfo();
  const env = envChecks();
  const db = await pingDatabase();
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <div className="label mb-2">Meridian · Phase 0 · pipeline check</div>
      <h1 className="text-2xl font-medium tracking-tight">Deployment is live.</h1>
      <p className="mt-2 max-w-xl text-ink-2">
        Every push to the production branch redeploys this page. The rows below turn solid when each
        environment variable is present in Vercel and the database answers.
      </p>

      <div className="mt-10">
        <div className="label mb-3">Build</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 num text-[12px]">
          <span className="text-ink-3">commit</span><span>{build.sha}</span>
          <span className="text-ink-3">branch</span><span>{build.branch}</span>
          <span className="text-ink-3">environment</span><span>{build.env}</span>
          <span className="text-ink-3">region</span><span>{build.region}</span>
          <span className="text-ink-3">rendered</span><span>{build.deployedAt}</span>
        </div>
      </div>

      <div className="mt-10">
        <div className="label mb-1">Readiness</div>
        {env.map((c) => (
          <Row key={c.key} ok={c.present} label={c.key} detail={c.present ? c.purpose : `Missing · ${c.purpose}`} />
        ))}
        <Row ok={db.ok} label="Database ping" detail={db.ok ? `${db.detail} · ${db.ms} ms` : db.detail} />
      </div>

      <p className="mt-10 text-ink-3">
        JSON version at <span className="num">/api/health</span>.
      </p>
    </main>
  );
}

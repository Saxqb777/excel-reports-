"use client";
import { useMemo } from "react";
import type { QualityWidget } from "@/lib/dashboard/types";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { normKey, type FilterExpr } from "@/lib/schema/types";
import { formatNumber, pct } from "@/lib/engine/format";
import { logicChecks } from "@/lib/intelligence/quality";
import type { Anomaly } from "@/lib/intelligence/anomalies";

interface FieldQuality { id: string; label: string; blanks: number; outside: string[]; variants: string[][] }

export function QualityTile({ w, anomalies }: { w: QualityWidget; anomalies?: Anomaly[] }) {
  const { snapshot, dispatch } = useDashboard();
  const logic = useMemo(() => logicChecks(snapshot), [snapshot]);
  const report = useMemo(() => {
    const out: FieldQuality[] = [];
    for (const f of snapshot.fields) {
      if (f.derived) continue;
      const col = snapshot.columns[f.id] ?? [];
      let blanks = 0;
      const seen = new Map<string, Set<string>>();
      const outside = new Set<string>();
      for (let i = 0; i < snapshot.n; i++) {
        const v = col[i];
        if (v === null) { blanks++; continue; }
        if (typeof v === "string") {
          const k = normKey(v);
          if (!seen.has(k)) seen.set(k, new Set());
          seen.get(k)!.add(v);
          if (f.allowedValues && !f.allowedValues.some((a) => normKey(a) === k)) outside.add(v);
        }
      }
      const variants = [...seen.values()].filter((s) => s.size > 1).map((s) => [...s]);
      out.push({ id: f.id, label: f.label, blanks, outside: [...outside], variants });
    }
    return out;
  }, [snapshot]);
  const idField = snapshot.fields.find((f) => f.role === "id");
  const dupes = useMemo(() => {
    if (!idField) return [];
    const c = new Map<string, number>();
    for (const v of snapshot.columns[idField.id] ?? []) if (v !== null) c.set(String(v), (c.get(String(v)) ?? 0) + 1);
    return [...c.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`);
  }, [snapshot, idField]);
  const folded = Object.entries(snapshot.variants ?? {}).map(([fid, m]) => ({ id: fid, label: snapshot.fields.find((f) => f.id === fid)?.label ?? fid, groups: Object.entries(m) }));
  const issues = report.filter((r) => r.outside.length || r.variants.length);
  const applyRows = (filter: FilterExpr | undefined, label: string, id: string) => {
    if (filter) dispatch({ type: "toggle", selection: { widgetId: "quality", field: "__quality__", values: [id], label, extra: filter } });
  };
  return (
    <section className="tile h-full w-full overflow-auto" aria-label={w.title}>
      <div className="grid grid-cols-1 gap-px bg-line lg:grid-cols-2">
        <div className="bg-bg p-3.5">
          <div className="label-strong mb-2">Logic checks</div>
          {logic.length === 0 ? <div className="text-[11.5px] text-ink-3">Dates, statuses and outcomes agree with each other on every row.</div> : (
            <ul className="space-y-1.5 text-[11.5px]">
              {logic.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3">
                  <button type="button" className="text-left text-ink hover:text-accent" onClick={() => applyRows(l.filter, l.rule, l.id)} title="Show these rows">
                    <span className={`num mr-1.5 ${l.severity === "neg" ? "text-neg" : "text-warn"}`}>●</span>{l.rule}
                  </button>
                  <span className="num shrink-0 text-ink-3">{l.count} · {l.rows.slice(0, 3).join(", ")}{l.rows.length > 3 ? "…" : ""}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-bg p-3.5">
          <div className="label-strong mb-2">Statistical anomalies</div>
          {!anomalies || anomalies.length === 0 ? <div className="text-[11.5px] text-ink-3">Nothing sits far outside its own history yet. Metric anomalies need at least four earlier versions; row anomalies need at least six values.</div> : (
            <ul className="space-y-1.5 text-[11.5px]">
              {anomalies.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3">
                  <button type="button" className="text-left text-ink hover:text-accent" onClick={() => applyRows(a.filter, a.label, a.id)} title="Show these rows">
                    <span className={`num mr-1.5 ${a.tone === "neg" ? "text-neg" : "text-warn"}`}>●</span>{a.detail}
                  </button>
                  <span className="num shrink-0 text-ink-3">z {a.z.toFixed(1)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-px border-t border-line bg-line lg:grid-cols-3">
        <div className="bg-bg p-3.5">
          <div className="label-strong mb-2">Rows</div>
          <Row k="Included" v={formatNumber(snapshot.n)} />
          <Row k="Excluded" v={formatNumber(snapshot.excluded.length)} tone={snapshot.excluded.length ? "warn" : undefined} />
          <Row k="Duplicate ids" v={dupes.length ? dupes.join(", ") : "none"} tone={dupes.length ? "neg" : undefined} />
          <Row k="Values corrected" v={formatNumber(snapshot.fixes.length)} tone={snapshot.fixes.length ? "warn" : undefined} />
          {snapshot.excluded.length > 0 && (
            <div className="mt-3">
              <div className="label mb-1">Excluded rows and why</div>
              <ul className="space-y-0.5 text-[11.5px]">
                {snapshot.excluded.map((e) => <li key={e.row} className="flex justify-between gap-3"><span className="num text-ink">{e.id ?? `row ${e.row}`}</span><span className="text-ink-3">{e.reason}</span></li>)}
              </ul>
            </div>
          )}
          {snapshot.fixes.length > 0 && (
            <div className="mt-3">
              <div className="label mb-1">Corrections applied</div>
              <ul className="space-y-0.5 text-[11.5px]">
                {snapshot.fixes.map((f, i) => <li key={i}><span className="num text-ink">row {f.row}</span> <span className="text-ink-2">{f.field}</span> <span className="num text-ink-3">{f.from} → {f.to}</span><div className="text-ink-3">{f.reason}</div></li>)}
              </ul>
            </div>
          )}
        </div>
        <div className="bg-bg p-3.5">
          <div className="label-strong mb-2">Blanks by column</div>
          <table className="w-full text-[11.5px]">
            <tbody>
              {report.map((r) => (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="py-1 pr-2 text-ink-2">{r.label}</td>
                  <td className="num py-1 text-right text-ink">{r.blanks}</td>
                  <td className="py-1 pl-3"><span className="inline-block h-[3px] w-full max-w-[80px] bg-bg-sunk align-middle"><span className="block h-full" style={{ width: pct(r.blanks, snapshot.n) === "–" ? 0 : `${Math.round((r.blanks / Math.max(1, snapshot.n)) * 100)}%`, background: r.blanks / Math.max(1, snapshot.n) > 0.5 ? "var(--warn)" : "var(--ink-3)" }} /></span></td>
                  <td className="num py-1 pl-2 text-right text-ink-3">{pct(r.blanks, snapshot.n)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="bg-bg p-3.5">
          <div className="label-strong mb-2">Inconsistent values</div>
          {folded.length > 0 && (
            <ul className="mb-3 space-y-2 text-[11.5px]">
              {folded.map((f) => (
                <li key={f.id}>
                  <div className="text-ink">{f.label} <span className="text-ink-3">· {f.groups.reduce((a, g) => a + g[1].length, 0)} spellings folded</span></div>
                  {f.groups.map(([canon, raws]) => <div key={canon} className="text-ink-3"><span className="num text-ink-2">{raws.join(" / ")}</span> → <span className="num text-ink">{canon}</span></div>)}
                </li>
              ))}
            </ul>
          )}
          {issues.length === 0 && folded.length === 0 ? <div className="text-[11.5px] text-ink-3">No casing, spacing or out-of-list values found.</div> : issues.length === 0 ? null : (
            <ul className="space-y-2 text-[11.5px]">
              {issues.map((r) => (
                <li key={r.id}>
                  <div className="text-ink">{r.label}</div>
                  {r.variants.map((v, i) => <div key={i} className="text-ink-3">Variants folded: <span className="num text-ink-2">{v.join(" / ")}</span></div>)}
                  {r.outside.length > 0 && <div className="text-ink-3">Outside the sheet&rsquo;s dropdown list: <span className="num text-warn">{r.outside.join(", ")}</span></div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: "warn" | "neg" }) {
  return <div className="flex justify-between gap-3 border-b border-line py-1 text-[11.5px] last:border-0"><span className="text-ink-2">{k}</span><span className={`num ${tone === "warn" ? "text-warn" : tone === "neg" ? "text-neg" : "text-ink"}`}>{v}</span></div>;
}

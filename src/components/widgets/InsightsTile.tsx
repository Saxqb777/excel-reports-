"use client";
import { useMemo } from "react";
import type { InsightsWidget } from "@/lib/dashboard/types";
import type { Insight } from "@/lib/intelligence/insights";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { formatDate, formatNumber } from "@/lib/engine/format";

export type { Insight };

/** Top three changes since the previous version. Falls back to a version summary before any comparison exists. */
export function InsightsTile({ w, insights, comparedTo }: { w: InsightsWidget; insights?: Insight[]; comparedTo?: number | null }) {
  const { snapshot, baseMask, layout, dispatch, isSelected } = useDashboard();
  const summary = useMemo(() => {
    let n = 0; for (let i = 0; i < snapshot.n; i++) n += baseMask[i];
    const dateCol = layout.dateField ? snapshot.columns[layout.dateField] : undefined;
    let min = Infinity, max = -Infinity;
    if (dateCol) for (let i = 0; i < snapshot.n; i++) { const v = dateCol[i]; if (typeof v === "number") { if (v < min) min = v; if (v > max) max = v; } }
    return { n, min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null };
  }, [snapshot, baseMask, layout.dateField]);
  const items: Insight[] = insights?.length ? insights : [
    { id: "v", kind: "baseline", tone: "neutral", score: 1, headline: `Version ${snapshot.version} loaded`, detail: `${formatNumber(summary.n)} rows in view${summary.min !== null ? ` · ${formatDate(summary.min, "long")} to ${formatDate(summary.max, "long")}` : ""}` },
    { id: "x", kind: "baseline", tone: snapshot.excluded.length ? "warn" : "pos", score: 1, headline: `${snapshot.excluded.length} rows excluded`, detail: snapshot.excluded.length ? snapshot.excluded.slice(0, 4).map((e) => e.id ?? `row ${e.row}`).join(", ") + " — see Data quality" : "Every row passed validation" },
    { id: "f", kind: "baseline", tone: snapshot.fixes.length ? "warn" : "neutral", score: 1, headline: `${snapshot.fixes.length} values corrected`, detail: snapshot.fixes.length ? snapshot.fixes.slice(0, 2).map((f) => `${f.field} ${f.from} → ${f.to}`).join(" · ") : "No automatic corrections were needed" },
  ];
  const sel = isSelected("insights");
  return (
    <section className="tile h-full w-full" aria-label={w.title}>
      <div className="grid h-full grid-cols-1 divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
        {items.slice(0, 3).map((it, i) => {
          const active = sel?.values[0] === it.id;
          const clickable = Boolean(it.filter);
          return (
            <button key={it.id} type="button" disabled={!clickable} onClick={() => clickable && dispatch({ type: "toggle", selection: { widgetId: "insights", field: "__insight__", values: [it.id], label: it.headline, extra: it.filter } })}
              className={`flex min-w-0 items-start gap-3 px-3.5 py-2.5 text-left transition-colors ${clickable ? "cursor-pointer hover:bg-bg-hover" : "cursor-default"} ${active ? "bg-[var(--accent-wash)]" : ""}`} title={clickable ? "Click to see these rows" : undefined}>
              <div className={`num shrink-0 pt-0.5 text-[18px] leading-none ${it.tone === "pos" ? "text-pos" : it.tone === "neg" ? "text-neg" : it.tone === "warn" ? "text-warn" : "text-ink-3"}`} aria-hidden>
                {it.delta === undefined || it.delta === null ? (i === 0 && it.kind === "baseline" ? "▸" : "·") : it.delta > 0 ? "▲" : it.delta < 0 ? "▼" : "▬"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] font-medium text-ink">{it.headline}</div>
                {it.detail && <div className="truncate-2 text-[11.5px] leading-snug text-ink-3">{it.detail}</div>}
              </div>
              {typeof it.delta === "number" && it.delta !== 0 && it.kind !== "kpi" && (
                <div className={`num shrink-0 pt-0.5 text-[15px] leading-none ${it.tone === "pos" ? "text-pos" : it.tone === "neg" ? "text-neg" : it.tone === "warn" ? "text-warn" : "text-ink-3"}`}>{it.delta > 0 ? "+" : ""}{formatNumber(it.delta)}</div>
              )}
            </button>
          );
        })}
      </div>
      {comparedTo !== undefined && comparedTo !== null && <div className="label absolute right-3 top-2 hidden md:block">vs v{comparedTo}</div>}
    </section>
  );
}

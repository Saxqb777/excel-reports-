"use client";
import { useMemo } from "react";
import type { InsightsWidget } from "@/lib/dashboard/types";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { formatDate, formatNumber } from "@/lib/engine/format";

export interface Insight { headline: string; detail?: string; delta?: number | null; tone?: "pos" | "neg" | "warn" | "neutral"; metric?: string }

/** Phase 1: shows the version summary. Phase 3 replaces the content with ranked change insights. */
export function InsightsTile({ w, insights }: { w: InsightsWidget; insights?: Insight[] }) {
  const { snapshot, baseMask, layout } = useDashboard();
  const summary = useMemo(() => {
    let n = 0; for (let i = 0; i < snapshot.n; i++) n += baseMask[i];
    const dateCol = layout.dateField ? snapshot.columns[layout.dateField] : undefined;
    let min = Infinity, max = -Infinity;
    if (dateCol) for (let i = 0; i < snapshot.n; i++) { const v = dateCol[i]; if (typeof v === "number") { if (v < min) min = v; if (v > max) max = v; } }
    return { n, min: Number.isFinite(min) ? min : null, max: Number.isFinite(max) ? max : null };
  }, [snapshot, baseMask, layout.dateField]);
  const items: Insight[] = insights?.length ? insights : [
    { headline: `Version ${snapshot.version} loaded`, detail: `${formatNumber(summary.n)} rows in view${summary.min !== null ? ` · ${formatDate(summary.min, "long")} to ${formatDate(summary.max, "long")}` : ""}`, tone: "neutral" },
    { headline: `${snapshot.excluded.length} rows excluded`, detail: snapshot.excluded.length ? snapshot.excluded.slice(0, 4).map((e) => e.id ?? `row ${e.row}`).join(", ") + (snapshot.excluded.length > 4 ? "…" : "") + " — see Data quality" : "Every row passed validation", tone: snapshot.excluded.length ? "warn" : "pos" },
    { headline: `${snapshot.fixes.length} values corrected`, detail: snapshot.fixes.length ? snapshot.fixes.slice(0, 2).map((f) => `${f.field} ${f.from} → ${f.to}`).join(" · ") : "No automatic corrections were needed", tone: snapshot.fixes.length ? "warn" : "neutral" },
  ];
  return (
    <section className="tile h-full w-full" aria-label={w.title}>
      <div className="grid h-full grid-cols-1 divide-y divide-line md:grid-cols-3 md:divide-x md:divide-y-0">
        {items.slice(0, 3).map((it, i) => (
          <div key={i} className="flex min-w-0 items-start gap-3 px-3.5 py-2.5">
            <div className={`num shrink-0 pt-0.5 text-[18px] leading-none ${it.tone === "pos" ? "text-pos" : it.tone === "neg" ? "text-neg" : it.tone === "warn" ? "text-warn" : "text-ink-3"}`} aria-hidden>
              {it.delta === undefined || it.delta === null ? (i === 0 ? "▸" : "·") : it.delta > 0 ? "▲" : it.delta < 0 ? "▼" : "▬"}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-medium text-ink">{it.headline}</div>
              {it.detail && <div className="truncate-2 text-[11.5px] leading-snug text-ink-3">{it.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

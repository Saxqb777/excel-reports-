"use client";
import { useMemo } from "react";
import type { StoryWidget } from "@/lib/dashboard/types";
import { computeMetric, timeSeries } from "@/lib/engine/metrics";
import { formatNumber } from "@/lib/engine/format";
import { monthLabelOf, MONTH_NAMES } from "@/lib/dashboard/cadence";
import { periodStart } from "@/lib/schema/normalize";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { useTween } from "@/lib/ui/tween";
import { deltaTone } from "@/lib/ui/colors";
import { Sparkline } from "@/components/charts/Sparkline";
import { useTooltip } from "@/lib/ui/tooltip";

const MONTH = 1;

/**
 * The month in one sentence. Takes the month picked in the filter row, else the latest month in the current
 * selection, and shows each headline number with its change on the month before and a twelve-month trend.
 */
export function StoryTile({ w }: { w: StoryWidget }) {
  const { snapshot, maskFor, state } = useDashboard();
  const picked = state.controls[w.monthField]?.[0] ?? null;
  // Every month, with the other filters applied: the trend lines and the "month before" read from this.
  const allMonths = maskFor(w.id, { ignoreControls: [w.monthField] });
  const dates = snapshot.columns[w.dateField] ?? [];
  const { month, prev, months } = useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < snapshot.n; i++) if (allMonths[i] && typeof dates[i] === "number") set.add(periodStart(dates[i] as number, "month"));
    const sorted = [...set].sort((a, b) => a - b);
    const pickedT = picked ? sorted.find((t) => monthLabelOf(t) === picked) ?? null : null;
    const m = pickedT ?? (sorted.length ? sorted[sorted.length - 1] : null);
    const idx = m === null ? -1 : sorted.indexOf(m);
    return { month: m, prev: idx > 0 ? sorted[idx - 1] : null, months: sorted };
  }, [allMonths, dates, snapshot.n, picked]);
  const maskOf = (t: number | null) => {
    const out = new Uint8Array(snapshot.n);
    if (t === null) return out;
    for (let i = 0; i < snapshot.n; i++) if (allMonths[i] && typeof dates[i] === "number" && periodStart(dates[i] as number, "month") === t) out[i] = 1;
    return out;
  };
  const monthMask = useMemo(() => maskOf(month), [month, allMonths, dates, snapshot.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const prevMask = useMemo(() => maskOf(prev), [prev, allMonths, dates, snapshot.n]); // eslint-disable-line react-hooks/exhaustive-deps
  const values = useMemo(() => w.metrics.map((m) => ({
    now: computeMetric(snapshot, monthMask, m.metric),
    before: prev === null ? null : computeMetric(snapshot, prevMask, m.metric),
    series: timeSeries(snapshot, allMonths, w.dateField, "month", m.metric).slice(-12).map((p) => p.value),
  })), [snapshot, monthMask, prevMask, prev, allMonths, w.metrics, w.dateField]);
  if (month === null) return <section className="tile h-full w-full p-4 text-ink-3" aria-label={w.title}>No month in the current selection.</section>;
  const d = new Date(month), heading = `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const first = months[0], last = months[months.length - 1];
  const span = months.length > 1 ? `${monthLabelOf(first)} – ${monthLabelOf(last)} · ${months.length} months on the dashboard` : "1 month on the dashboard";
  const sentence = w.metrics.map((m, i) => `${formatNumber(values[i].now, m.metric.format ?? "integer", m.metric.currency)} ${m.label}`);
  return (
    <section className="tile h-full w-full" aria-label={w.title}>
      <div className="flex h-full flex-col justify-center px-4 pt-3 pb-3 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-baseline gap-3">
            <h3 className="text-[26px] font-bold leading-none tracking-[-0.02em] text-ink sm:text-[30px]">{heading}</h3>
            <span className="label">{picked ? "selected month" : "latest month"}</span>
          </div>
          <span className="num text-[14px] text-ink-3">{span}</span>
        </div>
        <p className="mt-2 max-w-[70ch] text-[15.5px] leading-snug text-ink-2">
          {sentence.map((s, i) => <span key={i}>{i > 0 && <span className="text-ink-4"> · </span>}<span className="num font-semibold text-ink">{s.split(" ")[0]}</span> {s.split(" ").slice(1).join(" ")}</span>)}
          {prev !== null && <span className="text-ink-3"> — against {MONTH_NAMES[new Date(prev).getUTCMonth()]}.</span>}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
          {w.metrics.map((m, i) => <Stat key={m.id} label={m.label} value={values[i].now} before={values[i].before} series={values[i].series} format={m.metric.format ?? "integer"} currency={m.metric.currency} good={m.good ?? "none"} prevLabel={prev === null ? null : MONTH_NAMES[new Date(prev).getUTCMonth()]} />)}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, before, series, format, currency, good, prevLabel }: { label: string; value: number | null; before: number | null; series: (number | null)[]; format: "integer" | "decimal" | "currency" | "percent" | "days"; currency?: string; good: "up" | "down" | "none"; prevLabel: string | null }) {
  const tw = useTween(value);
  const tip = useTooltip();
  const delta = value !== null && before !== null ? value - before : null;
  const tone = deltaTone(delta, good);
  return (
    <div className="flex min-w-0 items-end justify-between gap-2 border-t border-line pt-1.5" onPointerEnter={(e) => tip.show(e, { title: label, rows: [{ label: "This month", value: formatNumber(value, format, currency) }, ...(before !== null ? [{ label: prevLabel ?? "Month before", value: formatNumber(before, format, currency), muted: true }] : [])], note: "Trend: the last twelve months" })} onPointerMove={tip.move} onPointerLeave={tip.hide}>
      <div className="min-w-0">
        <div className="kpi-value" style={{ fontSize: 28 }}>{formatNumber(tw === null ? null : Math.round(tw * 10) / 10, format, currency, true)}</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[13.5px] text-ink-3">
          <span className="truncate">{label}</span>
          {delta !== null && <span className={`num whitespace-nowrap ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-ink-3"}`}>{delta > 0 ? "▲" : delta < 0 ? "▼" : "▬"} {delta > 0 ? "+" : ""}{formatNumber(delta, format, currency)}</span>}
        </div>
      </div>
      <div className="shrink-0 pb-1"><Sparkline values={series} width={72} height={26} /></div>
    </div>
  );
}

export { MONTH };

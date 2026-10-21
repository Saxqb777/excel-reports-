"use client";
import { useMemo } from "react";
import type { MonthsWidget } from "@/lib/dashboard/types";
import { computeMetric, groupBy } from "@/lib/engine/metrics";
import { formatNumber } from "@/lib/engine/format";
import { monthLabelOf } from "@/lib/dashboard/cadence";
import { periodStart } from "@/lib/schema/normalize";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { stackColor } from "@/lib/ui/colors";
import { useTooltip } from "@/lib/ui/tooltip";
import { Tile } from "./Tile";

/** One pill per month with a small stacked bar. Clicking a month filters the whole dashboard to it (the filter row's month select). */
export function MonthsTile({ w }: { w: MonthsWidget }) {
  const { snapshot, maskFor, state, dispatch, fields } = useDashboard();
  const tip = useTooltip();
  const picked = state.controls[w.monthField]?.[0] ?? null;
  const mask = maskFor(w.id, { ignoreControls: [w.monthField] });
  const dates = snapshot.columns[w.dateField] ?? [];
  const stackField = w.stackBy ? fields.get(w.stackBy) : undefined;
  const months = useMemo(() => {
    const buckets = new Map<number, number[]>();
    for (let i = 0; i < snapshot.n; i++) if (mask[i] && typeof dates[i] === "number") { const t = periodStart(dates[i] as number, "month"); buckets.set(t, [...(buckets.get(t) ?? []), i]); }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, idx]) => {
      const sub = new Uint8Array(snapshot.n);
      for (const i of idx) sub[i] = 1;
      const value = computeMetric(snapshot, sub, w.metric) ?? 0;
      const stacks = w.stackBy ? groupBy(snapshot, sub, w.stackBy, w.metric, { sort: "order", order: stackField?.order }) : [];
      return { t, label: monthLabelOf(t), value, stacks };
    });
  }, [snapshot, mask, dates, w.metric, w.stackBy, stackField]);
  const max = Math.max(1, ...months.map((m) => m.value));
  const keys = useMemo(() => { const s = new Set<string>(); months.forEach((m) => m.stacks.forEach((r) => s.add(r.key))); return [...(stackField?.order ?? []).filter((k) => s.has(k)), ...[...s].filter((k) => !(stackField?.order ?? []).includes(k))]; }, [months, stackField]);
  const pick = (label: string | null) => dispatch({ type: "control", field: w.monthField, values: label && label !== picked ? [label] : [] });
  const BAR_H = 40;
  return (
    <Tile title={w.title} subtitle={w.subtitle}>
      <div className="flex h-full items-stretch gap-1.5 overflow-x-auto pb-1 pt-1">
        <button type="button" onClick={() => pick(null)} className={`chip shrink-0 flex-col items-start justify-end gap-0 px-3 py-2 ${picked ? "" : "chip-on"}`} style={{ height: "auto" }} title="Every month">
          <span className="num text-[16px] font-semibold text-ink">{formatNumber(months.reduce((a, m) => a + m.value, 0), w.metric.format ?? "integer", w.metric.currency)}</span>
          <span className="text-[12.5px]">All months</span>
        </button>
        {months.map((m, mi) => {
          const on = picked === m.label, dim = picked !== null && !on;
          const showYear = mi === 0 || new Date(m.t).getUTCFullYear() !== new Date(months[mi - 1].t).getUTCFullYear();
          let cursor = 0;
          return (
            <button key={m.t} type="button" onClick={() => pick(m.label)} className={`chip min-w-[72px] shrink-0 flex-1 flex-col items-stretch justify-end gap-1 px-2.5 py-2 ${on ? "chip-on" : ""}`} style={{ height: "auto", opacity: dim ? 0.55 : 1, transition: "opacity 160ms ease" }} aria-pressed={on}
              onPointerEnter={(e) => tip.show(e, { title: m.label, rows: m.stacks.length ? m.stacks.map((r) => ({ label: r.key, value: formatNumber(r.value, w.metric.format ?? "integer", w.metric.currency), color: stackColor(r.key, keys.indexOf(r.key), "status") })) : [{ label: "Value", value: formatNumber(m.value, w.metric.format ?? "integer", w.metric.currency) }] })} onPointerMove={tip.move} onPointerLeave={tip.hide}>
              <span className="flex items-baseline justify-between gap-2"><span className="num text-[16px] font-semibold text-ink">{formatNumber(m.value, w.metric.format ?? "integer", w.metric.currency)}</span><span className="text-[12.5px] text-ink-3">{m.label.slice(0, 3)}{showYear ? ` ${m.label.slice(4)}` : ""}</span></span>
              <svg width="100%" height={BAR_H} className="block" aria-hidden>
                {(m.stacks.length ? m.stacks : [{ key: "all", value: m.value }]).map((s, si) => {
                  const h = (s.value / max) * BAR_H, y = BAR_H - cursor - h;
                  cursor += h;
                  return <rect key={s.key} x={0} y={y} width="100%" height={Math.max(0, h - (si > 0 ? 1 : 0))} fill={m.stacks.length ? stackColor(s.key, keys.indexOf(s.key), "status") : "var(--accent)"} rx={1} style={{ transition: "y 300ms ease, height 300ms ease" }} />;
                })}
              </svg>
            </button>
          );
        })}
      </div>
    </Tile>
  );
}

"use client";
import { useMemo } from "react";
import type { KpiWidget } from "@/lib/dashboard/types";
import { computeMetric, timeSeries } from "@/lib/engine/metrics";
import { formatNumber } from "@/lib/engine/format";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { useTween } from "@/lib/ui/tween";
import { Sparkline } from "@/components/charts/Sparkline";
import { useTooltip } from "@/lib/ui/tooltip";
import type { Anomaly } from "@/lib/intelligence/anomalies";

export function KpiTile({ w, anomaly }: { w: KpiWidget; anomaly?: Anomaly }) {
  const { snapshot, maskFor, dispatch, isSelected, baseMask } = useDashboard();
  const tip = useTooltip();
  const mask = maskFor(w.id);
  const value = useMemo(() => computeMetric(snapshot, mask, w.metric), [snapshot, mask, w.metric]);
  const all = useMemo(() => computeMetric(snapshot, baseMask, w.metric), [snapshot, baseMask, w.metric]);
  const secondary = useMemo(() => (w.secondary ? computeMetric(snapshot, mask, w.secondary.metric) : null), [snapshot, mask, w.secondary]);
  const spark = useMemo(() => (w.sparkline ? timeSeries(snapshot, mask, w.sparkline.dateField, w.sparkline.unit, w.metric).slice(-12) : null), [snapshot, mask, w.sparkline, w.metric]);
  const tw = useTween(value);
  const fmt = w.metric.format ?? "integer";
  const sel = isSelected(w.id);
  const filteredElsewhere = mask !== baseMask && value !== all;
  const click = () => {
    if (!w.onClick) return;
    dispatch({ type: "toggle", selection: { widgetId: w.id, field: "__kpi__", values: [], label: w.title, extra: w.onClick } });
  };
  return (
    <section className={`tile h-full w-full ${w.onClick ? "cursor-pointer" : ""} ${sel ? "bg-[var(--accent-wash)]" : ""}`} onClick={click} aria-label={w.title}
      onPointerEnter={(e) => filteredElsewhere && tip.show(e, { title: w.title, rows: [{ label: "In current selection", value: formatNumber(value, fmt, w.metric.currency) }, { label: "All filtered rows", value: formatNumber(all, fmt, w.metric.currency), muted: true }] })}
      onPointerMove={tip.move} onPointerLeave={tip.hide}>
      <div className="flex h-full flex-col justify-between px-3.5 pt-2.5 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="label-strong">{w.title}</div>
          <div className="flex items-center gap-1.5">
            {anomaly && <span className={`chip h-[18px] px-1.5 text-[10px] ${anomaly.tone === "neg" ? "border-neg text-neg" : "border-warn text-warn"}`} title={anomaly.detail}>unusual</span>}
            {sel && <span className="chip chip-on h-[18px] px-1.5 text-[10px]">filtering</span>}
          </div>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="kpi-value" aria-live="polite">{formatNumber(tw === null ? null : fmt === "percent" ? tw : Math.round(tw * 10) / 10, fmt, w.metric.currency, true)}</div>
            <div className="num mt-1.5 flex items-baseline gap-2 text-[11px] text-ink-3">
              {w.secondary && <span><span className="text-ink-2">{formatNumber(secondary, w.secondary.metric.format ?? "integer", w.secondary.metric.currency)}</span> {w.secondary.label}</span>}
              {filteredElsewhere && <span>{fmt === "percent" || fmt === "days" ? "overall" : "of"} {formatNumber(all, fmt, w.metric.currency, true)}</span>}
            </div>
          </div>
          {spark && spark.length >= 2 && <div className="shrink-0 pb-0.5"><Sparkline values={spark.map((p) => p.value)} /></div>}
        </div>
      </div>
    </section>
  );
}

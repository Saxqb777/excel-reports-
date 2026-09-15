"use client";
import { useMemo, useState } from "react";
import type { LineWidget } from "@/lib/dashboard/types";
import { timeSeries } from "@/lib/engine/metrics";
import { periodStart } from "@/lib/schema/normalize";
import { nextPeriod } from "@/lib/engine/metrics";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { TimeChart, labelFor } from "@/components/charts/TimeChart";
import { catVar } from "@/lib/ui/colors";
import { Tile, DataTable } from "./Tile";
import { formatNumber } from "@/lib/engine/format";
import { Empty } from "./BarTile";

export function TimeTile({ w }: { w: LineWidget }) {
  const { snapshot, maskFor, dispatch, isSelected } = useDashboard();
  const mask = maskFor(w.id);
  const data = useMemo(() => {
    const first = timeSeries(snapshot, mask, w.dateField, w.unit, w.series[0].metric);
    const times = first.map((p) => p.t);
    const series = w.series.map((s, i) => ({ label: s.label, kind: s.kind ?? (i === 0 ? "bar" : "line"), values: (i === 0 ? first : timeSeries(snapshot, mask, w.dateField, w.unit, s.metric)).map((p) => p.value) }));
    return { times, series };
  }, [snapshot, mask, w]);
  const sel = isSelected(w.id);
  const selectedT = sel?.extra && "and" in sel.extra ? null : sel ? Number(sel.values[0]) : null;
  const onSelect = (t: number) => {
    const end = nextPeriod(periodStart(t, w.unit), w.unit) - 1;
    dispatch({ type: "toggle", selection: { widgetId: w.id, field: w.dateField, values: [String(t)], label: labelFor(t, w.unit), extra: { field: w.dateField, op: "between", value: [t, end] } } });
  };
  const fmt = w.series[0].metric.format ?? "integer";
  const [table, setTable] = useState(false);
  return (
    <Tile title={w.title} subtitle={w.subtitle} selected={Boolean(sel)} onClear={() => dispatch({ type: "clearSelection", widgetId: w.id })} tableActive={table} onToggleTable={() => setTable((t) => !t)}
      right={data.series.length > 1 ? (
        <div className="flex items-center gap-3 text-[11px] text-ink-2">
          {data.series.map((s, i) => (
            <span key={s.label} className="flex items-center gap-1.5">
              {s.kind === "bar" ? <span className="inline-block h-[8px] w-[8px]" style={{ background: i === 0 ? "var(--accent)" : catVar(i) }} /> : <span className="inline-block h-[2px] w-3 bg-ink" />}
              {s.label}
            </span>
          ))}
        </div>
      ) : undefined}>
      {data.times.length === 0 ? <Empty /> : table ? <DataTable columns={["Period", ...data.series.map((s) => s.label)]} rows={data.times.map((t, i) => [labelFor(t, w.unit), ...data.series.map((s) => formatNumber(s.values[i], fmt, w.series[0].metric.currency))])} /> : <TimeChart times={data.times} series={data.series} unit={w.unit} format={fmt} currency={w.series[0].metric.currency} selected={selectedT} onSelect={onSelect} />}
    </Tile>
  );
}

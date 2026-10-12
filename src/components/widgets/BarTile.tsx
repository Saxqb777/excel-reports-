"use client";
import { useMemo, useState } from "react";
import type { BarWidget } from "@/lib/dashboard/types";
import { groupBy } from "@/lib/engine/metrics";
import { rowMatches } from "@/lib/engine/filters";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { HBars, Legend } from "@/components/charts/HBars";
import { VBars } from "@/components/charts/VBars";
import { Tile, DataTable } from "./Tile";
import { formatNumber, pct } from "@/lib/engine/format";

export function BarTile({ w }: { w: BarWidget }) {
  const { snapshot, maskFor, dispatch, isSelected, fields } = useDashboard();
  const baseMask = maskFor(w.id);
  // A chart about one slice of the table (one stream of a merged sheet) groups only that slice, so other slices'
  // categories do not appear as empty bars.
  const mask = useMemo(() => {
    if (!w.filter) return baseMask;
    const out = new Uint8Array(baseMask.length);
    for (let i = 0; i < baseMask.length; i++) out[i] = baseMask[i] && rowMatches(snapshot.columns, i, w.filter) ? 1 : 0;
    return out;
  }, [baseMask, w.filter, snapshot.columns]);
  const dim = fields.get(w.dimension);
  const stackField = w.stackBy ? fields.get(w.stackBy) : undefined;
  const rows = useMemo(() => groupBy(snapshot, mask, w.dimension, w.metric, { topN: w.topN, sort: w.sort ?? (dim?.order ? "order" : "value"), order: dim?.order, stackBy: w.stackBy, includeNull: w.includeNull, nullLabel: "Not set", fillOrder: Boolean(dim?.order) && !w.filter }), [snapshot, mask, w, dim]);
  const stackKeys = useMemo(() => {
    if (!w.stackBy) return undefined;
    const present = new Set<string>();
    rows.forEach((r) => Object.keys(r.stacks ?? {}).forEach((k) => present.add(k)));
    const ordered = [...(stackField?.order ?? []), ...(stackField?.allowedValues ?? [])].filter((k) => present.has(k));
    for (const k of present) if (!ordered.includes(k)) ordered.push(k);
    return ordered;
  }, [rows, w.stackBy, stackField]);
  const sel = isSelected(w.id);
  const onSelect = (key: string, stack?: string) => {
    const extra = stack && w.stackBy ? { field: w.stackBy, op: "eq" as const, value: stack } : undefined;
    dispatch({ type: "toggle", selection: { widgetId: w.id, field: w.dimension, values: [key], label: `${dim?.label ?? w.dimension} = ${key}${stack ? ` · ${stack}` : ""}`, extra } });
  };
  const selectedStack = sel?.extra && "field" in sel.extra ? String(sel.extra.value) : undefined;
  const [table, setTable] = useState(false);
  const total = rows.reduce((a, r) => a + r.value, 0);
  const fmt = w.metric.format ?? "integer";
  const Chart = w.orientation === "vertical" ? VBars : HBars;
  return (
    <Tile title={w.title} subtitle={w.subtitle} selected={Boolean(sel)} onClear={() => dispatch({ type: "clearSelection", widgetId: w.id })} tableActive={table} onToggleTable={() => setTable((t) => !t)}>
      {table ? (
        <DataTable columns={[dim?.label ?? w.dimension, ...(stackKeys ?? []), stackKeys ? "Total" : "Value", "Share"]} rows={rows.map((r) => [r.key, ...(stackKeys ?? []).map((k) => formatNumber(r.stacks?.[k] ?? 0, fmt, w.metric.currency)), formatNumber(r.value, fmt, w.metric.currency), pct(r.value, total)])} />
      ) : (
      <div className="flex h-full flex-col">
        {stackKeys && stackKeys.length > 1 && <div className="shrink-0 pb-1.5"><Legend keys={stackKeys} colorBy={w.colorBy ?? "status"} /></div>}
        <div className="min-h-0 flex-1">
          {rows.length === 0 ? <Empty /> : rows.filter((r) => r.value > 0).every((r) => r.key === "Not set") && rows.some((r) => r.value > 0) ? <Empty text="Nothing recorded in the sheet yet." /> : (
            <Chart rows={rows} stackKeys={stackKeys} colorBy={w.colorBy ?? (w.stackBy ? "status" : "single")} format={w.metric.format ?? "integer"} currency={w.metric.currency}
              selected={sel ? { key: sel.values[0], stack: selectedStack } : null} onSelect={onSelect} showShare={w.share !== false} />
          )}
        </div>
      </div>
      )}
    </Tile>
  );
}

export function Empty({ text = "No rows match the current filters." }: { text?: string }) {
  return <div className="flex h-full items-center justify-center text-[14.5px] text-ink-3">{text}</div>;
}

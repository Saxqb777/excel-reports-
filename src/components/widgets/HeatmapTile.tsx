"use client";
import { useMemo, useState } from "react";
import type { HeatmapWidget } from "@/lib/dashboard/types";
import { computeMetric } from "@/lib/engine/metrics";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { Heatmap, cellKey } from "@/components/charts/Heatmap";
import { Tile, DataTable } from "./Tile";
import { formatNumber } from "@/lib/engine/format";
import { Empty } from "./BarTile";

export function HeatmapTile({ w }: { w: HeatmapWidget }) {
  const { snapshot, maskFor, dispatch, isSelected, fields } = useDashboard();
  const mask = maskFor(w.id);
  const rf = fields.get(w.rowDim), cf = fields.get(w.colDim);
  const data = useMemo(() => {
    const rc = snapshot.columns[w.rowDim] ?? [], cc = snapshot.columns[w.colDim] ?? [];
    const rows = new Set<string>(), cols = new Set<string>();
    const idx = new Map<string, number[]>();
    for (let i = 0; i < snapshot.n; i++) {
      if (!mask[i] || rc[i] === null || cc[i] === null) continue;
      const r = String(rc[i]), c = String(cc[i]);
      rows.add(r); cols.add(c);
      const k = cellKey(r, c);
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k)!.push(i);
    }
    const cells: Record<string, number> = {};
    for (const [k, is] of idx) {
      const sub = new Uint8Array(snapshot.n);
      for (const i of is) sub[i] = 1;
      cells[k] = computeMetric(snapshot, sub, w.metric) ?? 0;
    }
    const orderBy = (set: Set<string>, order?: string[]) => { const o = [...(order ?? [])]; for (const x of set) if (!o.includes(x)) o.push(x); return o; };
    return { rows: orderBy(rows, rf?.order), cols: orderBy(cols, cf?.order), cells };
  }, [snapshot, mask, w, rf, cf]);
  const sel = isSelected(w.id);
  const [table, setTable] = useState(false);
  return (
    <Tile title={w.title} subtitle={w.subtitle} selected={Boolean(sel)} onClear={() => dispatch({ type: "clearSelection", widgetId: w.id })} tableActive={table} onToggleTable={() => setTable((t) => !t)}>
      {data.rows.length === 0 ? <Empty /> : table ? <DataTable columns={[rf?.label ?? w.rowDim, ...data.cols]} rows={data.rows.map((r) => [r, ...data.cols.map((c) => formatNumber(data.cells[cellKey(r, c)] ?? 0, w.metric.format ?? "integer", w.metric.currency))])} /> : <Heatmap rows={data.rows} cols={data.cols} cells={data.cells} format={w.metric.format ?? "integer"} currency={w.metric.currency}
        onSelect={(r, c) => dispatch({ type: "toggle", selection: { widgetId: w.id, field: w.rowDim, values: [r], label: `${rf?.label ?? w.rowDim} = ${r} · ${cf?.label ?? w.colDim} = ${c}`, extra: { field: w.colDim, op: "eq", value: c } } })} />}
    </Tile>
  );
}

"use client";
import { useMemo, useState } from "react";
import type { TreemapWidget } from "@/lib/dashboard/types";
import { groupBy } from "@/lib/engine/metrics";
import { formatNumber } from "@/lib/engine/format";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { useTooltip } from "@/lib/ui/tooltip";
import { useSize } from "@/components/charts/useSize";
import { Tile, DataTable } from "./Tile";
import { segmentColor } from "./segments";

interface Box { key: string; group: string; value: number; x: number; y: number; w: number; h: number; color: string }

/** Squarified treemap (Bruls, Huizing, van Wijk): lays `items` (sorted desc) into the rectangle, returns boxes. */
function squarify<T extends { value: number }>(items: T[], x: number, y: number, w: number, h: number): (T & { x: number; y: number; w: number; h: number })[] {
  const out: (T & { x: number; y: number; w: number; h: number })[] = [];
  const total = items.reduce((a, i) => a + i.value, 0);
  if (total <= 0 || w <= 0 || h <= 0) return out;
  const scale = (w * h) / total;
  let row: T[] = [], rest = items.slice(), rx = x, ry = y, rw = w, rh = h;
  const worst = (r: T[], side: number) => {
    const s = r.reduce((a, i) => a + i.value * scale, 0);
    if (!s) return Infinity;
    let mx = 0, mn = Infinity;
    for (const i of r) { const a = i.value * scale; mx = Math.max(mx, a); mn = Math.min(mn, a); }
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const layoutRow = (r: T[]) => {
    const s = r.reduce((a, i) => a + i.value * scale, 0);
    const horizontal = rw >= rh; // row laid along the shorter side
    if (horizontal) {
      const colW = s / rh;
      let cy = ry;
      for (const i of r) { const ih = (i.value * scale) / colW; out.push({ ...i, x: rx, y: cy, w: colW, h: ih }); cy += ih; }
      rx += colW; rw -= colW;
    } else {
      const rowH = s / rw;
      let cx = rx;
      for (const i of r) { const iw = (i.value * scale) / rowH; out.push({ ...i, x: cx, y: ry, w: iw, h: rowH }); cx += iw; }
      ry += rowH; rh -= rowH;
    }
  };
  while (rest.length) {
    const side = Math.min(rw, rh);
    const next = rest[0];
    if (!row.length || worst([...row, next], side) <= worst(row, side)) { row.push(next); rest = rest.slice(1); }
    else { layoutRow(row); row = []; }
  }
  if (row.length) layoutRow(row);
  return out;
}

/** Nested boxes: one per dimension value, sized by the metric, coloured by its group. Clicking a box filters the dashboard. */
export function TreemapTile({ w }: { w: TreemapWidget }) {
  const { snapshot, maskFor, dispatch, isSelected, fields } = useDashboard();
  const tip = useTooltip();
  const [ref, size] = useSize<HTMLDivElement>();
  const [table, setTable] = useState(false);
  const mask = maskFor(w.id);
  const fmt = w.metric.format ?? "integer";
  const rows = useMemo(() => groupBy(snapshot, mask, w.dimension, w.metric, { sort: "value" }).filter((r) => r.value > 0), [snapshot, mask, w.dimension, w.metric]);
  const groupOf = useMemo(() => {
    const out = new Map<string, string>();
    if (!w.groupBy) return out;
    const dim = snapshot.columns[w.dimension], grp = snapshot.columns[w.groupBy];
    const votes = new Map<string, Map<string, number>>();
    for (let i = 0; i < snapshot.n; i++) {
      if (!mask[i] || dim[i] === null || grp[i] === null) continue;
      const k = String(dim[i]), g = String(grp[i]);
      const m = votes.get(k) ?? new Map<string, number>();
      m.set(g, (m.get(g) ?? 0) + 1); votes.set(k, m);
    }
    for (const [k, m] of votes) out.set(k, [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    return out;
  }, [snapshot, mask, w.dimension, w.groupBy]);
  const groups = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of rows) { const g = groupOf.get(r.key) ?? "All"; totals.set(g, (totals.get(g) ?? 0) + r.value); }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([key, value], i) => ({ key, value, color: segmentColor(key, i) }));
  }, [rows, groupOf]);
  const total = rows.reduce((a, r) => a + r.value, 0);
  const W = Math.max(10, size.width), H = Math.max(10, size.height - (groups.length > 1 ? 26 : 0));
  const boxes = useMemo<Box[]>(() => {
    const gap = 3;
    if (groups.length <= 1) return squarify(rows.map((r) => ({ ...r, group: groups[0]?.key ?? "All", color: groups[0]?.color ?? "var(--c1)" })), 0, 0, W, H);
    const outer = squarify(groups, 0, 0, W, H);
    const out: Box[] = [];
    for (const g of outer) {
      const inner = rows.filter((r) => (groupOf.get(r.key) ?? "All") === g.key).map((r) => ({ ...r, group: g.key, color: g.color }));
      out.push(...squarify(inner, g.x + gap / 2, g.y + gap / 2, Math.max(0, g.w - gap), Math.max(0, g.h - gap)));
    }
    return out;
  }, [rows, groups, groupOf, W, H]);
  const sel = isSelected(w.id);
  const onSelect = (key: string) => dispatch({ type: "toggle", selection: { widgetId: w.id, field: w.dimension, values: [key], label: `${fields.get(w.dimension)?.label ?? w.dimension} = ${key}` } });
  return (
    <Tile title={w.title} subtitle={w.subtitle} selected={Boolean(sel)} onClear={() => dispatch({ type: "clearSelection", widgetId: w.id })} padded={false} tableActive={table} onToggleTable={() => setTable((t) => !t)}>
      {table ? (
        <div className="h-full px-3.5 pb-3"><DataTable columns={[fields.get(w.dimension)?.label ?? "Item", ...(w.groupBy ? [fields.get(w.groupBy)?.label ?? "Group"] : []), "Amount", "Share"]} rows={rows.map((r) => [r.key, ...(w.groupBy ? [groupOf.get(r.key) ?? "–"] : []), formatNumber(r.value, fmt, w.metric.currency), total ? `${Math.round((r.value / total) * 100)}%` : "–"])} /></div>
      ) : (
        <div className="flex h-full flex-col px-3 pb-2.5">
          <div ref={ref} className="relative min-h-0 flex-1">
            {size.width > 0 && (
              <svg width={W} height={H} className="block" role="img" aria-label={w.title}>
                {boxes.map((b) => {
                  const on = sel?.values[0] === b.key, dimmed = Boolean(sel) && !on;
                  const share = total ? b.value / total : 0;
                  const big = b.w > 70 && b.h > 34, mid = b.w > 44 && b.h > 22;
                  return (
                    <g key={b.key} className="cursor-pointer" opacity={dimmed ? 0.35 : 1} style={{ transition: "opacity 160ms ease" }} onClick={() => onSelect(b.key)}
                      onPointerEnter={(e) => tip.show(e, { title: b.key, rows: [{ label: "Amount", value: formatNumber(b.value, fmt, w.metric.currency), color: b.color }, { label: "Share", value: `${(share * 100).toFixed(1)}%` }, ...(w.groupBy ? [{ label: fields.get(w.groupBy)?.label ?? "Group", value: b.group }] : [])], note: "Click to filter the dashboard" })} onPointerMove={tip.move} onPointerLeave={tip.hide}>
                      <rect x={b.x + 1} y={b.y + 1} width={Math.max(0, b.w - 2)} height={Math.max(0, b.h - 2)} rx={6} fill={b.color} fillOpacity={on ? 1 : 0.82} stroke={on ? "var(--ink)" : "var(--bg-elev)"} strokeWidth={on ? 2 : 1} style={{ transition: "all 300ms ease" }} />
                      {mid && (
                        <foreignObject x={b.x + 6} y={b.y + 4} width={Math.max(0, b.w - 12)} height={Math.max(0, b.h - 8)} style={{ pointerEvents: "none" }}>
                          <div style={{ color: "var(--on-mark)", fontFamily: "var(--font-ui)", lineHeight: 1.15, overflow: "hidden", height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-start" }}>
                            <div style={{ fontSize: big ? 13 : 11.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: big ? 2 : 1, WebkitBoxOrient: "vertical" }}>{b.key}</div>
                            {big && <div className="num" style={{ fontSize: 12.5, fontWeight: 700, marginTop: 2, fontFamily: "var(--font-num)" }}>{formatNumber(b.value, fmt, w.metric.currency, true)} · {Math.round(share * 100)}%</div>}
                          </div>
                        </foreignObject>
                      )}
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
          {groups.length > 1 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-ink-2">
              {groups.map((g) => <span key={g.key} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: g.color }} />{g.key} <span className="num text-ink-3">{total ? `${Math.round((g.value / total) * 100)}%` : ""}</span></span>)}
            </div>
          )}
        </div>
      )}
    </Tile>
  );
}

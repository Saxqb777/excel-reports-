"use client";
import { useMemo } from "react";
import type { SpotlightWidget } from "@/lib/dashboard/types";
import { computeMetric, groupBy } from "@/lib/engine/metrics";
import { formatNumber } from "@/lib/engine/format";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { Tile } from "./Tile";

/**
 * A grid of callout cards: for each dimension, the one value that tops the metric, with its share of the total (or the
 * overall figure when the metric is a ratio). Clicking a card filters the dashboard to that value.
 */
export function SpotlightTile({ w }: { w: SpotlightWidget }) {
  const { snapshot, maskFor, dispatch, isSelected, fields } = useDashboard();
  const mask = maskFor(w.id);
  const fmt = w.metric.format ?? "integer";
  const isRatio = w.metric.agg === "ratio" || w.metric.agg === "avg" || w.metric.agg === "rate" || w.metric.agg === "median";
  const total = useMemo(() => computeMetric(snapshot, mask, w.metric), [snapshot, mask, w.metric]);
  const cards = useMemo(() => w.items.map((item) => {
    let rows = groupBy(snapshot, mask, item.dimension, w.metric, { sort: "value" });
    if (w.minCount && w.countMetric) {
      const col = snapshot.columns[item.dimension];
      rows = rows.filter((r) => {
        const sub = new Uint8Array(snapshot.n);
        for (let i = 0; i < snapshot.n; i++) if (mask[i] && String(col[i]) === r.key) sub[i] = 1;
        return (computeMetric(snapshot, sub, w.countMetric!) ?? 0) >= w.minCount!;
      });
    }
    const top = rows[0] ?? null;
    const second = rows[1] ?? null;
    return { ...item, top, second, n: rows.length };
  }), [snapshot, mask, w.items, w.metric, w.minCount, w.countMetric]);
  const sel = isSelected(w.id);
  const onSelect = (dimension: string, key: string) => dispatch({ type: "toggle", selection: { widgetId: w.id, field: dimension, values: [key], label: `${fields.get(dimension)?.label ?? dimension} = ${key}` } });
  return (
    <Tile title={w.title} subtitle={w.subtitle} selected={Boolean(sel)} onClear={() => dispatch({ type: "clearSelection", widgetId: w.id })}>
      <div className="grid h-full grid-cols-2 gap-2.5 pt-1" style={{ gridAutoRows: "minmax(0, 1fr)" }}>
        {cards.map((c, i) => {
          const on = sel && sel.field === c.dimension && sel.values[0] === c.top?.key;
          const dimmed = Boolean(sel) && !on;
          const share = !isRatio && total ? (c.top?.value ?? 0) / total : null;
          const vsAll = isRatio && total ? (c.top?.value ?? 0) / total - 1 : null;
          return (
            <button key={`${c.dimension}-${i}`} type="button" disabled={!c.top} onClick={() => c.top && onSelect(c.dimension, c.top.key)}
              className={`spot-card flex min-h-0 flex-col justify-center gap-2.5 rounded-[14px] px-3.5 py-3 text-left transition ${on ? "spot-on" : ""}`} style={{ opacity: dimmed ? 0.5 : 1 }} title={c.second ? `Next: ${c.second.key} · ${formatNumber(c.second.value, fmt, w.metric.currency, true)}` : undefined}>
              <div className="label text-ink-3">{c.label}</div>
              <div className="min-w-0">
                <div className="truncate text-[18px] font-semibold leading-tight text-ink">{c.top?.key ?? "–"}</div>
                <div className="num mt-1 text-[22px] font-bold leading-none text-ink" style={{ fontFamily: "var(--font-num)" }}>{formatNumber(c.top?.value ?? null, fmt, w.metric.currency, true, w.metric.decimals)}</div>
                <div className="mt-1.5 flex items-center gap-2 text-[13px] text-ink-3">
                  {share !== null && <span className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--line)" }}><span className="block h-full rounded-full" style={{ width: `${Math.min(100, share * 100)}%`, background: "var(--accent)", transition: "width 400ms ease" }} /></span>}
                  <span className="num whitespace-nowrap">{share !== null ? `${Math.round(share * 100)}% of total` : vsAll !== null ? `${vsAll >= 0 ? "+" : ""}${Math.round(vsAll * 100)}% vs overall` : ""}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </Tile>
  );
}

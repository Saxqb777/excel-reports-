"use client";
import { useMemo } from "react";
import type { BarWidget } from "@/lib/dashboard/types";
import { groupBy } from "@/lib/engine/metrics";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { HBars, Legend } from "@/components/charts/HBars";
import { Tile } from "./Tile";

export function BarTile({ w }: { w: BarWidget }) {
  const { snapshot, maskFor, dispatch, isSelected, fields } = useDashboard();
  const mask = maskFor(w.id);
  const dim = fields.get(w.dimension);
  const stackField = w.stackBy ? fields.get(w.stackBy) : undefined;
  const rows = useMemo(() => groupBy(snapshot, mask, w.dimension, w.metric, { topN: w.topN, sort: w.sort ?? (dim?.order ? "order" : "value"), order: dim?.order, stackBy: w.stackBy, includeNull: w.includeNull, nullLabel: "Not set" }), [snapshot, mask, w, dim]);
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
  return (
    <Tile title={w.title} subtitle={w.subtitle} selected={Boolean(sel)} onClear={() => dispatch({ type: "clearSelection", widgetId: w.id })}>
      <div className="flex h-full flex-col">
        {stackKeys && stackKeys.length > 1 && <div className="shrink-0 pb-1.5"><Legend keys={stackKeys} colorBy={w.colorBy ?? "status"} /></div>}
        <div className="min-h-0 flex-1">
          {rows.length === 0 ? <Empty /> : (
            <HBars rows={rows} stackKeys={stackKeys} colorBy={w.colorBy ?? (w.stackBy ? "status" : "single")} format={w.metric.format ?? "integer"} currency={w.metric.currency}
              selected={sel ? { key: sel.values[0], stack: selectedStack } : null} onSelect={onSelect} />
          )}
        </div>
      </div>
    </Tile>
  );
}

export function Empty({ text = "No rows match the current filters." }: { text?: string }) {
  return <div className="flex h-full items-center justify-center text-[12px] text-ink-3">{text}</div>;
}

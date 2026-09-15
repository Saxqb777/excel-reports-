"use client";
import { useMemo } from "react";
import type { FunnelWidget } from "@/lib/dashboard/types";
import { computeMetric } from "@/lib/engine/metrics";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { Funnel } from "@/components/charts/Funnel";
import { Tile } from "./Tile";

export function FunnelTile({ w }: { w: FunnelWidget }) {
  const { snapshot, maskFor, dispatch, isSelected } = useDashboard();
  const mask = maskFor(w.id);
  const stages = useMemo(() => w.stages.map((s, i) => ({ label: s.label, value: computeMetric(snapshot, mask, { agg: "count", filter: s.filter }) ?? 0, tone: s.status ?? "accent", sub: i >= 2 })), [snapshot, mask, w.stages]);
  const sel = isSelected(w.id);
  const onSelect = (label: string) => {
    const stage = w.stages.find((s) => s.label === label);
    if (!stage) return;
    dispatch({ type: "toggle", selection: { widgetId: w.id, field: "__funnel__", values: [label], label: `Stage: ${label}`, extra: stage.filter } });
  };
  return (
    <Tile title={w.title} subtitle={w.subtitle} selected={Boolean(sel)} onClear={() => dispatch({ type: "clearSelection", widgetId: w.id })}>
      <Funnel stages={stages} selected={sel?.values[0] ?? null} onSelect={onSelect} />
    </Tile>
  );
}

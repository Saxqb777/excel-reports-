"use client";
import { useMemo } from "react";
import type { DotsWidget } from "@/lib/dashboard/types";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { Dots, type DotPoint } from "@/components/charts/Dots";
import { Tile } from "./Tile";
import { Empty } from "./BarTile";

export function DotsTile({ w }: { w: DotsWidget }) {
  const { snapshot, maskFor, dispatch, isSelected, fields } = useDashboard();
  const mask = maskFor(w.id);
  const laneField = w.colorField ? fields.get(w.colorField) : undefined;
  const { points, lanes } = useMemo(() => {
    const vals = snapshot.columns[w.valueField] ?? [];
    const labels = w.labelField ? snapshot.columns[w.labelField] : undefined;
    const laneCol = w.colorField ? snapshot.columns[w.colorField] : undefined;
    const descCol = snapshot.columns["request_description"] ?? snapshot.columns[snapshot.fields.find((f) => f.semantic === "description")?.id ?? ""];
    const pts: DotPoint[] = [];
    for (let i = 0; i < snapshot.n; i++) {
      if (!mask[i]) continue;
      const v = vals[i];
      if (typeof v !== "number") continue;
      pts.push({ id: String(i), label: labels ? String(labels[i] ?? i) : `Row ${i + 1}`, value: v, lane: laneCol ? String(laneCol[i] ?? "Not set") : "All", detail: descCol ? String(descCol[i] ?? "") : undefined });
    }
    const present = [...new Set(pts.map((p) => p.lane))];
    const ordered = [...(laneField?.order ?? [])].filter((l) => present.includes(l));
    for (const l of present) if (!ordered.includes(l)) ordered.push(l);
    return { points: pts, lanes: ordered.length ? ordered : ["All"] };
  }, [snapshot, mask, w, laneField]);
  const sel = isSelected(w.id);
  const onSelect = (lane: string) => { if (w.colorField) dispatch({ type: "toggle", selection: { widgetId: w.id, field: w.colorField, values: [lane], label: `${laneField?.label ?? w.colorField} = ${lane}` } }); };
  return (
    <Tile title={w.title} subtitle={w.subtitle} selected={Boolean(sel)} onClear={() => dispatch({ type: "clearSelection", widgetId: w.id })}>
      {points.length === 0 ? <Empty text="No values yet for this measure." /> : <Dots points={points} lanes={lanes} target={w.target} targetLabel={w.targetLabel} format={w.format ?? "days"} selectedLane={sel?.values[0] ?? null} onSelect={onSelect} />}
    </Tile>
  );
}

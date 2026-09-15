import type { FilterExpr, SchemaMap, Snapshot } from "@/lib/schema/types";
import type { KpiWidget, Layout } from "@/lib/dashboard/types";
import { computeMetric, timeSeries } from "@/lib/engine/metrics";
import { buildMask } from "@/lib/engine/filters";
import { formatDate, formatNumber } from "@/lib/engine/format";

export interface Anomaly {
  id: string;
  scope: "metric" | "row" | "period";
  label: string;
  value: number;
  expected: number;
  z: number;
  detail: string;
  tone: "warn" | "neg";
  widgetId?: string;
  fieldId?: string;
  rowId?: string;
  filter?: FilterExpr;
}

export interface MetricHistoryPoint { version: number; values: Record<string, number | null> }

function median(xs: number[]): number { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function mad(xs: number[], med: number): number { return median(xs.map((x) => Math.abs(x - med))); }
/** Robust z-score: (x - median) / (1.4826 * MAD). Falls back to a scaled mean deviation when MAD is zero. */
function robustZ(x: number, xs: number[]): number {
  if (xs.length < 4) return 0;
  const med = median(xs);
  const m = mad(xs, med);
  if (m > 0) return (x - med) / (1.4826 * m);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return sd > 0 ? (x - mean) / sd : 0;
}

export function kpiValues(snapshot: Snapshot, layout: Layout): Record<string, number | null> {
  const mask = buildMask(snapshot.columns, snapshot.n, []);
  const out: Record<string, number | null> = {};
  for (const p of layout.pages) for (const w of p.widgets) if (w.type === "kpi") out[w.id] = computeMetric(snapshot, mask, w.metric);
  return out;
}

export function computeAnomalies({ current, history, schema, layout }: { current: Snapshot; history: MetricHistoryPoint[]; schema: SchemaMap; layout: Layout }): Anomaly[] {
  const out: Anomaly[] = [];
  const kpis = layout.pages.flatMap((p) => p.widgets.filter((w): w is KpiWidget => w.type === "kpi"));
  const nowVals = kpiValues(current, layout);

  // Metric vs its own history (previous versions).
  for (const w of kpis) {
    const v = nowVals[w.id];
    if (v === null || v === undefined) continue;
    const past = history.filter((h) => h.version !== current.version).map((h) => h.values[w.id]).filter((x): x is number => typeof x === "number");
    if (past.length < 4) continue;
    const z = robustZ(v, past);
    if (Math.abs(z) >= 3) {
      const med = median(past);
      out.push({ id: `metric_${w.id}`, scope: "metric", widgetId: w.id, label: w.title, value: v, expected: med, z, tone: Math.abs(z) >= 5 ? "neg" : "warn", filter: w.onClick,
        detail: `${w.title} is ${formatNumber(v, w.metric.format ?? "integer", w.metric.currency, true)}, against a typical ${formatNumber(med, w.metric.format ?? "integer", w.metric.currency, true)} across the last ${past.length} versions.` });
    }
  }

  // Row-level outliers on measures.
  const idField = schema.idField;
  for (const f of current.fields.filter((x) => x.role === "measure" && x.type === "number")) {
    const col = current.columns[f.id] ?? [];
    const vals: number[] = [];
    for (const v of col) if (typeof v === "number") vals.push(v);
    if (vals.length < 6) continue;
    const med = median(vals);
    for (let i = 0; i < current.n; i++) {
      const v = col[i];
      if (typeof v !== "number") continue;
      const z = robustZ(v, vals);
      if (Math.abs(z) >= 4 && Math.abs(v - med) >= (f.format === "days" ? 3 : 0)) {
        const rowId = idField ? String(current.columns[idField]?.[i] ?? current.rowRefs[i]) : `row ${current.rowRefs[i]}`;
        out.push({ id: `row_${f.id}_${i}`, scope: "row", fieldId: f.id, rowId, label: `${rowId} · ${f.label}`, value: v, expected: med, z, tone: Math.abs(z) >= 6 ? "neg" : "warn",
          detail: `${rowId} has ${f.label.toLowerCase()} of ${formatNumber(v, f.format === "date" || f.format === "text" ? "integer" : f.format ?? "integer", f.currency)}; the typical value is ${formatNumber(med, f.format === "date" || f.format === "text" ? "integer" : f.format ?? "integer", f.currency)}.`,
          filter: idField ? { field: idField, op: "eq", value: rowId } : undefined });
      }
    }
  }

  // Period spikes on the primary date.
  if (layout.dateField) {
    const series = timeSeries(current, buildMask(current.columns, current.n, []), layout.dateField, "week", { agg: "count" });
    const counts = series.map((p) => p.value ?? 0);
    if (counts.length >= 6) {
      series.forEach((p, i) => {
        const z = robustZ(counts[i], counts.filter((_, j) => j !== i));
        if (Math.abs(z) >= 3 && counts[i] > 0) out.push({ id: `period_${p.t}`, scope: "period", label: `Week of ${formatDate(p.t, "long")}`, value: counts[i], expected: median(counts), z, tone: "warn", detail: `${counts[i]} rows in the week of ${formatDate(p.t, "long")}, against a typical ${median(counts)} per week.`, filter: { field: layout.dateField!, op: "between", value: [p.t, p.t + 7 * 86_400_000 - 1] } });
      });
    }
  }
  return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 12);
}

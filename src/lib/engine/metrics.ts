import type { ColumnValue, Field, FilterExpr, Snapshot } from "@/lib/schema/types";
import { periodStart } from "@/lib/schema/normalize";
import { rowMatches } from "./filters";

export type Agg = "count" | "sum" | "avg" | "median" | "min" | "max" | "distinct" | "rate";

export interface MetricSpec {
  agg: Agg;
  field?: string;
  /** Rows counted/aggregated must match this. */
  filter?: FilterExpr;
  /** For rate: numerator filter / denominator filter (denominator defaults to filter or all). */
  numerator?: FilterExpr;
  denominator?: FilterExpr;
  format?: "integer" | "decimal" | "currency" | "percent" | "days";
  currency?: string;
}

type Columns = Record<string, ColumnValue[]>;

function collect(columns: Columns, n: number, mask: Uint8Array, m: MetricSpec): number[] {
  const col = m.field ? columns[m.field] : undefined;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    if (m.filter && !rowMatches(columns, i, m.filter)) continue;
    if (!col) { out.push(1); continue; }
    const v = col[i];
    if (typeof v === "number") out.push(v);
  }
  return out;
}

export function computeMetric(snapshot: Pick<Snapshot, "columns" | "n">, mask: Uint8Array, m: MetricSpec): number | null {
  const { columns, n } = snapshot;
  if (m.agg === "count") {
    let c = 0;
    const col = m.field ? columns[m.field] : undefined;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      if (m.filter && !rowMatches(columns, i, m.filter)) continue;
      if (col && col[i] === null) continue;
      c++;
    }
    return c;
  }
  if (m.agg === "rate") {
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      if (m.filter && !rowMatches(columns, i, m.filter)) continue;
      const inDen = m.denominator ? rowMatches(columns, i, m.denominator) : true;
      if (!inDen) continue;
      den++;
      if (m.numerator && rowMatches(columns, i, m.numerator)) num++;
    }
    return den === 0 ? null : num / den;
  }
  if (m.agg === "distinct") {
    const col = m.field ? columns[m.field] : undefined;
    if (!col) return null;
    const s = new Set<ColumnValue>();
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      if (m.filter && !rowMatches(columns, i, m.filter)) continue;
      if (col[i] !== null) s.add(col[i]);
    }
    return s.size;
  }
  const vals = collect(columns, n, mask, m);
  if (vals.length === 0) return null;
  switch (m.agg) {
    case "sum": return vals.reduce((a, b) => a + b, 0);
    case "avg": return vals.reduce((a, b) => a + b, 0) / vals.length;
    case "min": return Math.min(...vals);
    case "max": return Math.max(...vals);
    case "median": {
      const s = [...vals].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }
  }
  return null;
}

export interface GroupRow { key: string; value: number; count: number; stacks?: Record<string, number> }

export interface GroupOptions { topN?: number; sort?: "value" | "key" | "order"; order?: string[]; stackBy?: string; includeNull?: boolean; nullLabel?: string }

export function groupBy(snapshot: Pick<Snapshot, "columns" | "n">, mask: Uint8Array, dimension: string, metric: MetricSpec, opts: GroupOptions = {}): GroupRow[] {
  const { columns, n } = snapshot;
  const dim = columns[dimension];
  if (!dim) return [];
  const nullLabel = opts.nullLabel ?? "Not set";
  const groups = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const k = dim[i] === null ? (opts.includeNull ? nullLabel : null) : String(dim[i]);
    if (k === null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  }
  const stackCol = opts.stackBy ? columns[opts.stackBy] : undefined;
  const rows: GroupRow[] = [];
  for (const [key, idx] of groups) {
    const sub = new Uint8Array(n);
    for (const i of idx) sub[i] = 1;
    const value = computeMetric(snapshot, sub, metric) ?? 0;
    const row: GroupRow = { key, value, count: idx.length };
    if (stackCol) {
      const stacks: Record<string, number> = {};
      for (const i of idx) {
        if (metric.filter && !rowMatches(columns, i, metric.filter)) continue;
        const s = stackCol[i] === null ? nullLabel : String(stackCol[i]);
        stacks[s] = (stacks[s] ?? 0) + (metric.agg === "count" ? 1 : (typeof columns[metric.field!]?.[i] === "number" ? (columns[metric.field!][i] as number) : 0));
      }
      row.stacks = stacks;
    }
    rows.push(row);
  }
  const sort = opts.sort ?? "value";
  if (sort === "value") rows.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  else if (sort === "key") rows.sort((a, b) => a.key.localeCompare(b.key));
  else if (sort === "order" && opts.order) {
    const pos = new Map(opts.order.map((k, i) => [k.toLowerCase(), i]));
    rows.sort((a, b) => (pos.get(a.key.toLowerCase()) ?? 999) - (pos.get(b.key.toLowerCase()) ?? 999));
  }
  if (opts.topN && rows.length > opts.topN) {
    const head = rows.slice(0, opts.topN);
    const tail = rows.slice(opts.topN);
    const other: GroupRow = { key: "Other", value: tail.reduce((a, r) => a + r.value, 0), count: tail.reduce((a, r) => a + r.count, 0) };
    if (stackCol) {
      other.stacks = {};
      for (const r of tail) for (const [k, v] of Object.entries(r.stacks ?? {})) other.stacks[k] = (other.stacks[k] ?? 0) + v;
    }
    return [...head, other];
  }
  return rows;
}

export interface SeriesPoint { t: number; value: number | null; count: number }

export function timeSeries(snapshot: Pick<Snapshot, "columns" | "n">, mask: Uint8Array, dateField: string, unit: "week" | "month" | "day", metric: MetricSpec, fill = true): SeriesPoint[] {
  const { columns, n } = snapshot;
  const col = columns[dateField];
  if (!col) return [];
  const buckets = new Map<number, number[]>();
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    const v = col[i];
    if (typeof v !== "number") continue;
    const t = periodStart(v, unit);
    if (t < min) min = t;
    if (t > max) max = t;
    if (!buckets.has(t)) buckets.set(t, []);
    buckets.get(t)!.push(i);
  }
  if (!Number.isFinite(min)) return [];
  const keys: number[] = [];
  if (fill) {
    let t = min;
    while (t <= max) {
      keys.push(t);
      t = nextPeriod(t, unit);
    }
  } else keys.push(...[...buckets.keys()].sort((a, b) => a - b));
  return keys.map((t) => {
    const idx = buckets.get(t) ?? [];
    const sub = new Uint8Array(n);
    for (const i of idx) sub[i] = 1;
    const value = idx.length ? computeMetric(snapshot, sub, metric) : (metric.agg === "count" || metric.agg === "sum" ? 0 : null);
    return { t, value, count: idx.length };
  });
}

export function nextPeriod(t: number, unit: "week" | "month" | "day"): number {
  const d = new Date(t);
  if (unit === "day") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  if (unit === "week") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 7);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export function distinctValues(snapshot: Pick<Snapshot, "columns" | "n">, field: string, mask?: Uint8Array): { value: string; count: number }[] {
  const col = snapshot.columns[field];
  if (!col) return [];
  const m = new Map<string, number>();
  for (let i = 0; i < snapshot.n; i++) {
    if (mask && !mask[i]) continue;
    const v = col[i];
    if (v === null) continue;
    const k = String(v);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function fieldById(fields: Field[], id: string): Field | undefined {
  return fields.find((f) => f.id === id);
}

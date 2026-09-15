import type { ColumnValue, FilterExpr } from "@/lib/schema/types";
import { normKey } from "@/lib/schema/types";

type Columns = Record<string, ColumnValue[]>;

function leaf(v: ColumnValue, op: string, value: unknown): boolean {
  switch (op) {
    case "isNull": return v === null;
    case "notNull": return v !== null;
    case "eq": return v !== null && (typeof v === "string" ? normKey(v) === normKey(value) : v === value);
    case "neq": return v === null || (typeof v === "string" ? normKey(v) !== normKey(value) : v !== value);
    case "in": return v !== null && Array.isArray(value) && value.some((x) => (typeof v === "string" ? normKey(v) === normKey(x) : v === x));
    case "nin": return v === null || !(Array.isArray(value) && value.some((x) => (typeof v === "string" ? normKey(v) === normKey(x) : v === x)));
    case "gt": return typeof v === "number" && v > (value as number);
    case "gte": return typeof v === "number" && v >= (value as number);
    case "lt": return typeof v === "number" && v < (value as number);
    case "lte": return typeof v === "number" && v <= (value as number);
    case "between": {
      if (typeof v !== "number" || !Array.isArray(value)) return false;
      const [a, b] = value as [number | null, number | null];
      return (a === null || v >= a) && (b === null || v <= b);
    }
    case "contains": return v !== null && normKey(v).includes(normKey(value));
    default: return false;
  }
}

export function rowMatches(columns: Columns, i: number, expr: FilterExpr): boolean {
  if ("and" in expr) return expr.and.every((e) => rowMatches(columns, i, e));
  if ("or" in expr) return expr.or.some((e) => rowMatches(columns, i, e));
  if ("not" in expr) return !rowMatches(columns, i, expr.not);
  const col = columns[expr.field];
  const v = col ? col[i] ?? null : null;
  return leaf(v, expr.op, expr.value);
}

export function buildMask(columns: Columns, n: number, filters: FilterExpr[]): Uint8Array {
  const mask = new Uint8Array(n).fill(1);
  if (filters.length === 0) return mask;
  for (let i = 0; i < n; i++) {
    for (const f of filters) if (!rowMatches(columns, i, f)) { mask[i] = 0; break; }
  }
  return mask;
}

export function countMask(mask: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < mask.length; i++) c += mask[i];
  return c;
}

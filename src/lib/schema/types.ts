// Core schema types. Visuals bind to Field.id, never to sheet headers.

export type FieldType = "string" | "number" | "date" | "boolean";
export type FieldRole = "id" | "dimension" | "measure" | "date" | "text" | "ignore";

export type Semantic =
  | "status" | "outcome" | "reason" | "origin" | "destination" | "lane"
  | "received_date" | "quoted_date" | "closed_date" | "remarks" | "mode"
  | "amount" | "cost" | "margin" | "quantity" | "owner" | "customer"
  | "business_unit" | "description" | "turnaround" | "age" | "period";

export type FilterOp =
  | "eq" | "neq" | "in" | "nin" | "isNull" | "notNull"
  | "gt" | "gte" | "lt" | "lte" | "between" | "contains";

export type FilterExpr =
  | { field: string; op: FilterOp; value?: unknown }
  | { and: FilterExpr[] }
  | { or: FilterExpr[] }
  | { not: FilterExpr };

export type DerivedSpec =
  | { kind: "diffDays"; from: string; to: string }
  | { kind: "ageDays"; from: string; when?: FilterExpr }
  | { kind: "keyword"; from: string[]; rules: { value: string; match: string[] }[]; fallback: string | null }
  | { kind: "laneType"; origin: string; destination: string; home: string[] }
  | { kind: "coalesce"; fields: string[] }
  | { kind: "bucket"; from: string; edges: number[]; labels: string[] }
  | { kind: "period"; from: string; unit: "week" | "month" };

export type FieldFormat = "integer" | "decimal" | "currency" | "percent" | "days" | "date" | "text";

export interface Field {
  id: string;
  label: string;
  /** Exact header text in the sheet. null for derived fields. */
  source: string | null;
  /** Older header names accepted on re-upload. */
  aliases?: string[];
  type: FieldType;
  role: FieldRole;
  semantic?: Semantic;
  format?: FieldFormat;
  currency?: string;
  /** Canonical category list (from the sheet's dropdown validation or configured). */
  allowedValues?: string[];
  /** normalised key -> canonical value. */
  valueMap?: Record<string, string>;
  /** Explicit display order for ordinal dimensions. */
  order?: string[];
  derived?: DerivedSpec;
  hidden?: boolean;
  description?: string;
}

export interface SchemaMap {
  version: number;
  sheet: string | null;
  fields: Field[];
  idField?: string;
  primaryDate?: string;
  /** Home-country tokens used by lane derivation, editable per project. */
  home?: string[];
}

/** Column-level statistics captured from a parsed sheet. */
export interface ColumnStats {
  header: string;
  index: number;
  nonEmpty: number;
  numbers: number;
  dates: number;
  booleans: number;
  strings: number;
  distinct: number;
  avgLength: number;
  samples: string[];
  allowedValues?: string[];
}

export type RawCell = string | number | boolean | null;
export type RawRow = { row: number; cells: Record<string, RawCell> };

export interface ParsedSheet {
  name: string;
  headerRow: number;
  headers: string[];
  rows: RawRow[];
  stats: ColumnStats[];
  validations: Record<string, string[]>;
  totalRowsInSheet: number;
}

export interface ParsedWorkbook {
  fileName: string;
  sheets: ParsedSheet[];
  /** Index of the sheet chosen as the data sheet. */
  primary: number;
}

export type ColumnValue = number | string | null;

export interface Exclusion { row: number; reason: string; id?: string | null }
export interface Fix { row: number; field: string; from: string; to: string; reason: string }

export interface Snapshot {
  uploadId: string;
  version: number;
  builtAt: string;
  fields: Field[];
  n: number;
  columns: Record<string, ColumnValue[]>;
  rowRefs: number[];
  excluded: Exclusion[];
  fixes: Fix[];
  /** Raw spellings folded into each canonical value, per dimension field. */
  variants: Record<string, Record<string, string[]>>;
}

export const normKey = (v: unknown): string =>
  String(v ?? "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const cleanText = (v: unknown): string =>
  String(v ?? "")
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

export const slugify = (s: string): string =>
  cleanText(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_") || "field";

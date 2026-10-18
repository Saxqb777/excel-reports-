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
  | { kind: "daysUntil"; from: string }
  | { kind: "keyword"; from: string[]; rules: { value: string; match: string[] }[]; fallback: string | null }
  | { kind: "laneType"; origin: string; destination: string; home: string[] }
  | { kind: "coalesce"; fields: string[] }
  | { kind: "bucket"; from: string; edges: number[]; labels: string[] }
  | { kind: "period"; from: string; unit: "week" | "month" }
  /** How many of `fields` are not marked done (empty counts as not done). */
  | { kind: "pendingCount"; fields: string[]; done: string[] }
  /** Labels of the `fields` not marked done, comma-separated; null when all are done. */
  | { kind: "pendingList"; fields: string[]; done: string[] }
  /** The reference without a trailing split suffix ("VSBU9012540-2" → "VSBU9012540"); rows without one get "Row n" so each still counts once. */
  | { kind: "baseRef"; from: string }
  /** "Jan 2026" from a date, for month bars that stack by another dimension (sorted with `sort: "date"`). */
  | { kind: "monthLabel"; from: string }
  /** The first case whose filter the row matches gives the value: a constant, or another field's value (`from`). */
  | { kind: "case"; cases: { when: FilterExpr; value?: string | number; from?: string }[]; fallback?: string | number | null }
  /**
   * A row identifier that survives rows being inserted or re-sorted: the first candidate field with a value (matching
   * `pattern` when given, spaces ignored), with its prefix. A key already used by an earlier row gets " (2)", " (3)";
   * rows with no candidate get "Row n".
   */
  | { kind: "rowKey"; candidates: { field: string; pattern?: string; prefix?: string }[] }
  /** `from` times the rate for the row's currency (the value of `currency`, e.g. "EUR"); null when the amount or the rate is missing. */
  | { kind: "convert"; from: string; currency: string; rates: Record<string, number> };

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
  /** How rows are combined when a table rolls several up into one (default: measures sum, dates take the earliest). */
  aggregate?: "sum" | "avg" | "min" | "max";
  hidden?: boolean;
  description?: string;
  /** The user confirmed this column may be absent from uploads; its absence no longer asks for confirmation. */
  optional?: boolean;
}

export interface SchemaMap {
  version: number;
  sheet: string | null;
  fields: Field[];
  idField?: string;
  primaryDate?: string;
  /** Home-country tokens used by lane derivation, editable per project. */
  home?: string[];
  /** Date fields in the order they happen in a row (loading before sailing before arrival); used to spot day/month swaps. */
  dateChain?: string[];
  /** A text field whose value, when set, excludes the row with that value as the reason (set by a template). */
  excludeField?: string;
  /** Rows where this field is empty are left out and listed with the reason (a container tracker: a planned booking or an air shipment has no container number). */
  requireField?: string;
  /** A text field holding a JSON list of corrections a template made to the row ({ field, from, to, reason }). */
  noteField?: string;
  /** Spellings of a dimension value that differ only in case or spacing ("india", "India ") count as one, shown in the spelling with most capitalised words (then the most used). */
  foldCase?: boolean;
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
  /** Small sheets as plain value grids (row by row, from the top-left cell), for templates that read a summary layout. */
  grids?: Record<string, RawCell[][]>;
}

export type ColumnValue = number | string | null;

export interface Exclusion { row: number; reason: string; id?: string | null }
export interface Fix { row: number; field: string; from: string; to: string; reason: string; id?: string | null }

/** A column of a secondary sheet kept alongside the main table (a vessel timetable, a price list). */
export interface AuxColumn { id: string; label: string; type: FieldType; format?: FieldFormat; hidden?: boolean; /** Long text that wraps instead of widening the table (a note). */ wrap?: boolean }
/** A small secondary sheet, normalised by a template at ingest time and stored with the upload. */
export interface AuxSheet { id: string; label: string; columns: AuxColumn[]; rows: Record<string, ColumnValue>[] }

export interface Snapshot {
  /** Secondary sheets of the same workbook, attached when the snapshot is read. */
  aux?: Record<string, AuxSheet>;
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

/** Key for matching the same thing written two ways ("AN YANG /V.2626" and "AN YANG" + "2626"): letters and digits only, voyage markers dropped. */
export const joinKey = (v: unknown): string => normKey(v).replace(/\bv\.?\s*(?=\d)/g, "").replace(/[^a-z0-9]/g, "");

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

import type { ColumnValue, DerivedSpec, Exclusion, Field, FilterExpr, Fix, ParsedSheet, RawCell, SchemaMap, Snapshot } from "./types";
import { cleanText, normKey } from "./types";
import { parseLooseDate } from "@/lib/excel/parse";
import { rowMatches } from "@/lib/engine/filters";

const DAY = 86_400_000;

export function toNumber(v: RawCell): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = String(v).replace(/[,\s]/g, "").replace(/^(AED|USD|EUR|GBP|SAR|\$|£|€)/i, "").replace(/(AED|USD|EUR|GBP|SAR)$/i, "");
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()]/g, "").replace(/%$/, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

export function toDate(v: RawCell): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    // Excel serial date (days since 1899-12-30) when in a plausible range.
    if (v > 20000 && v < 80000) return Math.round((v - 25569) * DAY);
    if (v > 1e11) return v; // epoch ms
    // ERP exports write dates as yyyymmdd integers (20260131).
    if (Number.isInteger(v) && v >= 19000101 && v <= 21001231) {
      const y = Math.floor(v / 10000), m = Math.floor(v / 100) % 100, d = v % 100;
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return Date.UTC(y, m - 1, d);
    }
    return null;
  }
  if (typeof v === "boolean") return null;
  const s = String(v).trim();
  const iso = /^\d{4}-\d{2}-\d{2}T/.test(s) ? Date.parse(s) : NaN;
  if (Number.isFinite(iso)) return Math.floor(iso / DAY) * DAY;
  return parseLooseDate(s);
}

function toText(v: RawCell): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  const s = cleanText(v);
  return s ? s : null;
}

export function canonicalise(field: Field, raw: string): string {
  const key = normKey(raw);
  if (field.valueMap && field.valueMap[key]) return field.valueMap[key];
  if (field.allowedValues) {
    const hit = field.allowedValues.find((a) => normKey(a) === key);
    if (hit) return hit;
  }
  return raw;
}

/** Resolve which sheet header feeds each sourced field (source, alias, or normalised match). */
export function resolveSources(schema: SchemaMap, sheet: ParsedSheet): Map<string, string> {
  const map = new Map<string, string>();
  const headers = sheet.headers;
  for (const f of schema.fields) {
    if (!f.source) continue;
    const h = headers.find((x) => x === f.source)
      ?? headers.find((x) => (f.aliases ?? []).some((a) => normKey(a) === normKey(x)))
      ?? headers.find((x) => normKey(x) === normKey(f.source!));
    if (h) map.set(f.id, h);
  }
  return map;
}

function laneType(origin: string | null, destination: string | null, home: string[]): string | null {
  if (!origin || !destination) return null;
  const isHome = (s: string | null) => !!s && home.some((h) => normKey(s).includes(normKey(h)));
  const o = isHome(origin), d = isHome(destination);
  if (o && d) return "Domestic";
  if (!o && d) return "Import";
  if (o && !d) return "Export";
  return "Cross-trade";
}

function keyword(texts: (string | null)[], rules: { value: string; match: string[] }[], fallback: string | null): string | null {
  const hay = texts.filter(Boolean).map((t) => normKey(t)).join(" | ");
  if (!hay) return fallback;
  for (const r of rules) if (r.match.some((m) => hay.includes(normKey(m)))) return r.value;
  return fallback;
}

export interface BuildOptions {
  uploadId: string;
  version: number;
  now?: number;
}

export function buildSnapshot(schema: SchemaMap, sheet: ParsedSheet, opts: BuildOptions): Snapshot {
  const now = opts.now ?? Date.now();
  const sources = resolveSources(schema, sheet);
  const fields = schema.fields.filter((f) => f.role !== "ignore");
  const base = fields.filter((f) => !f.derived);
  const derived = fields.filter((f) => f.derived);
  const idField = schema.idField ? fields.find((f) => f.id === schema.idField) : undefined;
  const columns: Record<string, ColumnValue[]> = {};
  for (const f of fields) columns[f.id] = [];
  const rowRefs: number[] = [];
  const excluded: Exclusion[] = [];
  const fixes: Fix[] = [];
  const variants: Record<string, Record<string, Set<string>>> = {};
  const noteVariant = (fieldId: string, raw: string, canonical: string) => {
    if (raw === canonical) return;
    const byField = (variants[fieldId] ??= {});
    (byField[canonical] ??= new Set()).add(raw);
  };

  const received = fields.find((f) => f.semantic === "received_date");
  const quoted = fields.find((f) => f.semantic === "quoted_date");

  for (const raw of sheet.rows) {
    const rec: Record<string, ColumnValue> = {};
    let nonIdValues = 0;
    let firstText: string | null = null;
    for (const f of base) {
      const h = sources.get(f.id);
      const v: RawCell = h ? raw.cells[h] ?? null : null;
      let out: ColumnValue = null;
      if (f.type === "number") out = toNumber(v);
      else if (f.type === "date") out = toDate(v);
      else if (f.type === "boolean") out = v === null ? null : (typeof v === "boolean" ? v : /^(true|yes|y|1)$/i.test(String(v))) ? 1 : 0;
      else {
        const t = toText(v);
        if (t !== null && f.role === "dimension") { const c = canonicalise(f, t); noteVariant(f.id, t, c); out = c; }
        else out = t;
      }
      rec[f.id] = out;
      if (out !== null && f.role !== "id") nonIdValues++;
      if (firstText === null && typeof out === "string") firstText = out;
    }
    const idValue = idField ? (rec[idField.id] as string | null) : null;
    // Template hooks, both reproducible from the stored rows: a reason column excludes the row (a duplicate of a record
    // counted on another sheet), and a note column carries the corrections a template made while merging sheets.
    if (schema.excludeField && typeof rec[schema.excludeField] === "string") { excluded.push({ row: raw.row, reason: rec[schema.excludeField] as string, id: idValue }); continue; }
    if (schema.noteField && typeof rec[schema.noteField] === "string") {
      try { for (const fx of JSON.parse(rec[schema.noteField] as string) as Omit<Fix, "row">[]) fixes.push({ ...fx, row: raw.row, id: idValue }); } catch { /* not a note list */ }
    }
    // Exclusions
    if (nonIdValues === 0) { excluded.push({ row: raw.row, reason: idValue ? "Only the identifier is filled in" : "Empty row", id: idValue }); continue; }
    // A row with no identifier and only a couple of cells (a totals line under the table, a stray number) is not a record.
    if (!idValue && nonIdValues <= Math.max(2, Math.floor(base.length * 0.1))) { excluded.push({ row: raw.row, reason: "Almost empty row (looks like a total or a note)", id: idValue }); continue; }
    if (firstText && /^(grand\s+)?(sub)?total\b/i.test(firstText)) { excluded.push({ row: raw.row, reason: "Totals row", id: idValue }); continue; }
    const headerRepeat = base.filter((f) => f.source).every((f) => { const h = sources.get(f.id); return !h || normKey(raw.cells[h]) === normKey(h) || raw.cells[h] === null; });
    if (headerRepeat && base.some((f) => { const h = sources.get(f.id); return h && normKey(raw.cells[h]) === normKey(h); })) { excluded.push({ row: raw.row, reason: "Repeated header row", id: idValue }); continue; }
    // Year-typo fix: a quote date more than a year after receipt, where pulling the year back makes it plausible.
    if (received && quoted) {
      const r = rec[received.id], q = rec[quoted.id];
      if (typeof r === "number" && typeof q === "number" && q - r > 365 * DAY) {
        const qd = new Date(q), rd = new Date(r);
        const candidate = Date.UTC(rd.getUTCFullYear(), qd.getUTCMonth(), qd.getUTCDate());
        if (candidate >= r && candidate - r <= 120 * DAY) {
          fixes.push({ row: raw.row, field: quoted.id, from: qd.toISOString().slice(0, 10), to: new Date(candidate).toISOString().slice(0, 10), reason: "Quote date year looked like a typo (more than a year after receipt); year aligned to the receipt date" });
          rec[quoted.id] = candidate;
        }
      }
    }
    for (const f of base) columns[f.id].push(rec[f.id]);
    rowRefs.push(raw.row);
  }

  const n = rowRefs.length;
  const getCol = (id: string) => columns[id] ?? new Array<ColumnValue>(n).fill(null);
  fixSwappedDates(base, sources, sheet, columns, rowRefs, fixes);
  fixDateOrder(base, schema.dateChain ?? [], sources, sheet, columns, rowRefs, fixes);
  const home = schema.home ?? ["UAE", "United Arab Emirates", "Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Al Ain", "Jebel Ali", "JAFZA", "Kizad", "Mussafah", "Fujairah", "RAK", "Ras Al Khaimah", "Umm Al Quwain"];
  const order = topoOrder(derived);
  for (const f of order) {
    const spec = f.derived as DerivedSpec;
    const out: ColumnValue[] = new Array(n).fill(null);
    if (spec.kind === "diffDays") {
      const a = getCol(spec.from), b = getCol(spec.to);
      for (let i = 0; i < n; i++) if (typeof a[i] === "number" && typeof b[i] === "number") out[i] = Math.round(((b[i] as number) - (a[i] as number)) / DAY);
    } else if (spec.kind === "ageDays") {
      const a = getCol(spec.from);
      for (let i = 0; i < n; i++) {
        if (typeof a[i] !== "number") continue;
        if (spec.when && !rowMatches(columns, i, spec.when)) continue;
        out[i] = Math.max(0, Math.floor((now - (a[i] as number)) / DAY));
      }
    } else if (spec.kind === "daysUntil") {
      const a = getCol(spec.from);
      for (let i = 0; i < n; i++) if (typeof a[i] === "number") out[i] = Math.trunc(((a[i] as number) - now) / DAY);
    } else if (spec.kind === "keyword") {
      const cols = spec.from.map(getCol);
      for (let i = 0; i < n; i++) out[i] = keyword(cols.map((c) => (typeof c[i] === "string" ? (c[i] as string) : null)), spec.rules, spec.fallback);
    } else if (spec.kind === "laneType") {
      const o = getCol(spec.origin), d = getCol(spec.destination);
      const h = spec.home?.length ? spec.home : home;
      for (let i = 0; i < n; i++) out[i] = laneType(o[i] as string | null, d[i] as string | null, h);
    } else if (spec.kind === "coalesce") {
      const cols = spec.fields.map(getCol);
      for (let i = 0; i < n; i++) out[i] = cols.map((c) => c[i]).find((v) => v !== null) ?? null;
    } else if (spec.kind === "bucket") {
      const a = getCol(spec.from);
      for (let i = 0; i < n; i++) {
        const v = a[i];
        if (typeof v !== "number") continue;
        let k = 0;
        while (k < spec.edges.length && v >= spec.edges[k]) k++;
        out[i] = spec.labels[k] ?? null;
      }
    } else if (spec.kind === "period") {
      const a = getCol(spec.from);
      for (let i = 0; i < n; i++) if (typeof a[i] === "number") out[i] = periodStart(a[i] as number, spec.unit);
    } else if (spec.kind === "monthLabel") {
      const a = getCol(spec.from);
      for (let i = 0; i < n; i++) if (typeof a[i] === "number") out[i] = monthLabel(a[i] as number);
    } else if (spec.kind === "case") {
      const froms = spec.cases.map((c) => (c.from ? getCol(c.from) : null));
      for (let i = 0; i < n; i++) {
        const k = spec.cases.findIndex((c) => rowMatches(columns, i, c.when));
        out[i] = k === -1 ? spec.fallback ?? null : froms[k] ? froms[k]![i] ?? null : spec.cases[k].value ?? null;
      }
    } else if (spec.kind === "baseRef") {
      const a = getCol(spec.from);
      for (let i = 0; i < n; i++) {
        const v = a[i];
        out[i] = typeof v === "string" && v.trim() ? v.trim().replace(/[\s_-]+\d{1,2}$/, "") : `Row ${rowRefs[i]}`;
      }
    } else if (spec.kind === "pendingCount" || spec.kind === "pendingList") {
      const cols = spec.fields.map(getCol);
      const labels = spec.fields.map((id) => fields.find((x) => x.id === id)?.label ?? id);
      const done = new Set(spec.done.map(normKey));
      for (let i = 0; i < n; i++) {
        const pending: string[] = [];
        cols.forEach((c, k) => { const v = c[i]; if (v === null || !done.has(normKey(v))) pending.push(labels[k]); });
        out[i] = spec.kind === "pendingCount" ? pending.length : pending.length ? pending.join(", ") : null;
      }
    }
    columns[f.id] = out;
  }

  const variantsOut: Record<string, Record<string, string[]>> = {};
  for (const [fid, m] of Object.entries(variants)) variantsOut[fid] = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort()]));
  return { uploadId: opts.uploadId, version: opts.version, builtAt: new Date(now).toISOString(), fields, n, columns, rowRefs, excluded, fixes, variants: variantsOut };
}

/**
 * A date typed day-first ("4/10") on a machine whose Excel reads month-first lands as 10 April while the rest of the
 * column was entered as text and read day-first. When a typed date sits far outside the window of the text dates and
 * swapping day and month brings it inside, it is swapped and flagged.
 */
function fixSwappedDates(base: Field[], sources: Map<string, string>, sheet: ParsedSheet, columns: Record<string, ColumnValue[]>, rowRefs: number[], fixes: Fix[]) {
  const rawByRow = new Map(sheet.rows.map((r) => [r.row, r.cells]));
  const n = rowRefs.length;
  for (const f of base) {
    if (f.type !== "date") continue;
    const h = sources.get(f.id);
    if (!h) continue;
    const col = columns[f.id];
    const typed: number[] = [], text: number[] = [];
    for (let i = 0; i < n; i++) {
      if (typeof col[i] !== "number") continue;
      const v = rawByRow.get(rowRefs[i])?.[h];
      if (typeof v === "number" || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v))) typed.push(i); else text.push(i);
    }
    if (text.length < 3 || typed.length === 0) continue;
    const ts = text.map((i) => col[i] as number);
    const lo = Math.min(...ts) - 45 * DAY, hi = Math.max(...ts) + 45 * DAY;
    for (const i of typed) {
      const v = col[i] as number;
      if (v >= lo && v <= hi) continue;
      const d = new Date(v);
      if (d.getUTCDate() > 12) continue;
      const swapped = Date.UTC(d.getUTCFullYear(), d.getUTCDate() - 1, d.getUTCMonth() + 1);
      if (swapped < lo || swapped > hi) continue;
      fixes.push({ row: rowRefs[i], field: f.id, from: d.toISOString().slice(0, 10), to: new Date(swapped).toISOString().slice(0, 10), reason: "Day and month looked swapped (typed day-first, read month-first by Excel); aligned with the rest of the column" });
      col[i] = swapped;
    }
  }
}

const isTypedDate = (v: RawCell) => typeof v === "number" || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v));
const swapDayMonth = (t: number) => { const d = new Date(t); return d.getUTCDate() > 12 ? null : Date.UTC(d.getUTCFullYear(), d.getUTCDate() - 1, d.getUTCMonth() + 1); };

/**
 * Second net for swapped day/month: dates in a row happen in a known order (loading before sailing before arrival).
 * A typed, ambiguous date that breaks that order with its neighbours, and fits once day and month are swapped, is swapped.
 */
function fixDateOrder(base: Field[], chain: string[], sources: Map<string, string>, sheet: ParsedSheet, columns: Record<string, ColumnValue[]>, rowRefs: number[], fixes: Fix[]) {
  const ids = chain.filter((id) => columns[id] && base.some((f) => f.id === id && f.type === "date" && sources.has(f.id)));
  if (ids.length < 2) return;
  const rawByRow = new Map(sheet.rows.map((r) => [r.row, r.cells]));
  const n = rowRefs.length;
  for (let i = 0; i < n; i++) {
    const raw = rawByRow.get(rowRefs[i]);
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (let k = 0; k < ids.length; k++) {
        const v = columns[ids[k]][i];
        if (typeof v !== "number" || !isTypedDate(raw?.[sources.get(ids[k])!] ?? null)) continue;
        let prev: number | null = null, next: number | null = null;
        for (let j = k - 1; j >= 0 && prev === null; j--) { const p = columns[ids[j]][i]; if (typeof p === "number") prev = p; }
        for (let j = k + 1; j < ids.length && next === null; j++) { const q = columns[ids[j]][i]; if (typeof q === "number") next = q; }
        const broken = (prev !== null && v < prev) || (next !== null && v > next);
        if (!broken) continue;
        const swapped = swapDayMonth(v);
        if (swapped === null || swapped === v) continue;
        if ((prev !== null && swapped < prev) || (next !== null && swapped > next)) continue;
        fixes.push({ row: rowRefs[i], field: ids[k], from: new Date(v).toISOString().slice(0, 10), to: new Date(swapped).toISOString().slice(0, 10), reason: "Day and month looked swapped: out of order with the row's other dates, in order once swapped" });
        columns[ids[k]][i] = swapped;
        changed = true;
      }
      if (!changed) break;
    }
  }
}

/** Every field a filter reads, so derived fields that filter on other derived fields are computed after them. */
function filterFields(e: FilterExpr): string[] {
  if ("and" in e) return e.and.flatMap(filterFields);
  if ("or" in e) return e.or.flatMap(filterFields);
  if ("not" in e) return filterFields(e.not);
  return [e.field];
}

function topoOrder(derived: Field[]): Field[] {
  const byId = new Map(derived.map((f) => [f.id, f]));
  const deps = (f: Field): string[] => {
    const s = f.derived!;
    switch (s.kind) {
      case "diffDays": return [s.from, s.to];
      case "ageDays": return [s.from, ...(s.when ? filterFields(s.when) : [])];
      case "daysUntil": return [s.from];
      case "keyword": return s.from;
      case "laneType": return [s.origin, s.destination];
      case "coalesce": return s.fields;
      case "bucket": return [s.from];
      case "period": return [s.from];
      case "pendingCount": return s.fields;
      case "pendingList": return s.fields;
      case "baseRef": return [s.from];
      case "monthLabel": return [s.from];
      case "case": return s.cases.flatMap((c) => [...filterFields(c.when), ...(c.from ? [c.from] : [])]);
    }
  };
  const out: Field[] = [];
  const seen = new Set<string>();
  const visit = (f: Field) => {
    if (seen.has(f.id)) return;
    seen.add(f.id);
    for (const d of deps(f)) { const g = byId.get(d); if (g) visit(g); }
    out.push(f);
  };
  derived.forEach(visit);
  return out;
}

export function periodStart(t: number, unit: "week" | "month" | "day"): number {
  const d = new Date(t);
  if (unit === "day") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (unit === "month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow);
}

export { rowMatches } from "@/lib/engine/filters";
export type { FilterExpr };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Jan 2026" for a timestamp (UTC). */
export function monthLabel(t: number): string {
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
/** Inverse of monthLabel, for sorting month categories; falls back to Date.parse, then null. */
export function parseMonthLabel(s: string): number | null {
  const m = /^([A-Za-z]{3})[a-z]*\.?\s+(\d{4})$/.exec(s.trim());
  if (m) { const i = MONTHS.findIndex((x) => x.toLowerCase() === m[1].toLowerCase()); if (i >= 0) return Date.UTC(+m[2], i, 1); }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

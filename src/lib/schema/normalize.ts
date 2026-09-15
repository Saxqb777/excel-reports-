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
    // Exclusions
    if (nonIdValues === 0) { excluded.push({ row: raw.row, reason: idValue ? "Only the identifier is filled in" : "Empty row", id: idValue }); continue; }
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
    }
    columns[f.id] = out;
  }

  const variantsOut: Record<string, Record<string, string[]>> = {};
  for (const [fid, m] of Object.entries(variants)) variantsOut[fid] = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort()]));
  return { uploadId: opts.uploadId, version: opts.version, builtAt: new Date(now).toISOString(), fields, n, columns, rowRefs, excluded, fixes, variants: variantsOut };
}

function topoOrder(derived: Field[]): Field[] {
  const byId = new Map(derived.map((f) => [f.id, f]));
  const deps = (f: Field): string[] => {
    const s = f.derived!;
    switch (s.kind) {
      case "diffDays": return [s.from, s.to];
      case "ageDays": return [s.from];
      case "keyword": return s.from;
      case "laneType": return [s.origin, s.destination];
      case "coalesce": return s.fields;
      case "bucket": return [s.from];
      case "period": return [s.from];
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

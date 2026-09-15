import type { ColumnStats, Field, FieldRole, FieldType, ParsedSheet, SchemaMap, Semantic } from "./types";
import { normKey, slugify } from "./types";

type Rule = { re: RegExp; semantic: Semantic };

// Header keyword rules, first match wins. Ordered from specific to general.
const RULES: Rule[] = [
  { re: /date.*(quot|sent|respon|reply)|quot.*date|quoted/i, semantic: "quoted_date" },
  { re: /date.*(clos|decid|award|complet)|clos.*date/i, semantic: "closed_date" },
  { re: /date.*(receiv|creat|request|open|enquir|inquir)|receiv.*date|created|received/i, semantic: "received_date" },
  { re: /won\s*\/?\s*lost|win\s*\/?\s*loss|outcome|result|decision/i, semantic: "outcome" },
  { re: /reason/i, semantic: "reason" },
  { re: /status|stage/i, semantic: "status" },
  { re: /\borigin\b|\bfrom\b|pickup|pick-up|\bpol\b|port of loading|departure/i, semantic: "origin" },
  { re: /destination|\bto\b|delivery|\bpod\b|port of discharge|arrival/i, semantic: "destination" },
  { re: /remark|comment|note|update|feedback/i, semantic: "remarks" },
  { re: /freight|mode|transport|shipment type|service type|incoterm/i, semantic: "mode" },
  { re: /margin|profit|gp\b/i, semantic: "margin" },
  { re: /\bcost\b|buy rate|purchase/i, semantic: "cost" },
  { re: /amount|value|revenue|price|rate|sell|total|quote (value|amount)|aed|usd|\$/i, semantic: "amount" },
  { re: /\bqty\b|quantity|volume|units|weight|\bkg\b|cbm|teu|containers?|trucks?|trailers?/i, semantic: "quantity" },
  { re: /owner|sales ?(person|rep)|account manager|assigned|handled by|agent/i, semantic: "owner" },
  { re: /client|customer|account|consignee|shipper|company/i, semantic: "customer" },
  { re: /business unit|\bbu\b|division|department|brand/i, semantic: "business_unit" },
  { re: /descri|subject|item|title|request|cargo|commodity|goods/i, semantic: "description" },
];

const ID_RE = /track|\bref\b|reference|^id$|\bid\b|\bno\.?$|number|code|ticket|rfq|serial/i;

function inferType(st: ColumnStats): FieldType {
  if (st.nonEmpty === 0) return "string";
  const share = (n: number) => n / st.nonEmpty;
  if (share(st.dates) >= 0.7) return "date";
  if (share(st.numbers) >= 0.8) return "number";
  if (share(st.booleans) >= 0.8) return "boolean";
  return "string";
}

function detectCurrency(header: string): string | undefined {
  const h = header.toUpperCase();
  for (const c of ["AED", "USD", "EUR", "GBP", "SAR", "INR", "QAR", "KWD"]) if (h.includes(c)) return c;
  if (/\$/.test(header)) return "USD";
  if (/£/.test(header)) return "GBP";
  if (/€/.test(header)) return "EUR";
  return undefined;
}

export function inferField(st: ColumnStats, rowCount: number, existingIds: Set<string>): Field {
  const header = st.header;
  const type = inferType(st);
  let semantic: Semantic | undefined;
  for (const r of RULES) if (r.re.test(header)) { semantic = r.semantic; break; }
  if (type === "date" && !semantic) semantic = undefined;
  if (type !== "date" && semantic && semantic.endsWith("_date")) semantic = undefined;
  if (type !== "number" && semantic && ["amount", "cost", "margin", "quantity"].includes(semantic)) semantic = undefined;

  const uniqueShare = st.nonEmpty ? st.distinct / st.nonEmpty : 0;
  const isId = type === "string" && ID_RE.test(header) && uniqueShare >= 0.95 && st.nonEmpty >= Math.min(rowCount, 3);

  let role: FieldRole;
  if (isId) role = "id";
  else if (type === "date") role = "date";
  else if (type === "number") role = ["amount", "cost", "margin", "quantity"].includes(semantic ?? "") || !semantic ? "measure" : "dimension";
  else if (type === "boolean") role = "dimension";
  else if (st.allowedValues) role = "dimension";
  else if (semantic === "remarks" || semantic === "description") role = "text";
  else if (st.avgLength > 40) role = "text";
  else if (st.distinct <= Math.max(25, rowCount * 0.2)) role = "dimension";
  else role = "text";

  if (role === "dimension" && !semantic && type === "number" && st.distinct > 30) role = "measure";

  let id = slugify(header);
  let n = 2;
  while (existingIds.has(id)) id = `${slugify(header)}_${n++}`;
  existingIds.add(id);

  const field: Field = { id, label: header, source: header, type, role };
  if (semantic) field.semantic = semantic;
  if (type === "date") field.format = "date";
  else if (type === "number") {
    const currency = detectCurrency(header);
    if (["amount", "cost", "margin"].includes(semantic ?? "") || currency) { field.format = "currency"; field.currency = currency ?? "AED"; }
    else field.format = Number.isInteger(Number(st.samples[0])) ? "integer" : "decimal";
  }
  if (st.allowedValues) field.allowedValues = st.allowedValues;
  return field;
}

/** Build value maps that fold casing / whitespace variants into one canonical value. */
export function buildValueMap(values: unknown[], allowed?: string[]): Record<string, string> | undefined {
  const groups = new Map<string, Map<string, number>>();
  for (const v of values) {
    if (v === null || v === undefined || v === "") continue;
    const raw = String(v);
    const key = normKey(raw);
    if (!groups.has(key)) groups.set(key, new Map());
    const g = groups.get(key)!;
    g.set(raw.trim(), (g.get(raw.trim()) ?? 0) + 1);
  }
  const map: Record<string, string> = {};
  const allowedByKey = new Map((allowed ?? []).map((a) => [normKey(a), a] as const));
  for (const [key, variants] of groups) {
    const canonical = allowedByKey.get(key) ?? [...variants.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    for (const variant of variants.keys()) if (variant !== canonical) map[normKey(variant)] = canonical;
    if (!allowedByKey.has(key) && allowed) {
      // Not in the allowed list: keep as-is (quality report flags it) unless it is a case variant of an allowed value.
    }
    map[key] = canonical;
  }
  // Remove identity entries where canonical equals the trimmed variant with same key and there is only one variant.
  for (const [k, v] of Object.entries(map)) if (normKey(v) === k && groups.get(k)?.size === 1 && !allowed) delete map[k];
  return Object.keys(map).length ? map : undefined;
}

export function inferSchema(sheet: ParsedSheet): SchemaMap {
  const ids = new Set<string>();
  const fields = sheet.stats.map((st) => inferField(st, sheet.rows.length, ids));
  for (const f of fields) {
    if (f.role === "dimension" && f.type === "string") {
      const vals = sheet.rows.map((r) => r.cells[f.source!]);
      f.valueMap = buildValueMap(vals, f.allowedValues);
    }
  }
  const idField = fields.find((f) => f.role === "id")?.id;
  const primaryDate = (fields.find((f) => f.semantic === "received_date") ?? fields.find((f) => f.role === "date"))?.id;
  return { version: 1, sheet: sheet.name, fields, idField, primaryDate };
}

export type SchemaDiff = {
  matched: { field: Field; header: string; how: "exact" | "alias" | "normalised" | "fuzzy" }[];
  missing: Field[];
  added: string[];
};

function similarity(a: string, b: string): number {
  const s = normKey(a), t = normKey(b);
  if (s === t) return 1;
  const la = s.length, lb = t.length;
  if (!la || !lb) return 0;
  const dp: number[] = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= lb; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (s[i - 1] === t[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return 1 - dp[lb] / Math.max(la, lb);
}

/** Compare a known schema against a freshly parsed sheet. */
export function diffSchema(schema: SchemaMap, sheet: ParsedSheet): SchemaDiff {
  const headers = [...sheet.headers];
  const taken = new Set<string>();
  const matched: SchemaDiff["matched"] = [];
  const missing: Field[] = [];
  const sourced = schema.fields.filter((f) => f.source);
  for (const f of sourced) {
    const exact = headers.find((h) => h === f.source && !taken.has(h));
    if (exact) { matched.push({ field: f, header: exact, how: "exact" }); taken.add(exact); continue; }
    const alias = headers.find((h) => !taken.has(h) && (f.aliases ?? []).some((a) => normKey(a) === normKey(h)));
    if (alias) { matched.push({ field: f, header: alias, how: "alias" }); taken.add(alias); continue; }
    const norm = headers.find((h) => !taken.has(h) && normKey(h) === normKey(f.source!));
    if (norm) { matched.push({ field: f, header: norm, how: "normalised" }); taken.add(norm); continue; }
    let best: { h: string; s: number } | null = null;
    for (const h of headers) {
      if (taken.has(h)) continue;
      const s = similarity(h, f.source!);
      if (s >= 0.8 && (!best || s > best.s)) best = { h, s };
    }
    if (best) { matched.push({ field: f, header: best.h, how: "fuzzy" }); taken.add(best.h); continue; }
    missing.push(f);
  }
  const added = headers.filter((h) => !taken.has(h));
  return { matched, missing, added };
}

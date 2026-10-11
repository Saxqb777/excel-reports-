import type { AuxSheet, ColumnValue, Field, FilterExpr, ParsedSheet, ParsedWorkbook, RawCell, SchemaMap } from "@/lib/schema/types";
import { cleanText, normKey } from "@/lib/schema/types";
import { toDate, toNumber } from "@/lib/schema/normalize";
import type { Layout, Page, Widget } from "@/lib/dashboard/types";
import type { MetricSpec } from "@/lib/engine/metrics";

/**
 * Exit certificate collection tracker: one row per export invoice from the ERP (customer, country, invoice number and
 * date, currency, amounts in AED) with an "Exit Certificate Status" typed by the team (Collected, Pending, Credit Note…).
 * Matched by headers. The workbook's SUMMARY sheet (a status × month pivot plus a typed totals block) is read only to
 * reconcile against: every number on the dashboard comes from the data sheet.
 */

const CURRENCY = "AED";

/** Status vocabulary, in reading order, with the spellings each one absorbs. The first rule that matches wins. */
export const STATUS_RULES: { value: string; match: string[] }[] = [
  { value: "Credit note", match: ["credit"] },
  { value: "Cross trade", match: ["cross trade", "cross-trade", "crosstrade"] },
  { value: "Certificate missing", match: ["missing", "lost"] },
  // The sheet says "Check with <person>"; the dashboard never shows the name.
  { value: "Under review", match: ["check", "review", "verify", "confirm"] },
  { value: "Pending", match: ["not collected", "not received", "pending", "awaiting", "waiting"] },
  { value: "Collected", match: ["collect", "received"] },
];
export const STATUSES = ["Collected", "Pending", "Certificate missing", "Under review", "Credit note", "Cross trade", "Not recorded", "Other"];
/** Display order; "Not recorded" and "Other" only appear when a row has them. */
const STATUS_ORDER = STATUSES.slice(0, 6);
/** Still owed a certificate. */
export const OPEN = ["Pending", "Certificate missing", "Under review"];
/** Never needs one: the invoice was cancelled, or the goods did not leave from the UAE. */
const NOT_NEEDED = ["Credit note", "Cross trade"];

export function classifyStatus(raw: unknown): string {
  const k = normKey(raw);
  if (!k) return "Not recorded";
  return STATUS_RULES.find((r) => r.match.some((m) => k.includes(m)))?.value ?? "Other";
}

const COUNTRIES: Record<string, string> = {
  are: "United Arab Emirates", uae: "United Arab Emirates", sau: "Saudi Arabia", ksa: "Saudi Arabia", omn: "Oman", qat: "Qatar", bhr: "Bahrain", kwt: "Kuwait",
  ind: "India", pak: "Pakistan", bgd: "Bangladesh", lka: "Sri Lanka", mdv: "Maldives", npl: "Nepal", chn: "China", hkg: "Hong Kong", jpn: "Japan", kor: "South Korea",
  idn: "Indonesia", mys: "Malaysia", sgp: "Singapore", tha: "Thailand", vnm: "Vietnam", phl: "Philippines", aus: "Australia", nzl: "New Zealand", fji: "Fiji",
  jor: "Jordan", lbn: "Lebanon", syr: "Syria", irq: "Iraq", irn: "Iran", isr: "Israel", pse: "Palestine", pas: "Palestine", yem: "Yemen", tur: "Turkey",
  egy: "Egypt", sdn: "Sudan", som: "Somalia", ken: "Kenya", tza: "Tanzania", uga: "Uganda", eth: "Ethiopia", gha: "Ghana", nga: "Nigeria", zaf: "South Africa",
  mar: "Morocco", dza: "Algeria", tun: "Tunisia", lby: "Libya", dji: "Djibouti", eri: "Eritrea",
  gbr: "United Kingdom", deu: "Germany", fra: "France", ita: "Italy", esp: "Spain", nld: "Netherlands", bel: "Belgium", che: "Switzerland", aut: "Austria",
  swe: "Sweden", nor: "Norway", dnk: "Denmark", fin: "Finland", pol: "Poland", grc: "Greece", prt: "Portugal", irl: "Ireland", rus: "Russia", ukr: "Ukraine",
  usa: "United States", can: "Canada", mex: "Mexico", bra: "Brazil", arg: "Argentina", chl: "Chile", col: "Colombia", per: "Peru", bol: "Bolivia",
};
const TERMS: Record<string, string> = { exw: "Ex Works", "ex works": "Ex Works", "ex-works": "Ex Works", cif: "CIF", "cost insurance and freight": "CIF", "cost, insurance and freight": "CIF", fob: "FOB", "free on board": "FOB", cfr: "CFR", cnf: "CFR", "cost and freight": "CFR", dap: "DAP", ddp: "DDP" };
const TRANSPORT: Record<string, string> = { "sea transport": "Sea", sea: "Sea", "land transport": "Road", "road transport": "Road", land: "Road", road: "Road", "air transport": "Air", air: "Air" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Patch = Partial<Field> & { id: string };
type Spec = { match: (k: string) => boolean; patch: Patch };
const is = (...names: string[]) => (k: string) => names.includes(k);
const money = (id: string, label: string, hidden = true): Patch => ({ id, label, type: "number", role: "measure", semantic: "amount", format: "currency", currency: CURRENCY, hidden });
const SPECS: Spec[] = [
  { match: is("transaction_type", "transaction type"), patch: { id: "transaction_type", label: "Transaction type", type: "string", role: "dimension", hidden: true } },
  // Who follows each case up: staff names, never shown.
  { match: (k) => /^follow ?up/.test(k), patch: { id: "followup", role: "ignore" } },
  { match: is("paye_code", "customer code", "customer_code"), patch: { id: "customer_code", label: "Customer code", type: "string", role: "text", hidden: true } },
  { match: is("paye_name", "customer name", "customer_name", "customer"), patch: { id: "customer", label: "Customer", type: "string", role: "dimension", semantic: "customer" } },
  { match: is("customer_trn", "customer trn", "trn"), patch: { id: "customer_trn", role: "ignore" } },
  { match: is("customer_country", "customer country", "country"), patch: { id: "country", label: "Country", type: "string", role: "dimension", semantic: "destination", valueMap: COUNTRIES } },
  { match: is("voucher_no", "voucher no"), patch: { id: "voucher_no", label: "Voucher", type: "string", role: "text", hidden: true } },
  { match: is("order_number", "order number", "order no"), patch: { id: "order_number", label: "Sales order", type: "string", role: "text", hidden: true } },
  { match: is("delivery_term", "delivery term", "incoterm"), patch: { id: "delivery_terms", label: "Delivery terms", type: "string", role: "dimension", valueMap: TERMS } },
  { match: is("delivery_term_description"), patch: { id: "delivery_term_description", label: "Sale type", type: "string", role: "dimension", hidden: true } },
  { match: is("delivery_method"), patch: { id: "delivery_method_code", role: "ignore" } },
  { match: is("delivery_method_description", "delivery method", "transport"), patch: { id: "transport", label: "Shipped by", type: "string", role: "dimension", semantic: "mode", valueMap: TRANSPORT } },
  { match: is("invoice_no", "invoice no", "invoice number"), patch: { id: "invoice_no", label: "Invoice no.", type: "string", role: "id" } },
  { match: (k) => /^man(s)?ual inv/.test(k), patch: { id: "manual_invoice", label: "Manual invoice no.", type: "string", role: "text", hidden: true } },
  { match: is("invoice_currency", "currency"), patch: { id: "currency", label: "Currency", type: "string", role: "dimension" } },
  { match: is("exchange_rate", "exchange rate"), patch: { id: "exchange_rate", label: "Exchange rate", type: "number", role: "measure", format: "decimal", aggregate: "avg", hidden: true } },
  { match: is("invoice_date", "invoice date"), patch: { id: "invoice_date", label: "Invoice date", type: "date", role: "date", format: "date" } },
  { match: is("accounting_date", "accounting month"), patch: { id: "accounting_month", label: "Accounting month", type: "string", role: "dimension", order: MONTHS, hidden: true } },
  { match: is("status"), patch: { id: "erp_status", label: "ERP status", type: "string", role: "dimension", hidden: true } },
  { match: is("vat_rate", "vat rate"), patch: { id: "vat_rate", label: "VAT rate", type: "number", role: "measure", format: "decimal", aggregate: "max", hidden: true } },
  // In the invoice currency; from July some rows carry AED here instead (see the reconciliation).
  { match: is("gross_amount"), patch: { id: "gross_amount", label: "Gross amount (invoice currency)", type: "number", role: "measure", format: "decimal", hidden: true } },
  { match: is("gross_amount_aed"), patch: money("gross_amount_aed", "Gross amount (AED, as on the sheet)") },
  { match: is("discount_amount"), patch: { id: "discount_amount", label: "Discount (invoice currency)", type: "number", role: "measure", format: "decimal", hidden: true } },
  { match: is("discount_amount_aed"), patch: money("discount_aed", "Discount (AED)") },
  { match: is("after_discount_aed"), patch: money("after_discount_aed", "After discount (AED)") },
  { match: is("order_chgs_aed", "order charges aed"), patch: money("order_charges_aed", "Order charges (AED)") },
  { match: is("vat_amount_aed"), patch: money("vat_aed", "VAT (AED)") },
  { match: is("invoice_amount_aed", "invoice amount aed", "invoice value"), patch: money("invoice_value", "Invoice value (AED)", false) },
  { match: is("exit certificate status", "certificate status", "ec status"), patch: { id: "status_raw", label: "Status as typed", type: "string", role: "text", hidden: true } },
  { match: (k) => /^declaration/.test(k), patch: { id: "declaration", label: "Declaration", type: "string", role: "text", hidden: true } },
  { match: is("qty invoice"), patch: { id: "qty_invoice", label: "Quantity invoiced", type: "number", role: "measure", format: "integer", hidden: true } },
  { match: is("exit certificate"), patch: { id: "certificate_checked", label: "Certificate checked", type: "string", role: "text", hidden: true } },
  { match: is("qty e/c", "qty ec"), patch: { id: "qty_certificate", label: "Quantity on certificate", type: "number", role: "measure", format: "integer", hidden: true } },
  // "Remarks-<name>": a reviewer's notes. The label never carries the name.
  { match: (k) => /^remarks?\b/.test(k), patch: { id: "review_note", label: "Review note", type: "string", role: "text" } },
];
const specFor = (header: string): Spec | undefined => { const k = normKey(header); return SPECS.find((s) => s.match(k)); };

export function matchesExitCert(headers: string[]): boolean {
  const ids = new Set(headers.map((h) => specFor(h)?.patch.id));
  return ["status_raw", "invoice_no", "customer"].every((id) => ids.has(id));
}

const status = (...values: string[]): FilterExpr => (values.length === 1 ? { field: "status", op: "eq", value: values[0] } : { field: "status", op: "in", value: values });
const group = (value: string): FilterExpr => ({ field: "status_group", op: "eq", value });
const IS_OPEN = status(...OPEN);
const flag = (when: FilterExpr) => ({ kind: "case" as const, cases: [{ when, value: 1 }], fallback: 0 });
const count = (id: string, label: string, when: FilterExpr): Field => ({ id, label, source: null, type: "number", role: "measure", format: "integer", aggregate: "sum", hidden: true, derived: flag(when) });

export function exitCertSchema(inferred: SchemaMap): SchemaMap {
  const fields: Field[] = [];
  const taken = new Set<string>();
  for (const f of inferred.fields) {
    if (f.derived) continue;
    const spec = f.source ? specFor(f.source) : undefined;
    if (!spec || taken.has(spec.patch.id)) { fields.push({ ...f, role: f.role === "id" ? "text" : f.role, hidden: true }); continue; }
    taken.add(spec.patch.id);
    const { id, ...patch } = spec.patch;
    fields.push({ id, label: f.label, source: f.source, type: f.type, role: f.role, ...patch, ...(f.aliases ? { aliases: f.aliases } : {}) });
  }
  const has = (id: string) => fields.some((f) => f.id === id);
  fields.push(
    { id: "status", label: "Certificate status", source: null, type: "string", role: "dimension", semantic: "status", order: STATUS_ORDER,
      derived: { kind: "case", cases: [
        { when: { field: "status_raw", op: "isNull" }, value: "Not recorded" },
        ...STATUS_RULES.map((r) => ({ when: { or: r.match.map((m): FilterExpr => ({ field: "status_raw", op: "contains", value: m })) }, value: r.value })),
      ], fallback: "Other" } },
    { id: "status_group", label: "Collected or not", source: null, type: "string", role: "dimension", order: ["Collected", "Pending", "Other"],
      derived: { kind: "case", cases: [{ when: status("Collected"), value: "Collected" }, { when: status("Pending"), value: "Pending" }], fallback: "Other" } },
    { id: "records", label: "Records", source: null, type: "number", role: "measure", format: "integer", aggregate: "sum", hidden: true, derived: { kind: "case", cases: [], fallback: 1 } },
    count("n_collected", "Collected", group("Collected")),
    count("n_pending", "Pending", status("Pending")),
    count("n_other", "Other statuses", group("Other")),
    count("n_open", "Open", IS_OPEN),
    { id: "collection_rate", label: "Collection rate", source: null, type: "number", role: "measure", format: "percent", aggregate: "avg", hidden: true, derived: flag(group("Collected")) },
  );
  if (has("invoice_value")) fields.push(
    { ...money("pending_value", "Pending value (AED)"), source: null, aggregate: "sum", derived: { kind: "case", cases: [{ when: status("Pending"), from: "invoice_value" }], fallback: null } } as Field,
    { ...money("open_value", "Open value (AED)"), source: null, aggregate: "sum", derived: { kind: "case", cases: [{ when: IS_OPEN, from: "invoice_value" }], fallback: null } } as Field,
  );
  if (has("invoice_date")) fields.push(
    { id: "month", label: "Month", source: null, type: "string", role: "dimension", semantic: "period", derived: { kind: "monthLabel", from: "invoice_date" } },
    { id: "age_days", label: "Days open", source: null, type: "number", role: "measure", semantic: "age", format: "days", aggregate: "max", derived: { kind: "ageDays", from: "invoice_date", when: IS_OPEN } },
    { id: "age_band", label: "Open for", source: null, type: "string", role: "dimension", order: ["0–30 days", "31–60 days", "61–90 days", "Over 90 days"],
      derived: { kind: "bucket", from: "age_days", edges: [31, 61, 91], labels: ["0–30 days", "31–60 days", "61–90 days", "Over 90 days"] } },
  );
  fields.push({ id: "next_step", label: "Next step", source: null, type: "string", role: "text",
    derived: { kind: "case", cases: [
      { when: status("Certificate missing"), value: "Trace the missing certificate" },
      { when: status("Under review"), value: "Confirm the status internally" },
      { when: { and: [status("Pending"), { field: "age_days", op: "gt", value: 90 }] }, value: "Escalate: open more than 90 days" },
      { when: { and: [status("Pending"), { field: "age_days", op: "gt", value: 30 }] }, value: "Chase: open more than 30 days" },
      { when: status("Pending"), value: "Follow up" },
      { when: status("Not recorded"), value: "Record the status" },
    ], fallback: null } });
  return { ...inferred, fields, idField: has("invoice_no") ? "invoice_no" : inferred.idField, primaryDate: has("invoice_date") ? "invoice_date" : inferred.primaryDate };
}

// ---------- reconciliation against the SUMMARY sheet ----------

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const aed = (n: number) => `AED ${fmt(n)}`;

interface Pivot { statuses: string[]; months: Map<string, Record<string, number>>; total: Record<string, number>; grand: number; percent: number | null }

/** The status × month pivot: a row starting "STATUS" with status headers up to "Grand Total" (and maybe "Percentage"). The last such pivot wins. */
function readPivot(grid: RawCell[][]): Pivot | null {
  let found: Pivot | null = null;
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (normKey(row[0]) !== "status") continue;
    const cols: { c: number; label: string }[] = [];
    let grandCol = -1, pctCol = -1;
    for (let c = 1; c < row.length; c++) {
      const k = normKey(row[c]);
      if (!k) continue;
      if (k === "grand total") grandCol = c;
      else if (k.startsWith("percent")) pctCol = c;
      else if (grandCol === -1) cols.push({ c, label: cleanText(row[c]) });
    }
    if (grandCol === -1) continue;
    const p: Pivot = { statuses: cols.map((x) => classifyStatus(x.label)), months: new Map(), total: {}, grand: 0, percent: null };
    for (let rr = r + 1; rr < grid.length; rr++) {
      const label = normKey(grid[rr][0]);
      if (!label) break;
      const counts: Record<string, number> = {};
      for (const x of cols) { const v = toNumber(grid[rr][x.c]); const s = classifyStatus(x.label); counts[s] = (counts[s] ?? 0) + (v ?? 0); }
      if (label === "grand total") { p.total = counts; p.grand = toNumber(grid[rr][grandCol]) ?? 0; p.percent = pctCol === -1 ? null : toNumber(grid[rr][pctCol]); break; }
      p.months.set(label, counts);
    }
    found = p;
  }
  return found;
}

/** A typed block of totals under the pivot: "Total Invoice", "Collected", "Pending", "Percentage collected". */
function readTypedBlock(grid: RawCell[][]): { total: number; collected: number | null; pending: number | null; percent: number | null } | null {
  const value = (r: number) => { for (let c = 1; c < grid[r].length; c++) { const v = toNumber(grid[r][c]); if (v !== null) return v; } return null; };
  for (let r = 0; r < grid.length; r++) {
    if (!normKey(grid[r][0]).startsWith("total invoice")) continue;
    const total = value(r);
    if (total === null) continue;
    const out = { total, collected: null as number | null, pending: null as number | null, percent: null as number | null };
    for (let rr = r + 1; rr < Math.min(grid.length, r + 6); rr++) {
      const k = normKey(grid[rr][0]);
      if (k.startsWith("percent")) out.percent = value(rr);
      else if (k.startsWith("collected")) out.collected = value(rr);
      else if (k.startsWith("pending")) out.pending = value(rr);
    }
    return out;
  }
  return null;
}

/** The data sheet's rows reduced to what the reconciliation needs, read the same way the snapshot reads them. */
function dataRows(sheet: ParsedSheet) {
  const col = (id: string) => sheet.headers.find((h) => specFor(h)?.patch.id === id);
  const h = { status: col("status_raw"), value: col("invoice_value"), date: col("invoice_date"), month: col("accounting_month"), type: col("transaction_type"), currency: col("currency"), gross: col("gross_amount"), grossAed: col("gross_amount_aed"), after: col("after_discount_aed"), discount: col("discount_aed"), customer: col("customer") };
  return sheet.rows.map((r) => {
    const c = (k?: string) => (k ? r.cells[k] ?? null : null);
    const date = toDate(c(h.date));
    const month = h.month && c(h.month) ? normKey(c(h.month)) : date !== null ? MONTHS[new Date(date).getUTCMonth()].toLowerCase() : "";
    return {
      row: r.row, status: classifyStatus(c(h.status)), raw: cleanText(c(h.status) ?? ""), value: toNumber(c(h.value)) ?? 0, month, type: normKey(c(h.type)),
      currency: normKey(c(h.currency)), gross: toNumber(c(h.gross)), grossAed: toNumber(c(h.grossAed)), after: toNumber(c(h.after)), discount: toNumber(c(h.discount)) ?? 0, customer: cleanText(c(h.customer) ?? ""),
    };
  }).filter((x) => x.raw || x.value);
}

export function exitCertAux(wb: ParsedWorkbook): Record<string, AuxSheet> {
  const sheet = wb.sheets[wb.primary];
  if (!sheet || !matchesExitCert(sheet.headers)) return {};
  const rows = dataRows(sheet);
  const n = rows.length;
  const by = (s: string) => rows.filter((x) => x.status === s);
  const collected = by("Collected").length;
  const summaryName = Object.keys(wb.grids ?? {}).find((k) => /summary/i.test(k));
  const grid = summaryName ? wb.grids![summaryName] : null;
  const pivot = grid ? readPivot(grid) : null;
  const typed = grid ? readTypedBlock(grid) : null;
  const out: Record<string, ColumnValue>[] = [];
  const add = (check: string, report: string, summary: string | null, note: string) => out.push({ check, report, summary, note });

  const pv = (s: string) => (pivot ? pivot.total[s] ?? 0 : null);
  add("Invoice records", fmt(n), pivot ? fmt(pivot.grand) : null, !pivot ? "No SUMMARY pivot found in the workbook." : pivot.grand === n ? "Matches." : `The pivot counts ${fmt(pivot.grand)}: it was not refreshed after the data sheet changed (${fmt(n - pivot.grand)} rows difference).`);
  for (const s of STATUSES) {
    const mine = by(s), theirs = pv(s);
    if (mine.length === 0 && !theirs) continue;
    const spellings = [...new Set(mine.map((x) => x.raw))];
    const notes: string[] = [];
    if (theirs !== null) notes.push(theirs === mine.length ? "Matches." : `Differs by ${fmt(mine.length - theirs)}: the pivot was not refreshed.`);
    if (s === "Under review") notes.push("The sheet names the person to check with; the dashboard says “Under review”.");
    if (spellings.length > 1) notes.push(s === "Under review" ? `Typed ${spellings.length} ways, counted as one.` : `Typed ${spellings.length} ways (${spellings.map((x) => `“${x}”`).join(", ")}), counted as one.`);
    if (s === "Credit note") notes.push("A credit note cancels an invoice; no certificate is needed.");
    if (s === "Cross trade") notes.push("Goods that did not leave from the UAE; no certificate is needed.");
    if (s === "Other") notes.push(`Statuses the dashboard does not recognise: ${spellings.join(", ")}.`);
    add(s, fmt(mine.length), theirs === null ? null : fmt(theirs), notes.join(" "));
  }

  // Collection rate: this report counts collected over every record; find what the pivot's Percentage divides.
  const needed = rows.filter((x) => !NOT_NEEDED.includes(x.status)).length;
  const rate = n ? collected / n : 0;
  let rateNote = `This report: ${fmt(collected)} collected of ${fmt(n)} records.`;
  if (pivot?.percent !== null && pivot?.percent !== undefined) {
    const p = pivot.percent, credit = pv("Credit note") ?? 0, cross = pv("Cross trade") ?? 0, col = pv("Collected") ?? 0;
    const same = (x: number) => Math.abs(x - p) < 0.0005;
    if (same(col / pivot.grand)) rateNote += " The SUMMARY uses the same definition.";
    else if (same((col + credit) / pivot.grand)) rateNote += ` The SUMMARY's Percentage adds credit notes to collected (${fmt(col)} + ${fmt(credit)}) / ${fmt(pivot.grand)}; a credit note is not a certificate collected, so it is not counted here.`;
    else if (same((col + credit + cross) / pivot.grand)) rateNote += " The SUMMARY's Percentage counts credit notes and cross trade as collected; neither is a certificate collected.";
    else rateNote += ` The SUMMARY's Percentage (${pct(p)}) does not follow from its own counts.`;
  }
  if (needed && needed !== n) rateNote += ` Leaving out the ${fmt(n - needed)} records that need no certificate (credit notes, cross trade) gives ${pct(collected / needed)} (${fmt(collected)} of ${fmt(needed)}).`;
  add("Collection rate", pct(rate), pivot?.percent !== null && pivot?.percent !== undefined ? pct(pivot.percent) : null, rateNote);

  if (pivot && pivot.months.size) {
    const mine = new Map<string, Record<string, number>>();
    for (const x of rows) { const m = (mine.get(x.month) ?? {}); m[x.status] = (m[x.status] ?? 0) + 1; mine.set(x.month, m); }
    const off: string[] = [];
    for (const [m, counts] of pivot.months) {
      const d = mine.get(m) ?? {};
      const diff = STATUSES.filter((s) => (counts[s] ?? 0) !== (d[s] ?? 0));
      if (diff.length) off.push(`${m[0].toUpperCase()}${m.slice(1)} (${diff.map((s) => `${s.toLowerCase()} ${fmt(d[s] ?? 0)} vs ${fmt(counts[s] ?? 0)}`).join(", ")})`);
    }
    const extra = [...mine.keys()].filter((m) => m && !pivot.months.has(m));
    add("Month by month", `${fmt(mine.size)} months`, `${fmt(pivot.months.size)} months`, off.length || extra.length ? `Differences: ${[...off, ...extra.map((m) => `${m} is missing from the pivot`)].join("; ")}.` : "Every month and status matches the pivot.");
  }

  if (typed) {
    // The typed block often counts one transaction type only: find the subset of rows whose size it matches.
    const types = [...new Set(rows.map((x) => x.type).filter(Boolean))];
    const subset = types.map((t) => ({ t, rows: rows.filter((x) => x.type === t) })).find((s) => s.rows.length === typed.total);
    const base = subset ? subset.rows : rows;
    const bc = base.filter((x) => x.status === "Collected").length;
    const scope = subset ? `${fmt(typed.total)} counts only the rows with transaction type ${subset.t.toUpperCase()}; the other ${fmt(n - base.length)} rows have ${types.length > 1 ? "another type" : "none"}.` : "";
    add("Typed totals: invoices", fmt(base.length), fmt(typed.total), subset ? `${scope} The block is typed, not calculated.` : typed.total === n ? "Matches." : "Matches no count of the data sheet; the block is typed, not calculated.");
    if (typed.collected !== null) add("Typed totals: collected", fmt(bc), fmt(typed.collected), typed.collected === bc ? "Matches." : `Out of date: ${fmt(bc)} of the same rows are collected today. Not used.`);
    if (typed.pending !== null) add("Typed totals: not collected", fmt(base.length - bc), fmt(typed.pending), typed.pending === base.length - bc ? "Matches." : "Out of date. Not used.");
    if (typed.percent !== null) add("Typed totals: percentage", pct(base.length ? bc / base.length : 0), pct(typed.percent), Math.abs(typed.percent - (base.length ? bc / base.length : 0)) < 0.0005 ? "Matches." : "Out of date. Not used.");
  }

  const pendingValue = by("Pending").reduce((a, x) => a + x.value, 0);
  add("Pending invoice value", aed(pendingValue), null, "Sum of INVOICE_AMOUNT_AED over the Pending rows. The SUMMARY carries no values.");

  // GROSS_AMOUNT_AED converted twice: the gross was already in AED and was multiplied by the exchange rate again.
  const doubled = rows.filter((x) => x.currency && x.currency !== "aed" && x.gross !== null && x.grossAed !== null && x.after !== null && Math.abs(x.grossAed - x.discount - x.after) > 1 && Math.abs(x.gross - x.after) < 1);
  if (doubled.length) {
    const over = doubled.reduce((a, x) => a + (x.grossAed! - x.gross!), 0);
    const ex = doubled.reduce((a, x) => (Math.abs(x.grossAed! - x.gross!) > Math.abs(a.grossAed! - a.gross!) ? x : a));
    add("Gross amount (AED) column", `${fmt(doubled.length)} rows`, null, `On ${fmt(doubled.length)} foreign-currency rows the gross amount is already in AED and GROSS_AMOUNT_AED multiplies it by the exchange rate a second time (largest: ${ex.customer}, ${fmt(ex.gross!)} became ${fmt(ex.grossAed!)}). Adding up that column would overstate by ${aed(over)}. INVOICE_AMOUNT_AED is right on every row and is the value this report uses.`);
  }

  // A side list of invoices with notes on what is missing, which goes stale as certificates arrive.
  const missingName = Object.keys(wb.grids ?? {}).find((k) => /missing/i.test(k));
  if (missingName) {
    const byInvoice = new Map(sheet.rows.map((r) => { const h = sheet.headers.find((x) => specFor(x)?.patch.id === "invoice_no"); return [String(h ? r.cells[h] ?? "" : ""), classifyStatus(r.cells[sheet.headers.find((x) => specFor(x)?.patch.id === "status_raw") ?? ""])] as const; }));
    let listed = 0, noted = 0, notedNowCollected = 0;
    for (const row of wb.grids![missingName].slice(1)) {
      const inv = row.find((v) => v !== null && byInvoice.has(String(v)));
      if (inv === undefined) continue;
      listed++;
      const k = row.findIndex((v) => /^(pending|collected)$/i.test(cleanText(v ?? "")));
      const note = k === -1 ? false : row.slice(k + 1).some((v) => typeof v === "string" && v.trim());
      if (note) { noted++; if (byInvoice.get(String(inv)) === "Collected") notedNowCollected++; }
    }
    if (listed) add(`“${missingName}” sheet`, `${fmt(listed)} invoices`, null, `Lists ${fmt(listed)} invoices; ${fmt(noted)} carry a note on what is missing${noted ? `, and ${noted === notedNowCollected ? "all" : fmt(notedNowCollected)} of those are now collected` : ""}. Not used for the figures.`);
  }

  return {
    reconciliation: {
      id: "reconciliation", label: "How the figures tie to the SUMMARY sheet",
      columns: [
        { id: "check", label: "Figure", type: "string" }, { id: "report", label: "This report", type: "string" },
        { id: "summary", label: "SUMMARY sheet", type: "string" }, { id: "note", label: "Note", type: "string", wrap: true },
      ],
      rows: out,
    },
  };
}

// ---------- layout ----------

const records = (filter?: FilterExpr): MetricSpec => ({ agg: "count", format: "integer", ...(filter ? { filter } : {}) });
const value = (filter?: FilterExpr): MetricSpec => ({ agg: "sum", field: "invoice_value", format: "currency", currency: CURRENCY, ...(filter ? { filter } : {}) });
const share = (numerator: FilterExpr, denominator?: FilterExpr): MetricSpec => ({ agg: "rate", numerator, ...(denominator ? { denominator } : {}), format: "percent", decimals: 1 });
const COLLECTED = group("Collected"), PENDING = status("Pending"), OTHER = group("Other"), MISSING = status("Certificate missing");
const NEEDED: FilterExpr = { field: "status", op: "nin", value: NOT_NEEDED };
const NOT_COLLECTED: FilterExpr = { not: COLLECTED };
const OVER_30: FilterExpr = { and: [PENDING, { field: "age_days", op: "gt", value: 30 }] };
const OVER_90: FilterExpr = { and: [IS_OPEN, { field: "age_days", op: "gt", value: 90 }] };

export function exitCertLayout(schema: SchemaMap): Layout {
  const has = (id: string) => schema.fields.some((f) => f.id === id);
  const cols = (ids: string[]) => ids.filter(has);
  const table = (w: Omit<Extract<Widget, { type: "table" }>, "type">): Widget => ({ type: "table", rowLabel: "invoices", ...w, columns: cols(w.columns) });
  const customers = (w: Omit<Extract<Widget, { type: "table" }>, "type" | "groupBy" | "rowLabel">): Widget => ({ type: "table", groupBy: "customer", rowLabel: "customers", ...w, columns: cols(w.columns) });

  const executive: Page = { id: "executive", title: "Executive", widgets: [
    { id: "insights", type: "insights", title: "What changed since the last update" },
    { id: "kpi_records", type: "kpi", title: "Invoice records", metric: records(), good: "none", secondary: { metric: value(), label: "invoiced" } },
    { id: "kpi_collected", type: "kpi", title: "Collected", metric: records(COLLECTED), good: "up", onClick: COLLECTED, secondary: { metric: value(COLLECTED), label: "invoice value" } },
    { id: "kpi_pending", type: "kpi", title: "Pending", metric: records(PENDING), good: "down", onClick: PENDING, secondary: { metric: records(OVER_30), label: "open more than 30 days" } },
    { id: "kpi_other", type: "kpi", title: "Other statuses", metric: records(OTHER), good: "none", onClick: OTHER, secondary: { metric: records(MISSING), label: "certificates missing" } },
    { id: "kpi_rate", type: "kpi", title: "Collection rate", metric: share(COLLECTED), good: "up", secondary: { metric: share(COLLECTED, NEEDED), label: "excl. credit notes" } },
    { id: "kpi_value", type: "kpi", title: "Pending invoice value", metric: value(PENDING), good: "down", onClick: PENDING, secondary: { metric: value(IS_OPEN), label: "all open" } },
    { id: "status_mix", type: "bar", title: "Status distribution", subtitle: "Invoice records by certificate status, click to filter", dimension: "status", metric: records(), sort: "order", colorBy: "status", orientation: "horizontal" },
    { id: "monthly", type: "bar", title: "Monthly performance", subtitle: "Records by invoice month: collected, pending and other", dimension: "month", metric: records(), stackBy: "status_group", sort: "date", colorBy: "status", orientation: "vertical" },
    table({ id: "top_pending", title: "Five largest pending invoices", subtitle: "By invoice value", columns: ["invoice_no", "customer", "country", "invoice_date", "age_days", "invoice_value"], filter: PENDING, sort: { field: "invoice_value", dir: "desc" }, limit: 5, pageSize: 5 }),
    customers({ id: "key_customers", title: "Key customers", subtitle: "The six with the most pending value; all customers are on the Customers page", columns: ["customer", "records", "n_collected", "n_pending", "pending_value"], sort: { field: "pending_value", dir: "desc" }, emphasisField: "pending_value", limit: 6, pageSize: 6 }),
  ], grid: [
    { i: "insights", x: 0, y: 0, w: 12, h: 2, minH: 2 },
    { i: "kpi_records", x: 0, y: 2, w: 2, h: 3 }, { i: "kpi_collected", x: 2, y: 2, w: 2, h: 3 }, { i: "kpi_pending", x: 4, y: 2, w: 2, h: 3 },
    { i: "kpi_other", x: 6, y: 2, w: 2, h: 3 }, { i: "kpi_rate", x: 8, y: 2, w: 2, h: 3 }, { i: "kpi_value", x: 10, y: 2, w: 2, h: 3 },
    { i: "status_mix", x: 0, y: 5, w: 4, h: 7 }, { i: "monthly", x: 4, y: 5, w: 8, h: 7 },
    { i: "top_pending", x: 0, y: 12, w: 6, h: 8 }, { i: "key_customers", x: 6, y: 12, w: 6, h: 8 },
  ] };

  const monthly: Page = { id: "monthly", title: "Monthly", widgets: [
    { id: "rate_month", type: "bar", title: "Collection rate by month", subtitle: "Recent months are still open: certificates arrive weeks after the invoice", dimension: "month", metric: share(COLLECTED), sort: "date", colorBy: "single", orientation: "vertical" },
    { id: "status_month", type: "bar", title: "Status by month", subtitle: "Records by invoice month and status", dimension: "month", metric: records(), stackBy: "status", sort: "date", colorBy: "status", orientation: "vertical" },
    table({ id: "month_table", title: "Month by month", subtitle: "Invoice month, with the value still pending", columns: ["month", "records", "n_collected", "n_pending", "n_other", "collection_rate", "pending_value"], groupBy: "month", rowLabel: "months", sort: { field: "invoice_date", dir: "asc" }, pageSize: 24 }),
    { id: "outstanding", type: "bar", title: "Outstanding cases", subtitle: "Everything not collected, by status", dimension: "status", metric: records(), filter: NOT_COLLECTED, sort: "order", colorBy: "status", orientation: "horizontal" },
    { id: "age_value", type: "bar", title: "How long cases have been open", subtitle: "Open invoice value (AED) by days since the invoice", dimension: "age_band", metric: value(IS_OPEN), stackBy: "status", sort: "order", colorBy: "status", orientation: "horizontal",
      note: "UAE VAT treats an export as zero-rated when there is proof the goods left, normally within 90 days of the invoice. Open cases older than that may be worth a word with the tax team." },
    { id: "pending_month", type: "bar", title: "Pending value by month", subtitle: "AED still waiting for a certificate, by invoice month", dimension: "month", metric: value(PENDING), sort: "date", colorBy: "single", orientation: "vertical" },
  ], grid: [
    { i: "rate_month", x: 0, y: 0, w: 6, h: 7 }, { i: "status_month", x: 6, y: 0, w: 6, h: 7 },
    { i: "month_table", x: 0, y: 7, w: 12, h: 10 },
    { i: "outstanding", x: 0, y: 17, w: 4, h: 7 }, { i: "age_value", x: 4, y: 17, w: 4, h: 7 }, { i: "pending_month", x: 8, y: 17, w: 4, h: 7 },
  ] };

  const actions: Page = { id: "actions", title: "Action tracker", widgets: [
    { id: "open_count", type: "kpi", title: "Open cases", metric: records(IS_OPEN), good: "down", onClick: IS_OPEN, secondary: { metric: value(IS_OPEN), label: "invoice value" } },
    { id: "open_pending", type: "kpi", title: "Pending", metric: records(PENDING), good: "down", onClick: PENDING, secondary: { metric: value(PENDING), label: "invoice value" } },
    { id: "open_old", type: "kpi", title: "Open more than 90 days", metric: records(OVER_90), good: "down", onClick: OVER_90, secondary: { metric: value(OVER_90), label: "invoice value" } },
    { id: "open_missing", type: "kpi", title: "Certificates missing", metric: records(MISSING), good: "down", onClick: MISSING, secondary: { metric: value(MISSING), label: "invoice value" } },
    table({ id: "open_cases", title: "Action tracker", subtitle: "Every invoice still owed a certificate, oldest first; click a column to sort", columns: ["invoice_no", "customer", "country", "invoice_date", "age_days", "invoice_value", "status", "next_step"], filter: IS_OPEN, sort: { field: "age_days", dir: "desc" }, statusField: "status", emphasisField: "age_days", search: true, pageSize: 50 }),
    { id: "open_customer", type: "bar", title: "Open value by customer", subtitle: "AED, split by status", dimension: "customer", metric: value(IS_OPEN), stackBy: "status", colorBy: "status", orientation: "horizontal", topN: 10 },
    { id: "open_country", type: "bar", title: "Open cases by country", subtitle: "Invoices still owed a certificate", dimension: "country", metric: records(IS_OPEN), stackBy: "status", colorBy: "status", orientation: "horizontal", topN: 10 },
    table({ id: "not_needed", title: "No certificate needed", subtitle: "Credit notes cancel an invoice; cross trade did not leave from the UAE", columns: ["invoice_no", "customer", "country", "invoice_date", "invoice_value", "status"], filter: status(...NOT_NEEDED), sort: { field: "invoice_date", dir: "desc" }, statusField: "status", pageSize: 20 }),
  ], grid: [
    { i: "open_count", x: 0, y: 0, w: 3, h: 3 }, { i: "open_pending", x: 3, y: 0, w: 3, h: 3 }, { i: "open_old", x: 6, y: 0, w: 3, h: 3 }, { i: "open_missing", x: 9, y: 0, w: 3, h: 3 },
    { i: "open_cases", x: 0, y: 3, w: 12, h: 11 },
    { i: "open_customer", x: 0, y: 14, w: 6, h: 8 }, { i: "open_country", x: 6, y: 14, w: 6, h: 8 },
    { i: "not_needed", x: 0, y: 22, w: 12, h: 6 },
  ] };

  const customerPage: Page = { id: "customers", title: "Customers", widgets: [
    customers({ id: "customer_table", title: "Every customer", subtitle: "Largest pending value first; click a column to sort", columns: ["customer", "country", "records", "n_collected", "n_pending", "n_other", "collection_rate", "pending_value", "open_value"], sort: { field: "pending_value", dir: "desc" }, emphasisField: "pending_value", search: true, pageSize: 60 }),
    { id: "customer_records", type: "bar", title: "Records by customer", subtitle: "Collected, pending and other", dimension: "customer", metric: records(), stackBy: "status_group", colorBy: "status", orientation: "horizontal", topN: 15 },
    { id: "country_records", type: "bar", title: "Records by country", subtitle: "Collected, pending and other", dimension: "country", metric: records(), stackBy: "status_group", colorBy: "status", orientation: "horizontal", topN: 15 },
  ], grid: [
    { i: "customer_table", x: 0, y: 0, w: 12, h: 14 },
    { i: "customer_records", x: 0, y: 14, w: 6, h: 10 }, { i: "country_records", x: 6, y: 14, w: 6, h: 10 },
  ] };

  const reconciliation: Page = { id: "reconciliation", title: "Reconciliation", widgets: [
    { id: "recon", type: "auxTable", title: "How the figures tie to the SUMMARY sheet", subtitle: "Every figure in this report is counted from the data sheet; the SUMMARY sheet is only compared", sheet: "reconciliation", columns: ["check", "report", "summary", "note"], rowLabel: "checks", pageSize: 40 },
  ], grid: [{ i: "recon", x: 0, y: 0, w: 12, h: 20 }] };

  const register: Page = { id: "register", title: "Register", widgets: [
    table({ id: "register", title: "All invoices", subtitle: "One row per invoice", columns: ["invoice_no", "customer", "country", "invoice_date", "currency", "invoice_value", "delivery_terms", "transport", "status", "age_days", "review_note"], sort: { field: "invoice_date", dir: "desc" }, statusField: "status", search: true, pageSize: 60 }),
  ], grid: [{ i: "register", x: 0, y: 0, w: 12, h: 18 }] };
  const quality: Page = { id: "quality", title: "Data quality", widgets: [{ id: "quality", type: "quality", title: "Data quality" }], grid: [{ i: "quality", x: 0, y: 0, w: 12, h: 16 }] };

  const filters: Layout["filters"] = [
    { kind: "daterange", field: "invoice_date", label: "Invoice date" },
    { kind: "select", field: "status", label: "Status" },
    { kind: "select", field: "customer", label: "Customer" },
    { kind: "select", field: "country", label: "Country" },
    { kind: "select", field: "currency", label: "Currency" },
    { kind: "select", field: "transport", label: "Shipped by" },
    { kind: "search", field: "invoice_no", label: "Search" },
  ].filter((f) => has(f.field)) as Layout["filters"];
  return { version: 1, dateField: "invoice_date", filters, pages: [executive, monthly, actions, customerPage, reconciliation, register, quality] };
}

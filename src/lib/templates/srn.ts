import type { AuxSheet, ColumnValue, Field, FilterExpr, ParsedSheet, ParsedWorkbook, RawCell, RawRow, SchemaMap } from "@/lib/schema/types";
import { normKey } from "@/lib/schema/types";
import { parseLooseDate } from "@/lib/excel/parse";
import type { Layout, Page, Widget } from "@/lib/dashboard/types";
import type { MetricSpec } from "@/lib/engine/metrics";

/**
 * SRN log: one line per service receipt note (SRN) posted in the ERP against a purchase order for a logistics vendor's
 * invoice (vendor, PO, invoice number and date, BL, currency, invoice amount, SRN amount and number, SRN date).
 * Matched by headers. The sheet is typed by hand, so it is cleaned into a "SRN lines" sheet before the pipeline sees it:
 *
 * - An invoice split over several POs is typed on several lines; a line with no invoice number right under a line of
 *   the same vendor belongs to that invoice.
 * - The invoice amount is typed on the first line of a split, or repeated on every line when a later SRN tops up an
 *   earlier one: an invoice whose SRNs add up to its amount (or repeats one amount) is compared as a whole; otherwise
 *   each line is compared with its own amount. A gap of no more than the 5% VAT is VAT (an SRN is posted without VAT).
 * - Amounts stay in the invoice currency and are converted to AED at fixed rates (USD and SAR are pegged; EUR is an
 *   average). Lines with no currency take their invoice's or vendor's currency, else AED, and say so.
 * - Invoice dates typed in a future year (3026) take the SRN date's year; a typed date after its SRN date that fits once
 *   day and month are swapped is swapped. Each correction is listed on the Data quality page.
 */

export const SRN_SHEET = "SRN lines";
export const RATES: Record<string, number> = { AED: 1, USD: 3.6725, SAR: 3.6725 / 3.75, EUR: 4.28 };
const DAY = 86_400_000;

const HEADERS = [
  "Line", "SRN date", "Vendor", "PO number", "Invoice number", "Invoice date", "BL / reference", "Currency", "Invoice amount", "SRN amount",
  "SRN number", "Invoice value (AED)", "SRN value (AED)", "VAT gap (AED)", "Other gap (AED)", "Status", "Invoice vs SRN", "Corrections",
];

type Cols = { srnDate?: string; vendor: string; po: string; invDate?: string; invNo?: string; bl?: string; currency?: string; invAmt?: string; srnAmt: string; srnNo: string; poAmount?: string; balance?: string };
const pick = (headers: string[], ...names: string[]) => headers.find((h) => names.includes(normKey(h)));

function srnColumns(sheet: ParsedSheet): Cols | null {
  const h = sheet.headers;
  const vendor = pick(h, "vender", "vendor", "vendor name", "supplier"), po = pick(h, "po number", "po no", "po"), srnAmt = pick(h, "srn amount", "srn value"), srnNo = pick(h, "srn number", "srn no", "srn");
  if (!vendor || !po || !srnAmt || !srnNo) return null;
  return {
    vendor, po, srnAmt, srnNo, srnDate: pick(h, "date", "srn date"), invDate: pick(h, "invoice date", "inv date"), invNo: pick(h, "invoice number", "invoice no", "inv no"),
    bl: pick(h, "bl number", "bl no", "bl", "b/l number"), currency: pick(h, "currency", "curr"), invAmt: pick(h, "actual invoice", "invoice amount", "invoice value"),
    poAmount: pick(h, "po amount"), balance: pick(h, "balance"),
  };
}

export function matchesSrn(headers: string[]): boolean {
  return ["line", "srn number", "srn value (aed)", "invoice vs srn"].every((k) => headers.some((h) => normKey(h) === k));
}

const num = (v: RawCell): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^-?[\d,]+(\.\d+)?$/.test(v.trim()) ? Number(v.replace(/,/g, "")) : null);
const text = (v: RawCell): string | null => { if (v === null || v === undefined) return null; const s = String(v).replace(/\s+/g, " ").trim(); return s ? s : null; };
const ref = (v: RawCell): string | null => { if (v === null || v === undefined) return null; const s = String(v).replace(/\s+/g, "").toUpperCase(); return s ? s : null; };
const typedDate = (v: RawCell) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v);
function toMs(v: RawCell): number | null {
  if (typeof v === "number") return v > 20000 && v < 80000 ? Math.round((v - 25569) * DAY) : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const t = Date.parse(s); return Number.isNaN(t) ? null : t; }
  return parseLooseDate(s);
}
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const isoCell = (t: number | null) => (t === null ? null : new Date(t).toISOString());
const round2 = (x: number) => Math.round(x * 100) / 100;

interface Line {
  row: number; srnDate: number | null; vendor: string; po: string | null; invNo: string | null; invDate: number | null; bl: string | null;
  currency: string | null; invAmt: number | null; srnAmt: number | null; srnNo: string | null; poAmount: number | null; balance: number | null;
  notes: { field: string; from: string; to: string; reason: string }[];
  counted: number | null; vatGap: number; otherGap: number; check: string;
}

function readLines(sheet: ParsedSheet, c: Cols): Line[] {
  const out: Line[] = [];
  for (const r of sheet.rows) {
    const cell = (h?: string): RawCell => (h ? r.cells[h] ?? null : null);
    const vendor = text(cell(c.vendor));
    const srnAmt = num(cell(c.srnAmt)), invAmt = num(cell(c.invAmt));
    if (!vendor && srnAmt === null && invAmt === null) continue;
    const line: Line = {
      row: r.row, srnDate: toMs(cell(c.srnDate)), vendor: vendor ?? "Not set", po: ref(cell(c.po)), invNo: ref(cell(c.invNo)), invDate: toMs(cell(c.invDate)), bl: text(cell(c.bl)),
      currency: text(cell(c.currency))?.toUpperCase() ?? null, invAmt, srnAmt, srnNo: ref(cell(c.srnNo))?.replace(/[^0-9A-Z-]/g, "") || null,
      poAmount: num(cell(c.poAmount)), balance: num(cell(c.balance)), notes: [], counted: null, vatGap: 0, otherGap: 0, check: "",
    };
    // A split line typed without its invoice number belongs to the invoice on the line above (same vendor).
    const prev = out[out.length - 1];
    if (!line.invNo && prev && prev.vendor === line.vendor && prev.invNo) {
      line.invNo = prev.invNo;
      line.notes.push({ field: "invoice_no", from: "(blank)", to: prev.invNo, reason: "Invoice number taken from the line above (same vendor, split over another PO)" });
    }
    if (line.bl && (/^#/.test(line.bl) || typedDate(cell(c.bl)))) {
      line.notes.push({ field: "bl", from: line.bl.startsWith("#") ? line.bl : iso(Date.parse(line.bl)), to: "(blank)", reason: line.bl.startsWith("#") ? "An Excel error instead of a BL number" : "BL number stored as a date in the sheet" });
      line.bl = null;
    }
    const rawInv = cell(c.invDate);
    if (line.invDate !== null && line.srnDate !== null) {
      const d = new Date(line.invDate), srnYear = new Date(line.srnDate).getUTCFullYear();
      if (d.getUTCFullYear() > srnYear + 1) {
        const fixed = Date.UTC(srnYear, d.getUTCMonth(), d.getUTCDate());
        line.notes.push({ field: "invoice_date", from: iso(line.invDate), to: iso(fixed), reason: "Year typed wrong; set to the SRN date's year" });
        line.invDate = fixed;
      } else if (line.invDate > line.srnDate && typedDate(rawInv) && d.getUTCDate() <= 12) {
        const swapped = Date.UTC(d.getUTCFullYear(), d.getUTCDate() - 1, d.getUTCMonth() + 1);
        if (swapped <= line.srnDate) {
          line.notes.push({ field: "invoice_date", from: iso(line.invDate), to: iso(swapped), reason: "Invoice date after its SRN date; day and month looked swapped" });
          line.invDate = swapped;
        }
      }
    }
    out.push(line);
  }
  // Currency: the invoice's, else the vendor's usual one, else AED.
  const vendorCur = new Map<string, Map<string, number>>();
  for (const l of out) if (l.currency) { const m = vendorCur.get(l.vendor) ?? new Map(); m.set(l.currency, (m.get(l.currency) ?? 0) + 1); vendorCur.set(l.vendor, m); }
  const invCur = new Map<string, string>();
  for (const l of out) if (l.currency && l.invNo) invCur.set(`${l.vendor}|${l.invNo}`, l.currency);
  for (const l of out) {
    if (l.currency) continue;
    const fromInvoice = l.invNo ? invCur.get(`${l.vendor}|${l.invNo}`) : undefined;
    const fromVendor = [...(vendorCur.get(l.vendor)?.entries() ?? [])].sort((a, b) => b[1] - a[1])[0]?.[0];
    l.currency = fromInvoice ?? fromVendor ?? "AED";
    l.notes.push({ field: "currency", from: "(blank)", to: l.currency, reason: fromInvoice ? "Currency of the same invoice's other line" : fromVendor ? "Vendor's usual currency" : "No currency typed; AED assumed" });
  }
  compare(out);
  return out;
}

function classify(inv: number | null, srn: number): { check: string; vat: number; other: number } {
  if (inv === null || inv <= 0) return { check: "No invoice amount", vat: 0, other: 0 };
  const gap = inv - srn;
  if (Math.abs(gap) <= 0.5) return { check: "Matches", vat: 0, other: 0 };
  if (gap > 0 && gap <= (inv * 5) / 105 + 0.5) return { check: "Gap within VAT (5%)", vat: gap, other: 0 };
  return { check: gap > 0 ? "SRN below invoice" : "SRN above invoice", vat: 0, other: gap };
}

/** Invoice against SRN, per invoice where its lines carry one amount, else per line. Gaps are counted once per invoice. */
function compare(lines: Line[]) {
  const groups = new Map<string, Line[]>();
  lines.forEach((l, i) => { const k = l.invNo ? `${l.vendor}|${l.invNo}` : `row|${i}`; groups.set(k, [...(groups.get(k) ?? []), l]); });
  for (const g of groups.values()) {
    for (const l of g) if (!l.srnNo) l.check = "Awaiting SRN number";
    const amounts = g.map((l) => l.invAmt).filter((v): v is number => v !== null && v > 0);
    const srnSum = g.reduce((a, l) => a + (l.srnAmt ?? 0), 0);
    // The invoice total is the amount repeated on every line (a top-up SRN), or the largest amount when all the
    // invoice's SRNs add up to it (the other lines carry their own part, or nothing).
    const total = amounts.length ? Math.max(...amounts) : null;
    const repeated = amounts.length > 1 && amounts.every((a) => a === amounts[0]);
    const covers = total !== null && srnSum <= total + 0.5 && srnSum >= total * (100 / 105) - 0.5;
    if (g.length > 1 && total !== null && (repeated || covers)) {
      const first = g.find((l) => l.invAmt === total)!;
      first.counted = total;
      const k = g.some((l) => l.srnAmt === null && l.srnNo) ? { check: "SRN amount missing", vat: 0, other: 0 } : classify(total, srnSum);
      first.vatGap = k.vat; first.otherGap = k.other;
      for (const l of g) l.check ||= k.check;
    } else {
      for (const l of g) {
        l.counted = l.invAmt !== null && l.invAmt > 0 ? l.invAmt : null;
        if (l.check) continue;
        if (l.srnAmt === null) { l.check = l.invAmt ? "SRN amount missing" : "No invoice amount"; continue; }
        const k = classify(l.counted, l.srnAmt);
        l.check = k.check; l.vatGap = k.vat; l.otherGap = k.other;
      }
    }
  }
}

/** Replaces the SRN sheet with one clean line per SRN line, ahead of the other sheets. */
export function prepareSrnWorkbook(wb: ParsedWorkbook): ParsedWorkbook {
  if (wb.sheets.some((s) => s.name === SRN_SHEET)) return wb;
  const source = wb.sheets.find((s) => srnColumns(s));
  if (!source) return wb;
  const lines = readLines(source, srnColumns(source)!);
  const keys = new Map<string, number>();
  const base = lines.map((l) => (l.srnNo ? `SRN ${l.srnNo}` : `Invoice ${l.invNo ?? `row ${l.row}`}`));
  const shared = new Map<string, number>();
  for (const b of base) shared.set(b, (shared.get(b) ?? 0) + 1);
  const rows: RawRow[] = lines.map((l, i) => {
    let key = shared.get(base[i])! > 1 && l.po ? `${base[i]} · PO ${l.po}` : base[i];
    const k = (keys.get(key) ?? 0) + 1;
    keys.set(key, k);
    if (k > 1) key = `${key} (${k})`;
    const rate = RATES[l.currency ?? "AED"] ?? null;
    const aed = (v: number | null) => (v === null || rate === null ? null : round2(v * rate));
    const cells: Record<string, RawCell> = {
      "Line": key, "SRN date": isoCell(l.srnDate), "Vendor": l.vendor, "PO number": l.po, "Invoice number": l.invNo, "Invoice date": isoCell(l.invDate), "BL / reference": l.bl,
      "Currency": l.currency, "Invoice amount": l.invAmt, "SRN amount": l.srnAmt, "SRN number": l.srnNo, "Invoice value (AED)": aed(l.counted), "SRN value (AED)": aed(l.srnAmt),
      "VAT gap (AED)": l.vatGap ? aed(l.vatGap) : null, "Other gap (AED)": l.otherGap ? aed(l.otherGap) : null,
      "Status": l.srnNo ? "SRN posted" : "Awaiting SRN number", "Invoice vs SRN": l.check, "Corrections": l.notes.length ? JSON.stringify(l.notes) : null,
    };
    return { row: l.row, cells };
  });
  const sheet: ParsedSheet = { name: SRN_SHEET, headerRow: 1, headers: HEADERS, rows, stats: statsFor(HEADERS, rows), validations: {}, totalRowsInSheet: rows.length + 1 };
  return { ...wb, sheets: [sheet, ...wb.sheets], primary: 0 };
}

function statsFor(headers: string[], rows: RawRow[]) {
  return headers.map((header, index) => {
    const values = rows.map((r) => r.cells[header]).filter((v) => v !== null && v !== undefined);
    const distinct = new Set(values.map(String));
    return {
      header, index, nonEmpty: values.length, numbers: values.filter((v) => typeof v === "number").length, dates: values.filter(typedDate).length, booleans: 0,
      strings: values.filter((v) => typeof v === "string" && !typedDate(v)).length, distinct: distinct.size,
      avgLength: values.length ? values.reduce((a: number, v) => a + String(v).length, 0) / values.length : 0, samples: [...distinct].slice(0, 8),
    };
  });
}

const CHECKS = ["Matches", "Gap within VAT (5%)", "SRN below invoice", "SRN above invoice", "SRN amount missing", "No invoice amount", "Awaiting SRN number"];
const AGE = ["Within 30 days", "31–60 days", "61–90 days", "91–180 days", "Over 180 days"];
type Spec = Partial<Field> & { id: string; label: string; type: Field["type"]; role: Field["role"] };
const SPECS: Record<string, Spec> = {
  "Line": { id: "line", label: "Line", type: "string", role: "id" },
  "SRN date": { id: "srn_date", label: "SRN date", type: "date", role: "date", format: "date" },
  "Vendor": { id: "vendor", label: "Vendor", type: "string", role: "dimension" },
  "PO number": { id: "po", label: "PO number", type: "string", role: "dimension" },
  "Invoice number": { id: "invoice_no", label: "Invoice no.", type: "string", role: "text" },
  "Invoice date": { id: "invoice_date", label: "Invoice date", type: "date", role: "date", format: "date" },
  "BL / reference": { id: "bl", label: "BL / reference", type: "string", role: "text", hidden: true },
  "Currency": { id: "currency", label: "Currency", type: "string", role: "dimension", order: ["AED", "USD", "SAR", "EUR"] },
  "Invoice amount": { id: "invoice_amount", label: "Invoice amount (own currency)", type: "number", role: "measure", format: "decimal", hidden: true },
  "SRN amount": { id: "srn_amount", label: "SRN amount (own currency)", type: "number", role: "measure", format: "decimal", hidden: true },
  "SRN number": { id: "srn_no", label: "SRN no.", type: "string", role: "text" },
  "Invoice value (AED)": { id: "invoice_aed", label: "Invoice value (AED)", type: "number", role: "measure", format: "currency", currency: "AED", semantic: "amount" },
  "SRN value (AED)": { id: "srn_aed", label: "SRN value (AED)", type: "number", role: "measure", format: "currency", currency: "AED", semantic: "amount" },
  "VAT gap (AED)": { id: "vat_gap_aed", label: "VAT not in SRN (AED)", type: "number", role: "measure", format: "currency", currency: "AED" },
  "Other gap (AED)": { id: "gap_aed", label: "Gap beyond VAT (AED)", type: "number", role: "measure", format: "currency", currency: "AED" },
  "Status": { id: "status", label: "Status", type: "string", role: "dimension", semantic: "status", order: ["SRN posted", "Awaiting SRN number"] },
  "Invoice vs SRN": { id: "check", label: "Invoice vs SRN", type: "string", role: "dimension", order: CHECKS },
  "Corrections": { id: "notes", label: "Corrections", type: "string", role: "text", hidden: true },
};

export function srnSchema(inferred: SchemaMap): SchemaMap {
  const fields: Field[] = [];
  for (const f of inferred.fields) {
    if (f.derived) continue;
    const spec = f.source ? SPECS[f.source] : undefined;
    fields.push(spec ? { ...spec, source: f.source } as Field : { ...f, hidden: true });
  }
  fields.push(
    { id: "lines", label: "Lines", source: null, type: "number", role: "measure", format: "integer", aggregate: "sum", hidden: true, derived: { kind: "case", cases: [], fallback: 1 } },
    { id: "days_to_srn", label: "Days invoice → SRN", source: null, type: "number", role: "measure", format: "days", aggregate: "avg", derived: { kind: "diffDays", from: "invoice_date", to: "srn_date" } },
    { id: "age_band", label: "Invoice age at SRN", source: null, type: "string", role: "dimension", order: AGE, derived: { kind: "bucket", from: "days_to_srn", edges: [31, 61, 91, 181], labels: AGE } },
    { id: "srn_month", label: "SRN month", source: null, type: "string", role: "dimension", derived: { kind: "monthLabel", from: "srn_date" } },
  );
  return { ...inferred, sheet: SRN_SHEET, fields, idField: "line", primaryDate: "srn_date", noteField: "notes", foldCase: true };
}

const is = (field: string, value: string): FilterExpr => ({ field, op: "eq", value });
const AWAITING = is("status", "Awaiting SRN number");
const BEYOND_VAT: FilterExpr = { field: "check", op: "in", value: ["SRN below invoice", "SRN above invoice"] };
const DATED: FilterExpr = { field: "days_to_srn", op: "notNull" };
const OVER_90: FilterExpr = { field: "days_to_srn", op: "gt", value: 90 };
const aed = (field: string, filter?: FilterExpr): MetricSpec => ({ agg: "sum", field, format: "currency", currency: "AED", ...(filter ? { filter } : {}) });
const lines = (filter?: FilterExpr): MetricSpec => ({ agg: "count", ...(filter ? { filter } : {}) });

export function srnLayout(): Layout {
  const table = (w: Omit<Extract<Widget, { type: "table" }>, "type">): Widget => ({ type: "table", rowLabel: "lines", statusField: "status", ...w });
  const byVendor = (w: Omit<Extract<Widget, { type: "table" }>, "type" | "groupBy" | "rowLabel">): Widget => ({ type: "table", groupBy: "vendor", rowLabel: "vendors", ...w });
  const lineCols = ["line", "vendor", "po", "invoice_no", "invoice_date", "srn_date", "days_to_srn", "currency", "srn_aed", "check", "status"];

  const overview: Page = { id: "overview", title: "Overview", widgets: [
    { id: "insights", type: "insights", title: "What changed since the last update" },
    { id: "kpi_value", type: "kpi", title: "SRN value", metric: aed("srn_aed"), good: "none", secondary: { metric: lines(), label: "lines" } },
    { id: "kpi_vendors", type: "kpi", title: "Vendors", metric: { agg: "distinct", field: "vendor" }, good: "none", secondary: { metric: { agg: "distinct", field: "invoice_no" }, label: "invoices" } },
    { id: "kpi_days", type: "kpi", title: "Median days to SRN", metric: { agg: "median", field: "days_to_srn", format: "days" }, good: "down", secondary: { metric: { agg: "avg", field: "days_to_srn", format: "days" }, label: "average" } },
    { id: "kpi_old", type: "kpi", title: "SRN after 90 days", metric: lines(OVER_90), good: "down", onClick: OVER_90, secondary: { metric: { agg: "rate", numerator: OVER_90, denominator: DATED, format: "percent" }, label: "of dated lines" } },
    { id: "kpi_awaiting", type: "kpi", title: "Awaiting SRN number", metric: lines(AWAITING), good: "down", onClick: AWAITING, secondary: { metric: aed("srn_aed", AWAITING), label: "value" } },
    { id: "kpi_gap", type: "kpi", title: "SRN differs from invoice", metric: lines(BEYOND_VAT), good: "down", onClick: BEYOND_VAT, secondary: { metric: aed("gap_aed", BEYOND_VAT), label: "net gap" } },
    { id: "monthly", type: "bar", title: "SRN value by month", subtitle: "By SRN date; the earlier lines of the sheet carry no SRN date", dimension: "srn_month", metric: aed("srn_aed"), sort: "date", colorBy: "single", orientation: "vertical" },
    { id: "vendors", type: "bar", title: "Vendors", subtitle: "SRN value in AED, the ten largest", dimension: "vendor", metric: aed("srn_aed"), orientation: "horizontal", topN: 10, colorBy: "single" },
    { id: "age", type: "bar", title: "How old the invoice was at SRN", subtitle: "Lines by days from invoice date to SRN date", dimension: "age_band", metric: lines(), sort: "order", orientation: "horizontal", colorBy: "single" },
    { id: "checks", type: "bar", title: "Invoice against SRN", subtitle: "Lines by how the SRN compares with the invoice", dimension: "check", metric: lines(), sort: "order", orientation: "horizontal", colorBy: "single" },
  ], grid: [
    { i: "insights", x: 0, y: 0, w: 12, h: 2, minH: 2 },
    { i: "kpi_value", x: 0, y: 2, w: 2, h: 3 }, { i: "kpi_vendors", x: 2, y: 2, w: 2, h: 3 }, { i: "kpi_days", x: 4, y: 2, w: 2, h: 3 },
    { i: "kpi_old", x: 6, y: 2, w: 2, h: 3 }, { i: "kpi_awaiting", x: 8, y: 2, w: 2, h: 3 }, { i: "kpi_gap", x: 10, y: 2, w: 2, h: 3 },
    { i: "monthly", x: 0, y: 5, w: 6, h: 9 }, { i: "vendors", x: 6, y: 5, w: 6, h: 9 },
    { i: "age", x: 0, y: 14, w: 6, h: 7 }, { i: "checks", x: 6, y: 14, w: 6, h: 7 },
  ] };

  const vendors: Page = { id: "vendors", title: "Vendors", widgets: [
    byVendor({ id: "vendor_table", title: "Vendor by vendor", subtitle: "SRN value in AED, invoice value counted once per invoice, average days from invoice to SRN", columns: ["vendor", "lines", "invoice_aed", "srn_aed", "vat_gap_aed", "gap_aed", "days_to_srn"], sort: { field: "srn_aed", dir: "desc" }, pageSize: 30 }),
    { id: "vendor_days", type: "bar", title: "Average days to SRN by vendor", subtitle: "Lines with both an invoice date and an SRN date", dimension: "vendor", metric: { agg: "avg", field: "days_to_srn", format: "days" }, orientation: "horizontal", topN: 15, colorBy: "single", share: false },
    { id: "currency", type: "bar", title: "Currencies", subtitle: "SRN value in AED by invoice currency", dimension: "currency", metric: aed("srn_aed"), sort: "order", orientation: "horizontal", colorBy: "single" },
  ], grid: [{ i: "vendor_table", x: 0, y: 0, w: 12, h: 14 }, { i: "vendor_days", x: 0, y: 14, w: 7, h: 12 }, { i: "currency", x: 7, y: 14, w: 5, h: 6 }] };

  const timing: Page = { id: "timing", title: "Processing time", widgets: [
    { id: "age_month", type: "bar", title: "Invoice age at SRN, by SRN month", subtitle: "Lines by SRN month and how old the invoice was", dimension: "srn_month", metric: lines(DATED), stackBy: "age_band", sort: "date", orientation: "vertical", colorBy: "categorical" },
    { id: "median_month", type: "bar", title: "Median days to SRN, by SRN month", subtitle: "Is the wait getting shorter? Half the lines took longer than this", dimension: "srn_month", metric: { agg: "median", field: "days_to_srn", format: "days" }, sort: "date", orientation: "vertical", colorBy: "single", share: false },
    table({ id: "slowest", title: "Slowest twenty", subtitle: "Lines with the longest wait from invoice to SRN", columns: lineCols, sort: { field: "days_to_srn", dir: "desc" }, filter: DATED, limit: 20, pageSize: 20, emphasisField: "days_to_srn" }),
  ], grid: [{ i: "age_month", x: 0, y: 0, w: 6, h: 8 }, { i: "median_month", x: 6, y: 0, w: 6, h: 8 }, { i: "slowest", x: 0, y: 8, w: 12, h: 14 }] };

  const checks: Page = { id: "checks", title: "Checks", widgets: [
    { id: "followup", type: "auxTable", title: "What to follow up", subtitle: "Every check run on the sheet, with the lines and value involved", sheet: "followup", columns: ["check", "lines", "value_aed", "note"], rowLabel: "checks", pageSize: 20 },
    table({ id: "awaiting", title: "Awaiting an SRN number", subtitle: "Typed in the sheet with no SRN number yet", columns: lineCols.filter((c) => c !== "check"), filter: AWAITING, sort: { field: "srn_aed", dir: "desc" }, pageSize: 15 }),
    table({ id: "gaps", title: "SRN differs from the invoice beyond VAT", subtitle: "Positive gap: SRN below the invoice; negative: SRN above it", columns: ["line", "vendor", "po", "invoice_no", "currency", "invoice_amount", "srn_amount", "gap_aed", "check"], filter: BEYOND_VAT, sort: { field: "gap_aed", dir: "asc" }, pageSize: 15 }),
    { id: "currencies", type: "auxTable", title: "How AED values are worked out", subtitle: "Amounts stay in the invoice currency in the sheet; converted at these rates", sheet: "currencies", columns: ["currency", "lines", "srn_amount", "rate", "srn_aed", "note"], rowLabel: "currencies", pageSize: 10 },
    { id: "po_balance", type: "auxTable", title: "PO balance kept in the sheet", subtitle: "POs with an amount and running balance typed in the sheet, against the SRNs posted on them", sheet: "po_balance", columns: ["po", "vendor", "po_amount", "srn_total", "balance_sheet", "balance_check", "note"], rowLabel: "POs", pageSize: 10 },
  ], grid: [
    { i: "followup", x: 0, y: 0, w: 12, h: 12 }, { i: "awaiting", x: 0, y: 12, w: 12, h: 12 }, { i: "gaps", x: 0, y: 24, w: 12, h: 6 },
    { i: "currencies", x: 0, y: 30, w: 12, h: 6 }, { i: "po_balance", x: 0, y: 36, w: 12, h: 4 },
  ] };

  const register: Page = { id: "register", title: "Register", widgets: [
    table({ id: "register", title: "All SRN lines", columns: [...lineCols.slice(0, 7), "bl", "currency", "invoice_amount", "srn_amount", "srn_no", "srn_aed", "check", "status"], sort: { field: "srn_date", dir: "desc" }, search: true, pageSize: 50 }),
  ], grid: [{ i: "register", x: 0, y: 0, w: 12, h: 18 }] };
  const quality: Page = { id: "quality", title: "Data quality", widgets: [{ id: "quality", type: "quality", title: "Data quality" }], grid: [{ i: "quality", x: 0, y: 0, w: 12, h: 16 }] };

  return {
    version: 1, dateField: "srn_date", pages: [overview, vendors, timing, checks, register, quality],
    filters: [
      { kind: "daterange", field: "srn_date", label: "SRN date" },
      { kind: "select", field: "vendor", label: "Vendor" },
      { kind: "select", field: "currency", label: "Currency" },
      { kind: "select", field: "check", label: "Invoice vs SRN" },
      { kind: "select", field: "status", label: "Status" },
      { kind: "search", field: "invoice_no", label: "Search" },
    ],
  };
}

const fmt = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Follow-up list, currency conversion and PO balance, from the cleaned lines. */
export function srnAux(wb: ParsedWorkbook): Record<string, AuxSheet> {
  const sheet = wb.sheets.find((s) => s.name === SRN_SHEET);
  const source = wb.sheets.find((s) => s.name !== SRN_SHEET && srnColumns(s));
  if (!sheet || !source) return {};
  const ls = readLines(source, srnColumns(source)!);
  const rateOf = (l: Line) => RATES[l.currency ?? "AED"] ?? 0;
  const val = (xs: Line[], f: (l: Line) => number) => Math.round(xs.reduce((a, l) => a + f(l) * rateOf(l), 0));
  const out: Record<string, ColumnValue>[] = [];
  const add = (check: string, xs: Line[], value: number | null, note: string) => { if (xs.length) out.push({ check, lines: xs.length, value_aed: value, note }); };

  const awaiting = ls.filter((l) => !l.srnNo);
  add("Awaiting an SRN number", awaiting, val(awaiting, (l) => l.srnAmt ?? 0), `${[...new Set(awaiting.map((l) => l.vendor))].join(", ")}. Typed with an SRN amount but no SRN number.`);
  const above = ls.filter((l) => l.check === "SRN above invoice"), below = ls.filter((l) => l.check === "SRN below invoice");
  add("SRN above the invoice", above, val(above, (l) => -l.otherGap), "SRN posted for more than the invoice amount: check before payment.");
  add("SRN below the invoice beyond VAT", below, val(below, (l) => l.otherGap), "Part of the invoice not received in an SRN: a deduction, or a top-up still to post.");
  const missing = ls.filter((l) => l.check === "SRN amount missing");
  add("SRN number without an SRN amount", missing, val(missing, (l) => l.counted ?? 0), "The invoice amount is shown as the value.");
  const noInvoice = ls.filter((l) => l.check === "No invoice amount");
  add("No invoice amount typed", noInvoice, val(noInvoice, (l) => l.srnAmt ?? 0), "The SRN cannot be checked against the invoice; the SRN value is shown.");
  const bySrn = new Map<string, Set<string>>();
  for (const l of ls) if (l.srnNo && l.invNo) bySrn.set(l.srnNo, (bySrn.get(l.srnNo) ?? new Set()).add(l.invNo));
  const reused = [...bySrn.entries()].filter(([, s]) => s.size > 1);
  const reusedLines = ls.filter((l) => l.srnNo && reused.some(([k]) => k === l.srnNo));
  add("One SRN number on two invoices", reusedLines, val(reusedLines, (l) => l.srnAmt ?? 0), reused.map(([k, s]) => `SRN ${k}: ${[...s].join(" and ")}`).join("; ") + ". One SRN for two invoices, or a number copied by mistake.");
  const after = ls.filter((l) => l.invDate !== null && l.srnDate !== null && l.invDate > l.srnDate);
  add("Invoice date after its SRN date", after, null, "Left as typed: day and month could not be swapped to fit.");
  const old = ls.filter((l) => l.invDate !== null && l.srnDate !== null && (l.srnDate - l.invDate) / DAY > 180);
  add("SRN more than 180 days after the invoice", old, val(old, (l) => l.srnAmt ?? 0), `${[...new Set(old.map((l) => l.vendor))].length} vendors.`);
  const assumed = ls.filter((l) => l.notes.some((n) => n.field === "currency"));
  add("No currency typed", assumed, val(assumed, (l) => l.srnAmt ?? 0), "Currency taken from the invoice's other line or the vendor's usual one (AED for UAE vendors).");
  const undated = ls.filter((l) => l.srnDate === null);
  add("No SRN date", undated, val(undated, (l) => l.srnAmt ?? 0), "The earlier part of the sheet: counted in every total, left out of monthly and timing views.");
  const fixedDates = ls.filter((l) => l.notes.some((n) => n.field === "invoice_date"));
  add("Invoice date corrected", fixedDates, null, fixedDates.map((l) => l.notes.filter((n) => n.field === "invoice_date").map((n) => `${n.from} → ${n.to}`).join(", ")).join("; ") + ".");

  const cur = new Map<string, Line[]>();
  for (const l of ls) cur.set(l.currency ?? "AED", [...(cur.get(l.currency ?? "AED") ?? []), l]);
  const currencies = [...cur.entries()].sort((a, b) => b[1].length - a[1].length).map(([c, xs]) => ({
    currency: c, lines: xs.length, srn_amount: Math.round(xs.reduce((a, l) => a + (l.srnAmt ?? 0), 0)), rate: RATES[c] ?? null, srn_aed: RATES[c] ? val(xs, (l) => l.srnAmt ?? 0) : null,
    note: c === "USD" ? "Pegged rate." : c === "SAR" ? "Pegged rate (3.6725 / 3.75)." : c === "EUR" ? "Average rate: EUR is not pegged, so this is approximate." : c === "AED" ? `${xs.filter((l) => l.notes.some((n) => n.field === "currency")).length} of these lines had no currency typed.` : "No rate: left out of AED totals.",
  }));

  const pos = new Map<string, Line[]>();
  for (const l of ls) if (l.po) pos.set(l.po, [...(pos.get(l.po) ?? []), l]);
  const poRows = [...pos.entries()].filter(([, xs]) => xs.some((l) => l.poAmount !== null)).map(([po, xs]) => {
    const amount = xs.find((l) => l.poAmount !== null)!.poAmount!;
    const srnTotal = round2(xs.reduce((a, l) => a + (l.srnAmt ?? 0), 0));
    const last = [...xs].reverse().find((l) => l.balance !== null)?.balance ?? null;
    const check = round2(amount - srnTotal);
    return { po, vendor: xs[0].vendor, po_amount: amount, srn_total: srnTotal, balance_sheet: last, balance_check: check, note: last === null ? "No balance typed." : Math.abs(last - check) < 1 ? "Balance agrees with the SRNs." : `The sheet's last balance differs by ${fmt(last - check)} from PO amount less SRNs.` };
  });

  const t = (id: string, label: string, type: "string" | "number", format?: "integer" | "currency" | "decimal") => ({ id, label, type, ...(format ? { format } : {}) });
  return {
    followup: { id: "followup", label: "What to follow up", columns: [t("check", "Check", "string"), t("lines", "Lines", "number", "integer"), t("value_aed", "Value (AED)", "number", "currency"), { ...t("note", "Note", "string"), wrap: true }], rows: out },
    currencies: { id: "currencies", label: "Currencies", columns: [t("currency", "Currency", "string"), t("lines", "Lines", "number", "integer"), t("srn_amount", "SRN amount", "number", "integer"), t("rate", "Rate to AED", "number", "decimal"), t("srn_aed", "SRN value (AED)", "number", "currency"), { ...t("note", "Note", "string"), wrap: true }], rows: currencies },
    po_balance: { id: "po_balance", label: "PO balance", columns: [t("po", "PO", "string"), t("vendor", "Vendor", "string"), t("po_amount", "PO amount", "number", "currency"), t("srn_total", "SRNs on the PO", "number", "currency"), t("balance_sheet", "Balance in the sheet", "number", "currency"), t("balance_check", "PO amount less SRNs", "number", "currency"), { ...t("note", "Note", "string"), wrap: true }], rows: poRows },
  };
}

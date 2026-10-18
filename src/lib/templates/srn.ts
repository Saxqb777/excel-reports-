import type { AuxSheet, ColumnValue, Field, FilterExpr, ParsedSheet, ParsedWorkbook, RawCell, RawRow, SchemaMap } from "@/lib/schema/types";
import { normKey } from "@/lib/schema/types";
import { parseLooseDate } from "@/lib/excel/parse";
import type { Layout, Page, Widget } from "@/lib/dashboard/types";
import type { MetricSpec } from "@/lib/engine/metrics";

/**
 * SRN log: the sheet a logistics accounts coordinator keeps of every vendor invoice (shipping lines, transporters,
 * customs, terminals, clearance agents) and the service receipt note (SRN) posted for it in the ERP against a PO.
 * One row = one SRN posting, or a part of an invoice typed with its amount but no SRN number yet. Matched by headers.
 *
 * How the sheet works, and what the cleaning keeps true:
 * - The SRN amount is net of VAT. Vendors that charge 5% VAT show invoice = SRN × 1.05 (or VAT on part of the
 *   invoice); customs duties, terminals and foreign-currency lines show SRN = invoice. So the comparison is per
 *   invoice: invoice amount = SRN posted + SRN pending + VAT not receipted + anything left (a real gap).
 * - A large invoice is posted in parts, often on different POs when one runs out: the amount is typed once and the
 *   other lines carry only their SRN. A line with no invoice number right under a line of the same vendor is a part of
 *   that invoice. The invoice total is the amount typed (the largest when they differ), or the sum when the parts each
 *   carry their own amount and those add up to the SRNs.
 * - The PO amount and running balance are typed for one PO; the balance is recomputed for every PO that has an amount.
 * - SRN dates were only typed from a point in the sheet; SRN numbers are the ERP's sequence, so an undated line is
 *   placed "Before <first dated day>" when its number is lower than every dated one, or in the month whose dated SRN
 *   numbers surround it ("by SRN sequence"). The date source is kept as a column.
 * - Currency: the line's, else the invoice's other line, else the vendor's usual one, else AED; converted at fixed
 *   rates (USD and SAR are pegged; EUR is an average). Every assumption is a note on the line and on Data quality.
 * - Invoice amounts that are a formula copying the SRN amount are marked: they are not an independent check.
 */

export const SRN_SHEET = "SRN lines";
export const RATES: Record<string, number> = { AED: 1, USD: 3.6725, SAR: 3.6725 / 3.75, EUR: 4.28 };
const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const HEADERS = [
  "Line", "SRN date", "Vendor", "PO number", "Invoice number", "Invoice date", "BL / reference", "Currency", "Invoice amount", "SRN amount", "SRN number",
  "Status", "Period", "Date source", "Invoice value (AED)", "SRN receipted (AED)", "SRN posted (AED)", "SRN pending (AED)", "VAT not in SRN (AED)", "Gap beyond VAT (AED)",
  "Invoice vs SRN", "Invoice posting", "Invoice has an amount", "Invoice amount source", "Pending since", "PO and vendor", "Invoice count", "POs on the invoice",
  "Invoice also on PO", "How the invoice was posted", "PO has an amount", "PO amount (AED)", "PO balance after this SRN (AED)", "PO balance left (AED)",
  "Vendors on the BL", "SRN number also on", "Corrections",
];

const CHECKS = ["Matches", "Matches (invoice copied from SRN)", "VAT on all (5%)", "VAT on part (under 5%)", "SRN below invoice", "SRN above invoice", "SRN amount missing", "Amount typed for part only", "No invoice amount"];
const POSTINGS = ["Posted", "Partly posted", "Not posted"];
const PATTERNS = ["One SRN, one PO", "One SRN in parts", "Finished by a later SRN", "One SRN over several POs", "Several SRNs over several POs", "Part still awaiting an SRN", "Awaiting an SRN"];
const DATE_SOURCES = ["Typed", "By SRN sequence", "Before dating began", "Not dated"];
const AGE = ["Within 30 days", "31–60 days", "61–90 days", "91–180 days", "Over 180 days"];

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
  return ["line", "srn number", "srn receipted (aed)", "invoice vs srn"].every((k) => headers.some((h) => normKey(h) === k));
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
const monthOf = (t: number) => { const d = new Date(t); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const dayOf = (t: number) => { const d = new Date(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

type Note = { field: string; from: string; to: string; reason: string };
interface Line {
  row: number; srnDate: number | null; vendor: string; po: string | null; invNo: string | null; invDate: number | null; bl: string | null;
  currency: string | null; invAmt: number | null; invFormula: boolean; srnAmt: number | null; srnNo: string | null; srnSeq: number | null;
  poAmount: number | null; balance: number | null; notes: Note[];
}
/** What the invoice's lines add up to; held once per invoice. */
interface Invoice {
  key: string; lines: Line[]; total: number | null; posted: number; pending: number; vat: number; gap: number; check: string; posting: string;
  pattern: string; pos: string[]; copied: boolean; pendingSince: number | null;
}

function readLines(sheet: ParsedSheet, c: Cols): Line[] {
  const out: Line[] = [];
  for (const r of sheet.rows) {
    const cell = (h?: string): RawCell => (h ? r.cells[h] ?? null : null);
    const vendor = text(cell(c.vendor));
    const srnAmt = num(cell(c.srnAmt)), invAmt = num(cell(c.invAmt));
    if (!vendor && srnAmt === null && invAmt === null) continue;
    const srnRaw = ref(cell(c.srnNo))?.replace(/[^0-9A-Z-]/g, "") || null;
    const line: Line = {
      row: r.row, srnDate: toMs(cell(c.srnDate)), vendor: vendor ?? "Not set", po: ref(cell(c.po)), invNo: ref(cell(c.invNo)), invDate: toMs(cell(c.invDate)), bl: text(cell(c.bl)),
      currency: text(cell(c.currency))?.toUpperCase() ?? null, invAmt, invFormula: !!(c.invAmt && r.formulas?.[c.invAmt]), srnAmt, srnNo: srnRaw,
      srnSeq: srnRaw && /^\d{10}$/.test(srnRaw) ? Number(srnRaw) : null, poAmount: num(cell(c.poAmount)), balance: num(cell(c.balance)), notes: [],
    };
    if (line.srnNo && !/^\d{10}$/.test(line.srnNo)) line.notes.push({ field: "srn_no", from: line.srnNo, to: line.srnNo, reason: `SRN number has ${line.srnNo.length} characters; ERP SRN numbers have 10 digits. Kept as typed` });
    if (line.po && !/^\d{10}$/.test(line.po)) line.notes.push({ field: "po", from: line.po, to: line.po, reason: line.po === line.invNo ? "The invoice number was typed in the PO column. Kept as typed" : "Not a 10-digit PO number. Kept as typed" });
    // A part of an invoice typed without its number belongs to the invoice on the line above (same vendor).
    const prev = out[out.length - 1];
    if (!line.invNo && prev && prev.vendor === line.vendor && prev.invNo) {
      line.invNo = prev.invNo;
      line.notes.push({ field: "invoice_no", from: "(blank)", to: prev.invNo, reason: "Invoice number taken from the line above (same vendor: a part of that invoice, usually on another PO)" });
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
  // Currency: the line's, else the same invoice's other line, else the vendor's usual one, else AED.
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
  return out;
}

const invoiceKey = (l: Line, i: number) => (l.invNo ? `${l.vendor}|${l.invNo}` : `row|${i}`);

/** One record per invoice: its lines, what they add up to, and how the SRNs compare with the invoice amount. */
function invoices(lines: Line[]): Map<string, Invoice> {
  const groups = new Map<string, Line[]>();
  lines.forEach((l, i) => { const k = invoiceKey(l, i); groups.set(k, [...(groups.get(k) ?? []), l]); });
  const out = new Map<string, Invoice>();
  for (const [key, g] of groups) {
    const amounts = g.map((l) => l.invAmt).filter((v): v is number => v !== null && v > 0);
    const posted = round2(g.reduce((a, l) => a + (l.srnNo ? l.srnAmt ?? 0 : 0), 0));
    const pending = round2(g.reduce((a, l) => a + (!l.srnNo ? l.srnAmt ?? 0 : 0), 0));
    const receipted = posted + pending;
    // The amount is typed once (or repeated); when the parts each carry their own amount and those add up to the
    // SRNs better than the largest does, the total is their sum.
    let total: number | null = amounts.length ? Math.max(...amounts) : null;
    if (total !== null && amounts.length > 1 && !amounts.every((a) => a === amounts[0])) {
      const sum = round2(amounts.reduce((a, b) => a + b, 0));
      if (Math.abs(sum - receipted) < Math.abs(total - receipted)) total = sum;
    }
    const copied = amounts.length > 0 && g.filter((l) => l.invAmt !== null && l.invAmt > 0).every((l) => l.invFormula);
    // When some parts carry an amount that is just their own SRN (or that plus VAT) and other parts carry none, the
    // amounts were typed per part: the invoice total is not known, only those parts can be checked.
    const withAmt = g.filter((l) => l.invAmt !== null && l.invAmt > 0);
    const ownPart = (l: Line) => l.srnAmt !== null && (Math.abs(l.invAmt! - l.srnAmt) <= 0.5 || ((l.currency ?? "AED") === "AED" && Math.abs(l.invAmt! - l.srnAmt * 1.05) <= 1));
    const partOnly = g.length > 1 && withAmt.length > 0 && withAmt.length < g.length && withAmt.every(ownPart) && Math.abs(receipted - (total ?? 0)) > 0.5;
    if (partOnly) total = round2(withAmt.reduce((a, l) => a + l.invAmt!, 0));
    let check: string, vat = 0, gap = 0;
    if (total === null) check = "No invoice amount";
    else if (partOnly) check = "Amount typed for part only";
    else if (g.some((l) => l.srnNo && l.srnAmt === null)) check = "SRN amount missing";
    else {
      const diff = round2(total - receipted);
      // UAE VAT (5%) is only ever the explanation on an AED invoice; a shortfall on a foreign-currency invoice is a gap.
      const uae = g.every((l) => (l.currency ?? "AED") === "AED");
      if (Math.abs(diff) <= 0.5) check = copied ? "Matches (invoice copied from SRN)" : "Matches";
      else if (uae && Math.abs(total - receipted * 1.05) <= 1) { check = "VAT on all (5%)"; vat = diff; }
      else if (uae && diff > 0 && diff <= (total * 5) / 105 + 0.5) { check = "VAT on part (under 5%)"; vat = diff; }
      else { check = diff > 0 ? "SRN below invoice" : "SRN above invoice"; gap = diff; }
    }
    const withNo = g.filter((l) => l.srnNo).length;
    const posting = withNo === g.length ? "Posted" : withNo === 0 ? "Not posted" : "Partly posted";
    const pos = [...new Set(g.map((l) => l.po).filter((p): p is string => !!p))];
    const srns = new Set(g.map((l) => l.srnNo).filter(Boolean)).size;
    const pattern = withNo === 0 ? PATTERNS[6] : withNo < g.length ? PATTERNS[5] : pos.length > 1 ? (srns > 1 ? PATTERNS[4] : PATTERNS[3]) : srns > 1 ? PATTERNS[2] : g.length > 1 ? PATTERNS[1] : PATTERNS[0];
    const latestSrn = g.reduce<number | null>((a, l) => (l.srnNo && l.srnDate !== null && (a === null || l.srnDate > a) ? l.srnDate : a), null);
    const invDate = g.reduce<number | null>((a, l) => (l.invDate !== null && (a === null || l.invDate < a) ? l.invDate : a), null);
    out.set(key, { key, lines: g, total, posted, pending, vat, gap, check, posting, pattern, pos, copied, pendingSince: pending > 0 || withNo < g.length ? invDate ?? latestSrn : null });
  }
  return out;
}

/** The month an undated line belongs to, from where its SRN number sits among the dated ones. */
function periodOf(lines: Line[]): (l: Line) => { period: string | null; source: string } {
  const dated = lines.filter((l) => l.srnDate !== null && l.srnSeq !== null);
  const firstSeq = dated.length ? Math.min(...dated.map((l) => l.srnSeq!)) : null;
  const firstDay = dated.length ? Math.min(...dated.map((l) => l.srnDate!)) : null;
  const bands = new Map<string, { lo: number; hi: number }>();
  for (const l of dated) {
    const m = monthOf(l.srnDate!);
    const b = bands.get(m) ?? { lo: l.srnSeq!, hi: l.srnSeq! };
    bands.set(m, { lo: Math.min(b.lo, l.srnSeq!), hi: Math.max(b.hi, l.srnSeq!) });
  }
  const ordered = [...bands.entries()].sort((a, b) => a[1].lo - b[1].lo);
  return (l) => {
    if (l.srnDate !== null) return { period: monthOf(l.srnDate), source: "Typed" };
    if (l.srnSeq === null || firstSeq === null) return { period: null, source: "Not dated" };
    if (l.srnSeq < firstSeq) return { period: `Before ${dayOf(firstDay!)}`, source: "Before dating began" };
    let month = ordered[0][0];
    for (const [m, b] of ordered) if (l.srnSeq >= b.lo) month = m;
    return { period: month, source: "By SRN sequence" };
  };
}

/** Replaces the SRN sheet with one clean line per SRN line, ahead of the other sheets. */
export function prepareSrnWorkbook(wb: ParsedWorkbook): ParsedWorkbook {
  if (wb.sheets.some((s) => s.name === SRN_SHEET)) return wb;
  const source = wb.sheets.find((s) => srnColumns(s));
  if (!source) return wb;
  const lines = readLines(source, srnColumns(source)!);
  const invs = invoices(lines);
  const period = periodOf(lines);
  const keys = new Map<string, number>();
  const base = lines.map((l) => (l.srnNo ? `SRN ${l.srnNo}` : `Invoice ${l.invNo ?? `row ${l.row}`}`));
  const shared = new Map<string, number>();
  for (const b of base) shared.set(b, (shared.get(b) ?? 0) + 1);
  // PO amount typed once per PO; the running balance deducts every SRN amount on the PO in sheet order, as the sheet does.
  const poAmount = new Map<string, number>();
  for (const l of lines) if (l.po && l.poAmount !== null && !poAmount.has(l.po)) poAmount.set(l.po, l.poAmount);
  const running = new Map<Line, number>(), poFirst = new Set<Line>(), poLast = new Map<string, Line>(), spent = new Map<string, number>();
  for (const l of lines) {
    if (!l.po || !poAmount.has(l.po)) continue;
    if (!spent.has(l.po)) poFirst.add(l);
    spent.set(l.po, (spent.get(l.po) ?? 0) + (l.srnAmt ?? 0));
    running.set(l, round2((poAmount.get(l.po)! - spent.get(l.po)!) * (RATES[l.currency ?? "AED"] ?? 1)));
    poLast.set(l.po, l);
  }
  const blVendors = new Map<string, Set<string>>();
  for (const l of lines) if (l.bl) blVendors.set(l.bl.toUpperCase(), (blVendors.get(l.bl.toUpperCase()) ?? new Set()).add(l.vendor));
  const srnInvoices = new Map<string, Set<string>>();
  for (const l of lines) if (l.srnNo && l.invNo) srnInvoices.set(l.srnNo, (srnInvoices.get(l.srnNo) ?? new Set()).add(l.invNo));

  const rows: RawRow[] = lines.map((l, i) => {
    let key = shared.get(base[i])! > 1 && l.po ? `${base[i]} · PO ${l.po}` : base[i];
    const k = (keys.get(key) ?? 0) + 1;
    keys.set(key, k);
    if (k > 1) key = `${key} (${k})`;
    const rate = RATES[l.currency ?? "AED"] ?? null;
    const aed = (v: number | null) => (v === null || rate === null ? null : round2(v * rate));
    const inv = invs.get(invoiceKey(l, i))!;
    const first = inv.lines[0] === l;
    const p = period(l);
    const others = l.srnNo ? [...(srnInvoices.get(l.srnNo) ?? [])].filter((x) => x !== l.invNo) : [];
    const cells: Record<string, RawCell> = {
      "Line": key, "SRN date": isoCell(l.srnDate), "Vendor": l.vendor, "PO number": l.po, "Invoice number": l.invNo, "Invoice date": isoCell(l.invDate), "BL / reference": l.bl,
      "Currency": l.currency, "Invoice amount": l.invAmt, "SRN amount": l.srnAmt, "SRN number": l.srnNo,
      "Status": l.srnNo ? "SRN posted" : "Awaiting SRN number", "Period": p.period, "Date source": p.source,
      "Invoice value (AED)": first ? aed(inv.total) : null, "SRN receipted (AED)": aed(l.srnAmt), "SRN posted (AED)": l.srnNo ? aed(l.srnAmt) : null, "SRN pending (AED)": l.srnNo ? null : aed(l.srnAmt),
      "VAT not in SRN (AED)": first && inv.vat ? aed(inv.vat) : null, "Gap beyond VAT (AED)": first && inv.gap ? aed(inv.gap) : null,
      "Invoice vs SRN": inv.check, "Invoice posting": inv.posting, "Invoice has an amount": inv.total !== null ? "Yes" : "No",
      "Invoice amount source": l.invAmt === null ? null : l.invFormula ? "Formula copying the SRN" : "Typed",
      "Pending since": l.srnNo ? null : isoCell(inv.pendingSince),
      "PO and vendor": l.po ? `${l.po} · ${l.vendor}` : null, "Invoice count": first ? 1 : 0, "POs on the invoice": inv.pos.length || null,
      "Invoice also on PO": inv.pos.filter((x) => x !== l.po).join(", ") || null, "How the invoice was posted": inv.pattern,
      "PO has an amount": l.po && poAmount.has(l.po) ? "Yes" : "No", "PO amount (AED)": poFirst.has(l) ? aed(poAmount.get(l.po!)!) : null,
      "PO balance after this SRN (AED)": running.get(l) ?? null, "PO balance left (AED)": l.po && poLast.get(l.po) === l ? running.get(l)! : null,
      "Vendors on the BL": l.bl ? blVendors.get(l.bl.toUpperCase())!.size : null, "SRN number also on": others.length ? others.join(", ") : null,
      "Corrections": l.notes.length ? JSON.stringify(l.notes) : null,
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

type Spec = Partial<Field> & { id: string; label: string; type: Field["type"]; role: Field["role"] };
const money = (id: string, label: string, extra: Partial<Field> = {}): Spec => ({ id, label, type: "number", role: "measure", format: "currency", currency: "AED", ...extra });
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
  "Status": { id: "status", label: "Status", type: "string", role: "dimension", semantic: "status", order: ["SRN posted", "Awaiting SRN number"] },
  "Period": { id: "period", label: "Period", type: "string", role: "dimension" },
  "Date source": { id: "date_source", label: "Date source", type: "string", role: "dimension", order: DATE_SOURCES },
  "Invoice value (AED)": money("invoice_aed", "Invoice value (AED)", { semantic: "amount" }),
  "SRN receipted (AED)": money("srn_aed", "SRN receipted (AED)", { semantic: "amount" }),
  "SRN posted (AED)": money("srn_posted_aed", "SRN posted (AED)"),
  "SRN pending (AED)": money("srn_pending_aed", "SRN pending (AED)"),
  "VAT not in SRN (AED)": money("vat_gap_aed", "VAT not in SRN (AED)"),
  "Gap beyond VAT (AED)": money("gap_aed", "Gap beyond VAT (AED)"),
  "Invoice vs SRN": { id: "check", label: "Invoice vs SRN", type: "string", role: "dimension", order: CHECKS },
  "Invoice posting": { id: "posting", label: "Invoice posting", type: "string", role: "dimension", order: POSTINGS },
  "Invoice has an amount": { id: "inv_known", label: "Invoice amount typed", type: "string", role: "dimension", order: ["Yes", "No"], hidden: true },
  "Invoice amount source": { id: "inv_source", label: "Invoice amount source", type: "string", role: "dimension", order: ["Typed", "Formula copying the SRN"], hidden: true },
  "Pending since": { id: "pending_since", label: "Pending since", type: "date", role: "date", format: "date", hidden: true },
  "PO and vendor": { id: "po_label", label: "PO", type: "string", role: "dimension", hidden: true },
  "Invoice count": { id: "invoices", label: "Invoices", type: "number", role: "measure", format: "integer", aggregate: "sum", hidden: true },
  "POs on the invoice": { id: "po_count", label: "POs on the invoice", type: "number", role: "measure", format: "integer", aggregate: "max", hidden: true },
  "Invoice also on PO": { id: "other_pos", label: "Shares invoices with PO", type: "string", role: "text", hidden: true },
  "How the invoice was posted": { id: "pattern", label: "How the invoice was posted", type: "string", role: "dimension", order: PATTERNS },
  "PO has an amount": { id: "po_tracked", label: "PO amount typed", type: "string", role: "dimension", order: ["Yes", "No"], hidden: true },
  "PO amount (AED)": money("po_amount_aed", "PO amount (AED)", { aggregate: "sum", hidden: true }),
  "PO balance after this SRN (AED)": money("po_running", "PO balance after this SRN", { aggregate: "min", hidden: true }),
  "PO balance left (AED)": money("po_left", "PO balance left (AED)", { aggregate: "sum", hidden: true }),
  "Vendors on the BL": { id: "bl_vendors", label: "Vendors on the BL", type: "number", role: "measure", format: "integer", aggregate: "max", hidden: true },
  "SRN number also on": { id: "srn_reused", label: "SRN number also on invoice", type: "string", role: "text", hidden: true },
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
    { id: "pending_days", label: "Pending for (days)", source: null, type: "number", role: "measure", format: "days", aggregate: "max", derived: { kind: "ageDays", from: "pending_since", when: { field: "status", op: "eq", value: "Awaiting SRN number" } } },
    // Earliest and latest SRN date when lines are rolled up by PO, vendor or BL.
    { id: "first_srn", label: "First SRN", source: null, type: "date", role: "date", format: "date", hidden: true, derived: { kind: "coalesce", fields: ["srn_date"] } },
    { id: "last_srn", label: "Last SRN", source: null, type: "date", role: "date", format: "date", aggregate: "max", hidden: true, derived: { kind: "coalesce", fields: ["srn_date"] } },
    { id: "shipment_vendors", label: "Vendors on the shipment", source: null, type: "string", role: "dimension", order: ["One vendor", "Two vendors", "Three or more"],
      derived: { kind: "bucket", from: "bl_vendors", edges: [2, 3], labels: ["One vendor", "Two vendors", "Three or more"] } },
  );
  return { ...inferred, sheet: SRN_SHEET, fields, idField: "line", primaryDate: "srn_date", noteField: "notes", foldCase: true };
}

const is = (field: string, value: string): FilterExpr => ({ field, op: "eq", value });
const AWAITING = is("status", "Awaiting SRN number");
const POSTED = is("status", "SRN posted");
const KNOWN = is("inv_known", "Yes");
const UNKNOWN = is("inv_known", "No");
const REAL_GAP: FilterExpr = { field: "check", op: "in", value: ["SRN below invoice", "SRN above invoice"] };
const DATED: FilterExpr = { field: "days_to_srn", op: "notNull" };
const OVER_90: FilterExpr = { field: "days_to_srn", op: "gt", value: 90 };
const TRACKED = is("po_tracked", "Yes");
const SPLIT: FilterExpr = { field: "po_count", op: "gt", value: 1 };
const REUSED: FilterExpr = { field: "srn_reused", op: "notNull" };
const HAS_BL: FilterExpr = { field: "bl", op: "notNull" };
const NO_BL: FilterExpr = { field: "bl", op: "isNull" };
const MULTI: FilterExpr = { field: "bl_vendors", op: "gt", value: 1 };
const aed = (field: string, filter?: FilterExpr): MetricSpec => ({ agg: "sum", field, format: "currency", currency: "AED", ...(filter ? { filter } : {}) });
const lines = (filter?: FilterExpr): MetricSpec => ({ agg: "count", ...(filter ? { filter } : {}) });
const invoicesOf = (filter?: FilterExpr): MetricSpec => ({ agg: "distinct", field: "invoice_no", ...(filter ? { filter } : {}) });

export function srnLayout(): Layout {
  const table = (w: Omit<Extract<Widget, { type: "table" }>, "type">): Widget => ({ type: "table", rowLabel: "lines", statusField: "status", ...w });
  const lineCols = ["line", "vendor", "po", "invoice_no", "invoice_date", "srn_date", "days_to_srn", "currency", "srn_aed", "check", "status"];

  const overview: Page = { id: "overview", title: "Overview", widgets: [
    { id: "insights", type: "insights", title: "What changed since the last update" },
    { id: "kpi_posted", type: "kpi", title: "SRN posted", metric: aed("srn_posted_aed"), good: "none", secondary: { metric: lines(POSTED), label: "lines with an SRN number" } },
    { id: "kpi_pending", type: "kpi", title: "Awaiting SRN number", metric: lines(AWAITING), good: "down", onClick: AWAITING, secondary: { metric: aed("srn_pending_aed"), label: "typed, not posted" } },
    { id: "kpi_invoice", type: "kpi", title: "Invoice value (where typed)", metric: aed("invoice_aed"), good: "none", secondary: { metric: invoicesOf(KNOWN), label: "invoices with an amount" } },
    { id: "kpi_cover", type: "kpi", title: "Receipted against invoice", metric: { agg: "ratio", field: "srn_aed", over: "invoice_aed", unpaired: true, filter: KNOWN, format: "percent", decimals: 1 }, good: "none", secondary: { metric: aed("vat_gap_aed"), label: "is VAT, not in the SRN" } },
    { id: "kpi_noinv", type: "kpi", title: "Invoices with no amount typed", metric: invoicesOf(UNKNOWN), good: "down", onClick: UNKNOWN, secondary: { metric: aed("srn_aed", UNKNOWN), label: "SRN value, cannot be checked" } },
    { id: "kpi_gap", type: "kpi", title: "Real gaps (beyond VAT)", metric: invoicesOf(REAL_GAP), good: "down", onClick: REAL_GAP, secondary: { metric: aed("gap_aed"), label: "net, positive = SRN short" } },
    { id: "kpi_vendors", type: "kpi", title: "Vendors", metric: { agg: "distinct", field: "vendor" }, good: "none", secondary: { metric: invoicesOf(), label: "invoices" } },
    { id: "kpi_pos", type: "kpi", title: "POs", metric: { agg: "distinct", field: "po" }, good: "none", secondary: { metric: { agg: "distinct", field: "po", filter: TRACKED }, label: "with amount" } },
    { id: "kpi_days", type: "kpi", title: "Median days invoice → SRN", metric: { agg: "median", field: "days_to_srn", format: "days" }, good: "down", secondary: { metric: { agg: "rate", numerator: OVER_90, denominator: DATED, format: "percent" }, label: "over 90 days" } },
    { id: "monthly", type: "bar", title: "SRN value by month", subtitle: "By SRN date. Dates were typed from 28 Jul 2026; earlier lines are placed by their SRN number", dimension: "period", metric: aed("srn_aed"), stackBy: "date_source", sort: "date", colorBy: "categorical", orientation: "vertical" },
    { id: "vendors", type: "bar", title: "Vendors", subtitle: "SRN receipted in AED, every vendor", dimension: "vendor", metric: aed("srn_aed"), orientation: "horizontal", colorBy: "single" },
    { id: "checks", type: "bar", title: "Invoice against SRN", subtitle: "Invoices by how their SRNs compare with the invoice amount", dimension: "check", metric: invoicesOf(), sort: "order", orientation: "horizontal", colorBy: "single" },
    { id: "currencies", type: "auxTable", title: "By currency", subtitle: "Amounts as typed, and the rate used for the AED figures", sheet: "currencies", columns: ["currency", "lines", "srn_amount", "rate", "srn_aed", "note"], rowLabel: "currencies", pageSize: 10 },
  ], grid: [
    { i: "insights", x: 0, y: 0, w: 12, h: 2, minH: 2 },
    { i: "kpi_posted", x: 0, y: 2, w: 3, h: 3 }, { i: "kpi_pending", x: 3, y: 2, w: 3, h: 3 }, { i: "kpi_invoice", x: 6, y: 2, w: 3, h: 3 }, { i: "kpi_cover", x: 9, y: 2, w: 3, h: 3 },
    { i: "kpi_noinv", x: 0, y: 5, w: 3, h: 3 }, { i: "kpi_gap", x: 3, y: 5, w: 3, h: 3 }, { i: "kpi_vendors", x: 6, y: 5, w: 2, h: 3 }, { i: "kpi_pos", x: 8, y: 5, w: 2, h: 3 }, { i: "kpi_days", x: 10, y: 5, w: 2, h: 3 },
    { i: "monthly", x: 0, y: 8, w: 6, h: 9 }, { i: "checks", x: 6, y: 8, w: 6, h: 9 },
    { i: "vendors", x: 0, y: 17, w: 6, h: 27 }, { i: "currencies", x: 6, y: 17, w: 6, h: 7 },
  ] };

  const byVendor = (w: Omit<Extract<Widget, { type: "table" }>, "type" | "groupBy" | "rowLabel">): Widget => ({ type: "table", groupBy: "vendor", rowLabel: "vendors", ...w });
  const vendors: Page = { id: "vendors", title: "Vendors", widgets: [
    byVendor({ id: "vendor_table", title: "Every vendor", subtitle: "Invoice value counted once per invoice; VAT and gaps per invoice; days from invoice date to SRN date on the lines that have both", columns: ["vendor", "invoices", "lines", "invoice_aed", "srn_posted_aed", "srn_pending_aed", "vat_gap_aed", "gap_aed", "days_to_srn"], sort: { field: "srn_posted_aed", dir: "desc" }, pageSize: 30 }),
    byVendor({ id: "vendor_noinv", title: "Invoices with no amount typed, by vendor", subtitle: "The SRN cannot be checked against the invoice until the amount is typed", filter: UNKNOWN, columns: ["vendor", "invoices", "lines", "srn_aed"], sort: { field: "srn_aed", dir: "desc" }, pageSize: 15 }),
    { id: "vendor_days", type: "bar", title: "Average days invoice → SRN by vendor", subtitle: "Lines with both dates", dimension: "vendor", metric: { agg: "avg", field: "days_to_srn", format: "days" }, orientation: "horizontal", colorBy: "single", share: false },
    { id: "vendor_cur", type: "bar", title: "Currency by vendor", subtitle: "Lines by invoice currency", dimension: "vendor", metric: lines(), stackBy: "currency", orientation: "horizontal", colorBy: "categorical", share: false },
  ], grid: [{ i: "vendor_table", x: 0, y: 0, w: 12, h: 30 }, { i: "vendor_noinv", x: 0, y: 30, w: 6, h: 11 }, { i: "vendor_days", x: 6, y: 30, w: 6, h: 14 }, { i: "vendor_cur", x: 0, y: 44, w: 12, h: 26 }] };

  const pos: Page = { id: "pos", title: "POs", widgets: [
    { id: "kpi_left", type: "kpi", title: "PO balance left", metric: aed("po_left"), good: "none", onClick: TRACKED, secondary: { metric: aed("po_amount_aed"), label: "PO amount typed" } },
    { id: "kpi_tracked", type: "kpi", title: "POs with an amount typed", metric: { agg: "distinct", field: "po", filter: TRACKED }, good: "up", onClick: TRACKED, secondary: { metric: { agg: "distinct", field: "po" }, label: "POs in the sheet" } },
    { id: "kpi_split", type: "kpi", title: "Invoices over more than one PO", metric: invoicesOf(SPLIT), good: "none", onClick: SPLIT, secondary: { metric: aed("srn_aed", SPLIT), label: "SRN value" } },
    { id: "kpi_vendor_pos", type: "kpi", title: "Vendors", metric: { agg: "distinct", field: "vendor" }, good: "none", secondary: { metric: { agg: "distinct", field: "po" }, label: "POs" } },
    { type: "table", id: "po_vs_srn", title: "PO balance against SRN value", subtitle: "POs with an amount typed: PO amount, SRN receipted on it (posted and pending), balance left", groupBy: "po", rowLabel: "POs", filter: TRACKED,
      columns: ["po", "vendor", "po_amount_aed", "srn_posted_aed", "srn_pending_aed", "po_left", "invoices", "first_srn", "last_srn"], sort: { field: "po_left", dir: "asc" }, pageSize: 10 },
    table({ id: "po_running", title: "Running PO balance, SRN by SRN", subtitle: "As the sheet's Balance column: the PO amount less each SRN in turn", columns: ["line", "po", "vendor", "invoice_no", "srn_no", "srn_date", "srn_aed", "po_running"], filter: TRACKED, sort: { field: "po_running", dir: "desc" }, pageSize: 15 }),
    { type: "table", id: "po_table", title: "PO register", subtitle: "One row per PO. A split invoice's amount sits on the PO that carries it", groupBy: "po", rowLabel: "POs",
      columns: ["po", "vendor", "invoices", "lines", "invoice_aed", "srn_posted_aed", "srn_pending_aed", "po_amount_aed", "po_left", "first_srn", "last_srn", "other_pos"], sort: { field: "srn_posted_aed", dir: "desc" }, search: true, pageSize: 20 },
    { id: "po_value", type: "bar", title: "SRN value by PO", subtitle: "The fifteen largest POs, in AED", dimension: "po_label", metric: aed("srn_aed"), orientation: "horizontal", topN: 15, colorBy: "single" },
    { id: "pattern", type: "bar", title: "How invoices were posted", subtitle: "Invoices by SRNs and POs used", dimension: "pattern", metric: invoicesOf(), sort: "order", orientation: "horizontal", colorBy: "single" },
    { id: "pos_vendor", type: "bar", title: "POs per vendor", dimension: "vendor", metric: { agg: "distinct", field: "po" }, orientation: "horizontal", topN: 12, colorBy: "single", share: false },
    table({ id: "split", title: "Invoices billed on more than one PO", subtitle: "A PO runs out: the rest of the invoice goes on the next PO", columns: ["line", "vendor", "invoice_no", "po", "srn_no", "invoice_amount", "srn_amount", "srn_aed", "pattern"], filter: SPLIT, sort: { field: "invoice_no", dir: "asc" }, pageSize: 15 }),
    { id: "po_balance", type: "auxTable", title: "Check against the sheet's Balance column", subtitle: "The last balance typed in the sheet against the PO amount less the SRNs posted on it", sheet: "po_balance", columns: ["po", "vendor", "po_amount", "srn_total", "balance_sheet", "balance_check", "note"], rowLabel: "POs", pageSize: 10 },
  ], grid: [
    { i: "kpi_left", x: 0, y: 0, w: 3, h: 3 }, { i: "kpi_tracked", x: 3, y: 0, w: 3, h: 3 }, { i: "kpi_split", x: 6, y: 0, w: 3, h: 3 }, { i: "kpi_vendor_pos", x: 9, y: 0, w: 3, h: 3 },
    { i: "po_vs_srn", x: 0, y: 3, w: 12, h: 4 }, { i: "po_running", x: 0, y: 7, w: 12, h: 12 }, { i: "po_table", x: 0, y: 19, w: 12, h: 14 },
    { i: "po_value", x: 0, y: 33, w: 7, h: 15 }, { i: "pattern", x: 7, y: 33, w: 5, h: 7 }, { i: "pos_vendor", x: 7, y: 40, w: 5, h: 8 },
    { i: "split", x: 0, y: 48, w: 12, h: 12 }, { i: "po_balance", x: 0, y: 60, w: 12, h: 4 },
  ] };

  const alerts: Page = { id: "alerts", title: "Alerts & reminders", widgets: [
    { id: "kpi_a_pending", type: "kpi", title: "Awaiting SRN number", metric: lines(AWAITING), good: "down", onClick: AWAITING, secondary: { metric: aed("srn_pending_aed"), label: "to post" } },
    { id: "kpi_a_gap", type: "kpi", title: "Invoices with a real gap", metric: invoicesOf(REAL_GAP), good: "down", onClick: REAL_GAP, secondary: { metric: aed("gap_aed"), label: "net, positive = SRN short" } },
    { id: "kpi_a_reused", type: "kpi", title: "SRN numbers on two invoices", metric: lines(REUSED), good: "down", onClick: REUSED, secondary: { metric: aed("srn_aed", REUSED), label: "lines involved" } },
    { id: "kpi_a_noinv", type: "kpi", title: "Invoices with no amount typed", metric: invoicesOf(UNKNOWN), good: "down", onClick: UNKNOWN, secondary: { metric: aed("srn_aed", UNKNOWN), label: "SRN value" } },
    { id: "alert_list", type: "auxTable", title: "Alerts and reminders", subtitle: "Act now: money or postings to settle. Check: something that looks wrong. Fill in: typing that would make the sheet complete", sheet: "alerts", columns: ["priority", "alert", "items", "value_aed", "action"], rowLabel: "alerts", pageSize: 30 },
    table({ id: "awaiting", title: "Awaiting an SRN number", subtitle: "Typed with an amount but no SRN number. Pending since the invoice date, else since the posted part", columns: ["line", "vendor", "po", "invoice_no", "invoice_date", "pending_days", "currency", "srn_amount", "srn_pending_aed", "posting"], filter: AWAITING, sort: { field: "srn_pending_aed", dir: "desc" }, pageSize: 15, emphasisField: "pending_days" }),
    table({ id: "gaps", title: "Real gaps between invoice and SRN", subtitle: "Beyond VAT. Positive: part of the invoice not receipted; negative: SRN above the invoice", columns: ["line", "vendor", "po", "invoice_no", "currency", "invoice_amount", "srn_amount", "gap_aed", "check", "posting"], filter: REAL_GAP, sort: { field: "gap_aed", dir: "desc" }, pageSize: 15 }),
    table({ id: "reused", title: "One SRN number on two invoices", subtitle: "One SRN for two invoices, or a number copied by mistake", columns: ["line", "vendor", "po", "invoice_no", "srn_no", "srn_reused", "srn_amount", "srn_aed"], filter: REUSED, sort: { field: "srn_no", dir: "asc" }, pageSize: 10 }),
    byVendor({ id: "a_noinv", title: "Invoices with no amount typed, by vendor", filter: UNKNOWN, columns: ["vendor", "invoices", "lines", "srn_aed"], sort: { field: "srn_aed", dir: "desc" }, pageSize: 15 }),
    table({ id: "slow", title: "Slowest postings", subtitle: "Longest wait from invoice date to SRN date", columns: lineCols, sort: { field: "days_to_srn", dir: "desc" }, filter: DATED, limit: 15, pageSize: 15, emphasisField: "days_to_srn" }),
  ], grid: [
    { i: "kpi_a_pending", x: 0, y: 0, w: 3, h: 3 }, { i: "kpi_a_gap", x: 3, y: 0, w: 3, h: 3 }, { i: "kpi_a_reused", x: 6, y: 0, w: 3, h: 3 }, { i: "kpi_a_noinv", x: 9, y: 0, w: 3, h: 3 },
    { i: "alert_list", x: 0, y: 3, w: 12, h: 29 }, { i: "awaiting", x: 0, y: 32, w: 12, h: 13 }, { i: "gaps", x: 0, y: 45, w: 12, h: 10 },
    { i: "reused", x: 0, y: 55, w: 7, h: 6 }, { i: "a_noinv", x: 7, y: 55, w: 5, h: 11 }, { i: "slow", x: 0, y: 66, w: 12, h: 13 },
  ] };

  const timing: Page = { id: "timing", title: "Processing time", widgets: [
    { id: "age_month", type: "bar", title: "Invoice age at SRN, by SRN month", subtitle: "Lines with both dates, by how old the invoice was when the SRN was posted", dimension: "period", metric: lines(DATED), stackBy: "age_band", sort: "date", orientation: "vertical", colorBy: "categorical", filter: DATED },
    { id: "median_month", type: "bar", title: "Median days invoice → SRN, by SRN month", subtitle: "Half the lines took longer than this", dimension: "period", metric: { agg: "median", field: "days_to_srn", format: "days" }, sort: "date", orientation: "vertical", colorBy: "single", share: false, filter: DATED },
    { id: "age", type: "bar", title: "How old the invoice was at SRN", subtitle: "Lines by days from invoice date to SRN date", dimension: "age_band", metric: lines(), sort: "order", orientation: "horizontal", colorBy: "single" },
    table({ id: "slowest", title: "Slowest twenty", subtitle: "Lines with the longest wait from invoice to SRN", columns: lineCols, sort: { field: "days_to_srn", dir: "desc" }, filter: DATED, limit: 20, pageSize: 20, emphasisField: "days_to_srn" }),
  ], grid: [{ i: "age_month", x: 0, y: 0, w: 6, h: 8 }, { i: "median_month", x: 6, y: 0, w: 6, h: 8 }, { i: "age", x: 0, y: 8, w: 12, h: 6 }, { i: "slowest", x: 0, y: 14, w: 12, h: 14 }] };

  const shipments: Page = { id: "shipments", title: "Shipments", widgets: [
    { id: "kpi_bls", type: "kpi", title: "Shipments (BL or reference)", metric: { agg: "distinct", field: "bl" }, good: "none", secondary: { metric: aed("srn_aed", HAS_BL), label: "SRN value" } },
    { id: "kpi_multi", type: "kpi", title: "Shipments with several vendors", metric: { agg: "distinct", field: "bl", filter: MULTI }, good: "none", onClick: MULTI, secondary: { metric: aed("srn_aed", MULTI), label: "SRN value" } },
    { id: "kpi_nobl", type: "kpi", title: "Lines without a BL", metric: lines(NO_BL), good: "down", onClick: NO_BL, secondary: { metric: aed("srn_aed", NO_BL), label: "SRN value" } },
    { id: "ship_vendors", type: "bar", title: "Vendors per shipment", subtitle: "Shipments by how many vendors invoiced on the same BL", dimension: "shipment_vendors", metric: { agg: "distinct", field: "bl" }, sort: "order", orientation: "horizontal", colorBy: "single" },
    { type: "table", id: "bl_table", title: "Cost per shipment", subtitle: "Invoice and SRN value per BL or reference across every vendor that invoiced on it", groupBy: "bl", rowLabel: "shipments", filter: HAS_BL,
      columns: ["bl", "vendor", "lines", "invoice_aed", "srn_aed", "first_srn", "last_srn"], sort: { field: "srn_aed", dir: "desc" }, search: true, pageSize: 20 },
  ], grid: [
    { i: "kpi_bls", x: 0, y: 0, w: 4, h: 3 }, { i: "kpi_multi", x: 4, y: 0, w: 4, h: 3 }, { i: "kpi_nobl", x: 8, y: 0, w: 4, h: 3 },
    { i: "ship_vendors", x: 0, y: 3, w: 12, h: 4 }, { i: "bl_table", x: 0, y: 7, w: 12, h: 16 },
  ] };

  const register: Page = { id: "register", title: "Register", widgets: [
    table({ id: "register", title: "All SRN lines", columns: ["line", "vendor", "po", "invoice_no", "invoice_date", "srn_date", "period", "days_to_srn", "bl", "currency", "invoice_amount", "srn_amount", "srn_no", "invoice_aed", "srn_posted_aed", "srn_pending_aed", "check", "posting", "status"], sort: { field: "srn_date", dir: "desc" }, search: true, pageSize: 50 }),
  ], grid: [{ i: "register", x: 0, y: 0, w: 12, h: 18 }] };
  const quality: Page = { id: "quality", title: "Data quality", widgets: [{ id: "quality", type: "quality", title: "Data quality" }], grid: [{ i: "quality", x: 0, y: 0, w: 12, h: 16 }] };

  return {
    version: 1, dateField: "srn_date", pages: [overview, vendors, pos, alerts, timing, shipments, register, quality],
    filters: [
      { kind: "daterange", field: "srn_date", label: "SRN date" },
      { kind: "select", field: "vendor", label: "Vendor" },
      { kind: "select", field: "po", label: "PO" },
      { kind: "select", field: "currency", label: "Currency" },
      { kind: "select", field: "check", label: "Invoice vs SRN" },
      { kind: "select", field: "status", label: "Status" },
      { kind: "search", field: "invoice_no", label: "Search" },
    ],
  };
}

const fmt = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Alerts and reminders, currency conversion and PO balance check, from the cleaned lines. */
export function srnAux(wb: ParsedWorkbook, schema?: SchemaMap): Record<string, AuxSheet> {
  const sheet = wb.sheets.find((s) => s.name === SRN_SHEET);
  const source = wb.sheets.find((s) => s.name !== SRN_SHEET && srnColumns(s));
  if (!sheet || !source) return {};
  // Vendor names as the dashboard shows them (the project's display names, e.g. an ERP name cut short), in the alert text too.
  const names = schema?.fields.find((f) => f.id === "vendor")?.valueMap ?? {};
  const ls = readLines(source, srnColumns(source)!).map((l) => ({ ...l, vendor: names[normKey(l.vendor)] ?? l.vendor }));
  const invs = [...invoices(ls).values()];
  const rateOf = (l: Line) => RATES[l.currency ?? "AED"] ?? 0;
  const val = (xs: Line[], f: (l: Line) => number) => Math.round(xs.reduce((a, l) => a + f(l) * rateOf(l), 0));
  const invVal = (xs: Invoice[], f: (v: Invoice) => number) => Math.round(xs.reduce((a, v) => a + f(v) * rateOf(v.lines[0]), 0));
  const vendorsOf = (xs: Line[]) => [...new Set(xs.map((l) => l.vendor))];
  const out: Record<string, ColumnValue>[] = [];
  const add = (priority: string, alert: string, items: number, value_aed: number | null, action: string) => { if (items > 0) out.push({ priority, alert, items, value_aed, action }); };

  // Act now
  const awaiting = ls.filter((l) => !l.srnNo);
  add("Act now", "Lines typed with an amount but no SRN number", awaiting.length, val(awaiting, (l) => l.srnAmt ?? 0), `${vendorsOf(awaiting).join(", ")}. Post the SRN, or remove the line if it was posted under another number.`);
  const short = invs.filter((v) => v.check === "SRN below invoice");
  add("Act now", "Invoices receipted for less than their amount, beyond VAT", short.length, invVal(short, (v) => v.gap), "Part of the invoice is not in any SRN: post a top-up SRN, or record the deduction and why.");
  const over = invs.filter((v) => v.check === "SRN above invoice");
  add("Act now", "Invoices receipted for more than their amount", over.length, invVal(over, (v) => -v.gap), "The SRN exceeds the invoice: check before payment is released.");
  const exhausted = new Map<string, Line[]>();
  for (const l of ls) if (l.po && l.poAmount !== null) exhausted.set(l.po, ls.filter((x) => x.po === l.po));
  for (const [po, xs] of exhausted) {
    const amount = xs.find((l) => l.poAmount !== null)!.poAmount!;
    const left = amount - xs.reduce((a, l) => a + (l.srnAmt ?? 0), 0);
    if (left <= amount * 0.1) add("Act now", `PO ${po} (${xs[0].vendor}) is ${left <= 0.5 ? "used up" : "nearly used up"}`, 1, Math.round(left * rateOf(xs[0])), left <= 0.5 ? "Balance is 0. Invoices now go on the next PO; type that PO's amount so its balance can be tracked too." : "Less than 10% left: raise the next PO before the vendor's next invoice.");
  }

  // Check
  const bySrn = new Map<string, Set<string>>();
  for (const l of ls) if (l.srnNo && l.invNo) bySrn.set(l.srnNo, (bySrn.get(l.srnNo) ?? new Set()).add(l.invNo));
  const reused = [...bySrn.entries()].filter(([, s]) => s.size > 1);
  add("Check", "One SRN number used on two invoices", reused.length, val(ls.filter((l) => l.srnNo && reused.some(([k]) => k === l.srnNo)), (l) => l.srnAmt ?? 0), reused.map(([k, s]) => `SRN ${k}: ${[...s].join(" and ")}`).join("; ") + ". One SRN for two invoices, or a number copied by mistake.");
  const badSrn = ls.filter((l) => l.notes.some((n) => n.field === "srn_no"));
  add("Check", "SRN number with the wrong number of digits", badSrn.length, null, badSrn.map((l) => `${l.vendor} invoice ${l.invNo ?? "?"}: "${l.srnNo}"`).join("; ") + ". ERP SRN numbers have 10 digits.");
  const badPo = ls.filter((l) => l.notes.some((n) => n.field === "po"));
  add("Check", "PO column holds something other than a PO number", badPo.length, val(badPo, (l) => l.srnAmt ?? 0), badPo.map((l) => `${l.vendor}: "${l.po}" (SRN ${l.srnNo ?? "none"})`).join("; ") + ".");
  const usual = new Map<string, string>();
  for (const v of new Set(ls.map((l) => l.vendor))) {
    const counts = new Map<string, number>();
    for (const l of ls) if (l.vendor === v && l.currency) counts.set(l.currency, (counts.get(l.currency) ?? 0) + 1);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] / total >= 0.7) usual.set(v, top[0]);
  }
  const oddCurrency = ls.filter((l) => l.currency && usual.has(l.vendor) && usual.get(l.vendor) !== l.currency && (l.srnAmt ?? 0) * rateOf(l) >= 100_000);
  add("Check", "Currency worth confirming", oddCurrency.length, val(oddCurrency, (l) => l.srnAmt ?? 0), oddCurrency.map((l) => `${l.vendor} invoice ${l.invNo ?? "?"}: typed ${l.currency}, the vendor's other lines are ${usual.get(l.vendor)} (AED ${fmt((l.srnAmt ?? 0) * (RATES[usual.get(l.vendor)!] ?? 1))} if ${usual.get(l.vendor)})`).join("; ") + ". Counted as typed.");
  const partOnly = invs.filter((v) => v.check === "Amount typed for part only");
  add("Check", "Invoice amount typed for part of the invoice only", partOnly.length, invVal(partOnly, (v) => v.posted + v.pending - (v.total ?? 0)), partOnly.map((v) => `${v.lines[0].vendor} ${v.lines[0].invNo}`).join("; ") + ". The typed amount equals one part's SRN, the other parts have none: type the whole invoice amount once.");
  const noSrnAmt = ls.filter((l) => l.srnNo && l.srnAmt === null);
  add("Fill in", "Posted lines with no SRN amount typed", noSrnAmt.length, val(noSrnAmt, (l) => l.invAmt ?? 0), `${vendorsOf(noSrnAmt).join(", ")}. The SRN number is there but not its amount, so these lines count nothing in the SRN totals (invoice value shown).`);
  const copied = ls.filter((l) => l.invFormula);
  add("Check", "Invoice amount is a formula copying the SRN amount", copied.length, val(copied, (l) => l.invAmt ?? 0), `${vendorsOf(copied).join(", ")}. These lines always match by construction: type the amount from the invoice to make the check real.`);
  const after = ls.filter((l) => l.invDate !== null && l.srnDate !== null && l.invDate > l.srnDate);
  add("Check", "Invoice date after its SRN date", after.length, null, after.map((l) => `${l.vendor} ${l.invNo ?? "?"}: ${iso(l.invDate!)} vs SRN ${iso(l.srnDate!)}`).join("; ") + ". Left as typed.");
  const fixed = ls.filter((l) => l.notes.some((n) => n.field === "invoice_date"));
  add("Check", "Invoice dates corrected on the dashboard", fixed.length, null, fixed.map((l) => l.notes.filter((n) => n.field === "invoice_date").map((n) => `${l.vendor} ${l.invNo ?? "?"}: ${n.from} → ${n.to}`).join(", ")).join("; ") + ". Correct them in the sheet too.");
  const badBl = ls.filter((l) => l.notes.some((n) => n.field === "bl"));
  add("Check", "BL cell is an error or a date", badBl.length, null, badBl.map((l) => `${l.vendor} ${l.invNo ?? "?"} (row ${l.row})`).join("; ") + ". Retype the BL number as text.");
  const old = ls.filter((l) => l.invDate !== null && l.srnDate !== null && (l.srnDate - l.invDate) / DAY > 90);
  add("Check", "SRNs posted more than 90 days after the invoice date", old.length, val(old, (l) => l.srnAmt ?? 0), `${vendorsOf(old).length} vendors; ${ls.filter((l) => l.invDate !== null && l.srnDate !== null && (l.srnDate - l.invDate) / DAY > 180).length} lines over 180 days. Late receipting delays vendor payment.`);

  // Fill in
  const pos = new Set(ls.map((l) => l.po).filter(Boolean));
  const tracked = new Set(ls.filter((l) => l.poAmount !== null).map((l) => l.po));
  add("Fill in", "POs without a PO amount typed", pos.size - tracked.size, null, `${tracked.size} of ${pos.size} POs have an amount. Type the PO amount on the PO's first line and the balance is tracked for it, as for PO ${[...tracked][0] ?? ""}.`);
  const noInv = invs.filter((v) => v.total === null);
  add("Fill in", "Invoices with no invoice amount typed", noInv.length, invVal(noInv, (v) => v.posted + v.pending), `${[...new Set(noInv.map((v) => v.lines[0].vendor))].join(", ")}. Without the amount the SRN cannot be checked against the invoice.`);
  const noCur = ls.filter((l) => l.notes.some((n) => n.field === "currency"));
  add("Fill in", "Lines with no currency typed", noCur.length, val(noCur, (l) => l.srnAmt ?? 0), "Taken from the invoice's other line or the vendor's usual currency (AED for UAE vendors). Type it to be sure.");
  const noSrnDate = ls.filter((l) => l.srnDate === null && l.srnNo);
  const firstDated = ls.filter((l) => l.srnDate !== null).map((l) => l.srnDate!);
  add("Fill in", "Posted lines with no SRN date", noSrnDate.length, val(noSrnDate, (l) => l.srnAmt ?? 0), `Dates were typed from ${firstDated.length ? dayOf(Math.min(...firstDated)) : "a later point"}; earlier lines are placed by SRN number. Typing the date puts them in their real month.`);
  const noInvDate = ls.filter((l) => l.invDate === null);
  add("Fill in", "Lines with no invoice date", noInvDate.length, null, "Needed for processing time (invoice → SRN) and for ageing the pending lines.");
  const noBl = ls.filter((l) => !l.bl);
  add("Fill in", "Lines with no BL or reference", noBl.length, val(noBl, (l) => l.srnAmt ?? 0), "The BL ties the freight line, transporter and customs invoices of one shipment together.");
  add("Fill in", "Credit note, remarks and PO tax columns are empty", 1, null, "Credit notes against an invoice would net off its SRN; remarks would carry the reason for any gap.");

  const cur = new Map<string, Line[]>();
  for (const l of ls) cur.set(l.currency ?? "AED", [...(cur.get(l.currency ?? "AED") ?? []), l]);
  const currencies = [...cur.entries()].sort((a, b) => b[1].length - a[1].length).map(([c, xs]) => ({
    currency: c, lines: xs.length, srn_amount: Math.round(xs.reduce((a, l) => a + (l.srnAmt ?? 0), 0)), rate: RATES[c] ?? null, srn_aed: RATES[c] ? val(xs, (l) => l.srnAmt ?? 0) : null,
    note: c === "USD" ? "Pegged rate." : c === "SAR" ? "Pegged rate (3.6725 / 3.75)." : c === "EUR" ? "Average rate: EUR is not pegged, so this is approximate." : c === "AED" ? `${xs.filter((l) => l.notes.some((n) => n.field === "currency")).length} of these lines had no currency typed.` : "No rate: left out of AED totals.",
  }));

  const poRows = [...exhausted.entries()].map(([po, xs]) => {
    const amount = xs.find((l) => l.poAmount !== null)!.poAmount!;
    const srnTotal = round2(xs.reduce((a, l) => a + (l.srnAmt ?? 0), 0));
    const last = [...xs].reverse().find((l) => l.balance !== null)?.balance ?? null;
    const check = round2(amount - srnTotal);
    return { po, vendor: xs[0].vendor, po_amount: amount, srn_total: srnTotal, balance_sheet: last, balance_check: check, note: last === null ? "No balance typed." : Math.abs(last - check) < 1 ? "Balance agrees with the SRNs." : `The sheet's last balance differs by ${fmt(last - check)} from PO amount less SRNs.` };
  });

  const rank: Record<string, number> = { "Act now": 0, Check: 1, "Fill in": 2 };
  out.sort((a, b) => (rank[String(a.priority)] ?? 9) - (rank[String(b.priority)] ?? 9));
  const t = (id: string, label: string, type: "string" | "number", format?: "integer" | "currency" | "decimal") => ({ id, label, type, ...(format ? { format } : {}) });
  return {
    alerts: { id: "alerts", label: "Alerts and reminders", columns: [t("priority", "Priority", "string"), { ...t("alert", "Alert", "string"), wrap: true }, t("items", "Items", "number", "integer"), t("value_aed", "Value (AED)", "number", "currency"), { ...t("action", "What to do", "string"), wrap: true }], rows: out },
    currencies: { id: "currencies", label: "Currencies", columns: [t("currency", "Currency", "string"), t("lines", "Lines", "number", "integer"), t("srn_amount", "SRN amount as typed", "number", "integer"), t("rate", "Rate to AED", "number", "decimal"), t("srn_aed", "SRN value (AED)", "number", "currency"), { ...t("note", "Note", "string"), wrap: true }], rows: currencies },
    po_balance: { id: "po_balance", label: "PO balance", columns: [t("po", "PO", "string"), t("vendor", "Vendor", "string"), t("po_amount", "PO amount", "number", "currency"), t("srn_total", "SRNs on the PO", "number", "currency"), t("balance_sheet", "Balance in the sheet", "number", "currency"), t("balance_check", "PO amount less SRNs", "number", "currency"), { ...t("note", "Note", "string"), wrap: true }], rows: poRows },
  };
}

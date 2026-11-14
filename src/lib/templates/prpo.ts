import type { AuxSheet, Field, FilterExpr, ParsedSheet, ParsedWorkbook, RawCell, RawRow, SchemaMap } from "@/lib/schema/types";
import { cleanText, normKey } from "@/lib/schema/types";
import { toDate } from "@/lib/schema/normalize";
import { readCountry, title } from "@/lib/templates/quotes";
import type { Layout, Page, Widget } from "@/lib/dashboard/types";
import type { MetricSpec } from "@/lib/engine/metrics";

/**
 * PR & PO daily update: the procurement follow-up log a logistics team keeps of every purchase requisition (PR) it
 * raises for a service supplier (shipping lines, customs, transporters, clearing agents) and the purchase order (PO)
 * that the PR became. One row = one PR line: date raised, supplier registration number, supplier, PR, PO, business
 * unit, currency, amount, a typed status (Approved / Pending / Need to Create), and two columns meant for usage
 * tracking (SRN done, balance) that are not filled yet. A second sheet is a pivot listing registration number ×
 * supplier, built from the log on 26 Oct 2026.
 *
 * The sheet carries no formulas; its logic is the owner's habits, kept here:
 * - A row without a PO is a PO still pending (the owner's rule), whatever the status cell says. A row without a PR
 *   is a PR still to raise; "Need to Create" rows (supplier only, sometimes a country in the PO column) are a new
 *   PO the team knows it needs.
 * - The owner highlights repeated PR and PO numbers: a PR and PO typed twice with the same amount is the same line
 *   entered twice (counted once); one PR over several POs and several PRs on one PO are kept and named as patterns.
 * - Amounts are in each line's own currency; the dashboard adds them in AED (USD 3.6725, SAR 0.979, EUR 4.28).
 * - Dates start on 13 Jun 2026; earlier rows are "Before 13 Jun 2026" in sheet order, an undated row further down
 *   takes the month of the row above (noted). Days pending count from the date raised, so they are live.
 * - Checks the owner would want: a PO or PR number far outside its own number series (likely mistyped), a
 *   registration number that belongs to another supplier, a registration equal to the PR number, a person's name
 *   typed as the supplier (never shown).
 */

export const PRPO_SHEET = "PR & PO lines";
const RATES: Record<string, number> = { AED: 1, USD: 3.6725, SAR: 3.6725 / 3.75, EUR: 4.28, GBP: 4.9 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const STAGES = ["Waiting for PO", "PR to raise", "New PO needed", "PO issued"];
const PO_STATUS = ["PO pending", "PO issued"];
const AGE = ["Within a week", "1–2 weeks", "2–4 weeks", "1–2 months", "Over 2 months"];
const PATTERNS = ["One PR, one PO", "One PR, one PO, in parts", "Several PRs on one PO", "One PR over several POs", "No PO yet"];

const HEADERS = [
  "Line", "Raised", "Period", "Period start", "Date source", "Registration no", "Supplier", "Supplier as typed", "PR", "PO", "PO series", "For", "BU", "Currency", "Amount", "Amount (AED)",
  "Status as typed", "PO status", "Stage", "Next step", "Pending since", "Wait is a minimum", "Issued (AED)", "Pending (AED)", "Issued", "Pending", "Lines", "PRs on the PO", "POs on the PR", "How the PR became a PO",
  "SRN done (AED)", "Balance (AED)", "Check", "Excluded because", "Sheet row", "Corrections",
];

const SUPPLIERS: Record<string, string> = {
  "cma - cgm shipping agency- se": "CMA CGM", "cma cgm shipping agency": "CMA CGM", "mediterranean shipping company(uae)": "MSC", "mediterranean shipping company (uae)": "MSC", "maersk kanoo (emirates) llc": "Maersk Kanoo",
  "cordelia container shipping line": "Cordelia", "imex global freight fzc": "IMEX Global Freight", "noatum logistics": "Noatum Logistics", "oman transport l.l.c": "Oman Transport", "oman transport llc": "Oman Transport",
  gulftainer: "Gulftainer", "gulf tainer": "Gulftainer", "hutchison ajman international termi": "Hutchison Ajman", "dubai customs": "Dubai Customs", "algharbeya customs clearing": "Al Gharbeya Customs",
  "falcon gateway logistics llc": "Falcon Gateway", "dsv solutions pjsc": "DSV", "transworld saudi logistics": "Transworld Saudi", "falcon express maritime - ksa": "Falcon Express (KSA)", "aj for logistics services": "AJ Logistics (KSA)",
  "royal green land transport - llc": "Royal Green", "emirates shipping company": "Emirates Shipping", "jamshaid raza heavy machines": "Jamshaid Raza Heavy Machines", "fero dwc-llc": "FERO", "dp world logistics uae fze": "DP World Logistics",
  "maharat alinjaz for customs clearan": "Maharat Alinjaz", "abu dhabi customs for duty payment": "Abu Dhabi Customs", "department of finance revenue (auh customs)": "Abu Dhabi Customs", "barsan global fze": "Barsan Global FZE",
  "barsan global logistics - llc - s": "Barsan Global Logistics", "oocl logistics (asia pacific) limit": "OOCL Logistics", "kam (khat al madinah cargo service llc)": "Khat Al Madinah (KAM)", "khat al madinah cargo service": "Khat Al Madinah (KAM)",
  "kpler dmcc": "Kpler", "s&h shipping co.ltd": "S&H Shipping", "bait aleaz transports l.l.c": "Bait Aleaz Transports", "yasmin transport": "Yasmin Transport", "thrifty rent a car l.l.c.": "Thrifty Rent A Car", "al sahel cargo & clearing llc": "Al Sahel Cargo",
  "cma terminals khalifa llc": "CMA Terminals Khalifa", "brothers general transport llc": "Brothers General Transport", "emirates post group": "Emirates Post", "trukkin transporter & freight bro": "Trukkin", "trukker technologies dmcc": "Trukker",
  "kmtc middle east shipping l.l.c": "KMTC", kmtc: "KMTC", caravanx: "CaravanX", "dp transport": "DP Transport", falcon: "Falcon (to confirm)",
};

type Note = { field: string; from: string; to: string; reason: string };
const text = (v: RawCell): string | null => { if (v === null || v === undefined) return null; const s = cleanText(v); return s ? s : null; };
const num = (v: RawCell): number | null => { if (typeof v === "number") return Number.isFinite(v) ? v : null; const s = text(v); if (!s) return null; const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
/** A PR or PO cell: a number of five or more digits; anything else is a note ("PR to be raise", "India"). */
const docNo = (v: RawCell): string | null => { const s = text(v); if (!s) return null; const d = s.replace(/\s+/g, ""); return /^\d{5,}$/.test(d) ? d : null; };
const iso = (t: number) => new Date(t).toISOString();
const monthLabel = (t: number) => { const d = new Date(t); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const fmtDay = (t: number) => { const d = new Date(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const pick = (headers: string[], ...names: string[]) => headers.find((h) => names.includes(normKey(h)));

type Cols = { date?: string; reg?: string; supplier: string; pr: string; po: string; bu?: string; currency?: string; amount: string; status?: string; srn?: string; balance?: string };
function prpoColumns(sheet: ParsedSheet): Cols | null {
  const h = sheet.headers;
  const supplier = pick(h, "supplier", "vendor", "supplier name"), pr = pick(h, "pr", "pr no", "pr number", "purchase requisition"), po = pick(h, "po", "po no", "po number", "purchase order");
  const amount = pick(h, "po amount", "pr amount", "amount", "value");
  if (!supplier || !pr || !po || !amount) return null;
  if (h.some((x) => /srn (amount|number|no)/.test(normKey(x)))) return null; // the SRN posting log, not this one
  return { supplier, pr, po, amount, date: pick(h, "date", "pr date", "date raised"), reg: pick(h, "registration number", "registration no", "vendor code", "supplier code"), bu: pick(h, "bu", "business unit"), currency: pick(h, "currency", "curr"),
    status: pick(h, "remarks", "status", "approval status"), srn: pick(h, "srn done", "srn", "used"), balance: pick(h, "balance po", "balance", "po balance") };
}
export const matchesPrPo = (headers: string[]): boolean => ["line", "pr", "po", "po status", "amount (aed)"].every((k) => headers.some((h) => normKey(h) === k));

function supplierName(raw: string | null, notes: Note[]): string | null {
  if (!raw) return null;
  // "Arranged by <person>": a person, not a supplier. The name is never kept.
  if (/^arranged by\b/i.test(raw)) { notes.push({ field: "supplier", from: "(a person's name)", to: "Not named (arranged internally)", reason: "A person's name was typed as the supplier; it is not shown" }); return "Not named (arranged internally)"; }
  const k = normKey(raw).replace(/\s+/g, " ").trim();
  const v = SUPPLIERS[k] ?? title(raw.trim()).replace(/\bLlc\b/g, "LLC").replace(/\bFze\b/g, "FZE").replace(/\bDmcc\b/g, "DMCC");
  return v;
}

interface Line { row: number; date: number | null; reg: string | null; supplier: string | null; supplierRaw: string | null; pr: string | null; po: string | null; forWhat: string | null; bu: string | null; currency: string | null; amount: number | null; status: string | null; srn: number | null; balance: number | null; notes: Note[] }

/** Distance from the nearest other number of the same series: a number far from all its siblings is likely mistyped. */
function outOfSeries(values: string[], key: (s: string) => string, gap: number): Set<string> {
  const out = new Set<string>();
  const bySeries = new Map<string, number[]>();
  for (const v of new Set(values)) { const k = key(v); (bySeries.get(k) ?? bySeries.set(k, []).get(k)!).push(Number(v)); }
  for (const [, nums] of bySeries) {
    if (nums.length < 3) continue;
    for (const n of nums) { const nearest = Math.min(...nums.filter((m) => m !== n).map((m) => Math.abs(m - n))); if (nearest > gap) out.add(String(n)); }
  }
  return out;
}
const series = (s: string) => `${s.length}:${s.slice(0, 4)}`;

/** Turns the PR & PO log into one "PR & PO lines" sheet; other workbooks pass through untouched. */
export function preparePrPoWorkbook(wb: ParsedWorkbook): ParsedWorkbook {
  if (wb.sheets.some((s) => s.name === PRPO_SHEET)) return wb;
  const source = wb.sheets.find((s) => prpoColumns(s));
  if (!source) return wb;
  const c = prpoColumns(source)!;
  const cell = (r: RawRow, h?: string): RawCell => (h ? r.cells[h] ?? null : null);
  const lines: Line[] = [];
  for (const r of source.rows) {
    const supplierRaw = text(cell(r, c.supplier)), prRaw = text(cell(r, c.pr)), poRaw = text(cell(r, c.po)), amount = num(cell(r, c.amount)), status = text(cell(r, c.status));
    if (!supplierRaw && !prRaw && !poRaw && amount === null) continue;
    if (supplierRaw && /^(grand\s+)?total\b/i.test(supplierRaw)) continue;
    const notes: Note[] = [];
    const pr = docNo(cell(r, c.pr)), po = docNo(cell(r, c.po));
    let forWhat: string | null = null;
    if (prRaw && !pr) notes.push({ field: "pr", from: prRaw, to: "(blank)", reason: "Not a PR number; read as a PR still to raise" });
    if (poRaw && !po) { const cty = readCountry(poRaw); forWhat = cty && cty.region !== "Other" ? cty.name : title(poRaw); notes.push({ field: "po", from: poRaw, to: "(blank)", reason: `Not a PO number; kept as what the PO is for (${forWhat})` }); }
    const regRaw = text(cell(r, c.reg));
    const reg = regRaw && /^\d+$/.test(regRaw.replace(/\s/g, "")) ? regRaw.replace(/\s/g, "") : null;
    const cur = text(cell(r, c.currency))?.toUpperCase().replace(/^EURO$/, "EUR") ?? null;
    lines.push({ row: r.row, date: toDate(cell(r, c.date)), reg, supplier: supplierName(supplierRaw, notes), supplierRaw: supplierRaw && /^arranged by\b/i.test(supplierRaw) ? null : supplierRaw, pr, po, forWhat, bu: text(cell(r, c.bu)), currency: cur, amount, status, srn: num(cell(r, c.srn)), balance: num(cell(r, c.balance)), notes });
  }

  // Duplicates: the same PR, PO, amount and currency typed twice is one line.
  const seen = new Map<string, number>();
  const excluded = new Map<Line, string>();
  for (const l of lines) {
    if (!l.pr || !l.po || l.amount === null) continue;
    const k = `${l.pr}|${l.po}|${l.amount}|${l.currency}`;
    const first = seen.get(k);
    if (first !== undefined) excluded.set(l, `Same PR, PO and amount as sheet row ${first} (typed twice)`);
    else seen.set(k, l.row);
  }
  const counted = lines.filter((l) => !excluded.has(l));

  // Number series and registration checks.
  const badPo = outOfSeries(counted.flatMap((l) => (l.po ? [l.po] : [])), series, 2000);
  const badPr = outOfSeries(counted.flatMap((l) => (l.pr ? [l.pr] : [])), series, 2000);
  const regOwner = new Map<string, string>();
  { const votes = new Map<string, Map<string, number>>(); for (const l of counted) if (l.reg && l.supplier) { const m = votes.get(l.reg) ?? new Map(); m.set(l.supplier, (m.get(l.supplier) ?? 0) + 1); votes.set(l.reg, m); }
    for (const [reg, m] of votes) { const best = [...m.entries()].sort((a, b) => b[1] - a[1]); if (best.length > 1 && best[0][1] > best[1][1]) regOwner.set(reg, best[0][0]); } }
  const regsOf = new Map<string, Set<string>>(); for (const l of counted) if (l.reg && l.supplier) (regsOf.get(l.supplier) ?? regsOf.set(l.supplier, new Set()).get(l.supplier)!).add(l.reg);

  // PR ↔ PO patterns.
  const prsOnPo = new Map<string, Set<string>>(), posOnPr = new Map<string, Set<string>>(), linesOnPair = new Map<string, number>();
  for (const l of counted) {
    if (l.po && l.pr) { (prsOnPo.get(l.po) ?? prsOnPo.set(l.po, new Set()).get(l.po)!).add(l.pr); (posOnPr.get(l.pr) ?? posOnPr.set(l.pr, new Set()).get(l.pr)!).add(l.po); const k = `${l.pr}|${l.po}`; linesOnPair.set(k, (linesOnPair.get(k) ?? 0) + 1); }
  }

  // Dates: rows before the first dated row are "Before <first date>"; an undated row later takes the row above's month.
  const firstDated = lines.findIndex((l) => l.date !== null);
  const firstDate = firstDated >= 0 ? lines[firstDated].date! : null;
  const ids = new Map<string, number>();
  const rows: RawRow[] = lines.map((l, i) => {
    const notes = [...l.notes];
    let period: string | null = null, periodStart: number | null = null, dateSource = "Typed";
    if (l.date !== null) { period = monthLabel(l.date); periodStart = Date.UTC(new Date(l.date).getUTCFullYear(), new Date(l.date).getUTCMonth(), 1); }
    else if (firstDate !== null && i < firstDated) { period = `Before ${fmtDay(firstDate)}`; periodStart = Date.UTC(new Date(firstDate).getUTCFullYear(), new Date(firstDate).getUTCMonth(), 0); dateSource = "Before dating began"; }
    else {
      const above = lines.slice(0, i).reverse().find((x) => x.date !== null);
      if (above) { period = monthLabel(above.date!); periodStart = Date.UTC(new Date(above.date!).getUTCFullYear(), new Date(above.date!).getUTCMonth(), 1); dateSource = "From the row above"; notes.push({ field: "period", from: "(no date)", to: period, reason: "No date on the row; month taken from the row above" }); }
      else dateSource = "Not dated";
    }
    // Days pending count from the date raised; an undated pending line has waited at least since the date it sits under.
    let since: number | null = null, minimum = false;
    if (!l.po && !/need to create/i.test(l.status ?? "") && l.amount !== null) {
      if (l.date !== null) since = l.date;
      else if (dateSource === "Before dating began" && firstDate !== null) { since = firstDate; minimum = true; }
      else { const above = lines.slice(0, i).reverse().find((x) => x.date !== null); if (above) { since = above.date; minimum = true; } }
    }
    const stage = l.po ? "PO issued" : l.pr ? "Waiting for PO" : /need to create/i.test(l.status ?? "") || l.amount === null ? "New PO needed" : "PR to raise";
    const poStatus = l.po ? "PO issued" : "PO pending";
    if (l.po && l.status && !/approv/i.test(l.status)) notes.push({ field: "po_status", from: l.status, to: "PO issued", reason: "A PO number is typed, so the PO is issued whatever the status cell says" });
    if (!l.po && l.status && /approv/i.test(l.status)) notes.push({ field: "po_status", from: l.status, to: "PO pending", reason: "Status says approved but no PO number is typed: counted as pending" });
    const rate = l.currency ? RATES[l.currency] : RATES.AED;
    if (l.amount !== null && l.currency && rate === undefined) notes.push({ field: "amount_aed", from: l.currency, to: "(blank)", reason: `No rate for ${l.currency}` });
    if (l.amount !== null && !l.currency) notes.push({ field: "currency", from: "(blank)", to: "AED", reason: "No currency typed; treated as AED" });
    const aed = l.amount !== null && rate !== undefined ? Math.round(l.amount * rate * 100) / 100 : null;
    const ex = excluded.get(l) ?? null;
    const checks: string[] = [];
    if (l.po && badPo.has(l.po)) checks.push("PO number outside its series");
    if (l.pr && badPr.has(l.pr)) checks.push("PR number outside its series");
    if (l.reg && l.supplier && regOwner.has(l.reg) && regOwner.get(l.reg) !== l.supplier) checks.push(`Registration no is ${regOwner.get(l.reg)}'s`);
    if (l.reg && l.pr && l.reg === l.pr) checks.push("Registration no equals the PR no");
    if (!l.reg && l.supplier && stage !== "New PO needed") checks.push("No registration no");
    if (/not named/i.test(l.supplier ?? "")) checks.push("No supplier named");
    if (!l.bu && stage !== "New PO needed") checks.push("No BU");
    const nextStep = stage === "PO issued" ? null : stage === "Waiting for PO" ? `Chase approval of PR ${l.pr} for the PO` : stage === "PR to raise" ? "Raise the PR, then the PO" : `Create the PR and PO${l.forWhat ? ` (for ${l.forWhat})` : ""}`;
    const pair = l.pr && l.po ? `${l.pr}|${l.po}` : null;
    const pattern = !l.po ? "No PO yet" : (prsOnPo.get(l.po)?.size ?? 1) > 1 ? "Several PRs on one PO" : l.pr && (posOnPr.get(l.pr)?.size ?? 1) > 1 ? "One PR over several POs" : pair && (linesOnPair.get(pair) ?? 1) > 1 ? "One PR, one PO, in parts" : "One PR, one PO";
    const base = l.pr ? `PR ${l.pr}` : `Row ${l.row} · no PR`;
    const n = (ids.get(base) ?? 0) + 1; ids.set(base, n);
    const counts = ex === null;
    const cells: Record<string, RawCell> = {
      "Line": n > 1 ? `${base} (${n})` : base, "Raised": l.date !== null ? iso(l.date) : null, "Period": period, "Period start": periodStart !== null ? iso(periodStart) : null, "Date source": dateSource,
      "Registration no": l.reg, "Supplier": l.supplier, "Supplier as typed": l.supplierRaw, "PR": l.pr, "PO": l.po, "PO series": l.po ? `${l.po.slice(0, 4)}…` : null, "For": l.forWhat, "BU": l.bu,
      "Currency": l.currency ?? (l.amount !== null ? "AED" : null), "Amount": l.amount, "Amount (AED)": aed, "Status as typed": l.status, "PO status": poStatus, "Stage": stage, "Next step": nextStep, "Pending since": since !== null ? iso(since) : null, "Wait is a minimum": minimum ? "Yes" : null,
      "Issued (AED)": l.po ? aed : null, "Pending (AED)": !l.po ? aed : null, "Issued": counts && l.po ? 1 : 0, "Pending": counts && !l.po ? 1 : 0, "Lines": counts ? 1 : 0,
      "PRs on the PO": l.po ? prsOnPo.get(l.po)?.size ?? 1 : null, "POs on the PR": l.pr ? posOnPr.get(l.pr)?.size ?? (l.po ? 1 : 0) : null, "How the PR became a PO": pattern,
      "SRN done (AED)": l.srn !== null && rate !== undefined ? Math.round(l.srn * rate * 100) / 100 : null, "Balance (AED)": l.balance !== null && rate !== undefined ? Math.round(l.balance * rate * 100) / 100 : null,
      "Check": checks.length ? checks.join("; ") : null, "Excluded because": ex, "Sheet row": l.row, "Corrections": notes.length ? JSON.stringify(notes) : null,
    };
    return { row: i + 2, cells };
  });
  const sheet: ParsedSheet = { name: PRPO_SHEET, headerRow: 1, headers: HEADERS, rows, stats: statsFor(HEADERS, rows), validations: {}, totalRowsInSheet: rows.length + 1 };
  const grids = { ...(wb.grids ?? {}) };
  if (!grids[source.name]) grids[source.name] = [source.headers, ...source.rows.map((r) => source.headers.map((h) => r.cells[h] ?? null))];
  return { ...wb, sheets: [sheet, ...wb.sheets.filter((s) => s !== source)], primary: 0, grids };
}

function statsFor(headers: string[], rows: RawRow[]) {
  return headers.map((header, index) => {
    const values = rows.map((r) => r.cells[header]).filter((v) => v !== null && v !== undefined);
    const strings = values.filter((v) => typeof v === "string") as string[];
    return {
      header, index, nonEmpty: values.length, numbers: values.filter((v) => typeof v === "number").length, dates: strings.filter((v) => /^\d{4}-\d{2}-\d{2}T/.test(v)).length,
      booleans: values.filter((v) => typeof v === "boolean").length, strings: strings.length, distinct: new Set(values.map(String)).size,
      avgLength: strings.length ? strings.reduce((a, s) => a + s.length, 0) / strings.length : 0, samples: [...new Set(values.map(String))].slice(0, 5),
    };
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Schema

const dim = (id: string, label: string, source: string, extra: Partial<Field> = {}): Field => ({ id, label, source, type: "string", role: "dimension", ...extra });
const txt = (id: string, label: string, source: string, extra: Partial<Field> = {}): Field => ({ id, label, source, type: "string", role: "text", ...extra });
const aed = (id: string, label: string, source: string, extra: Partial<Field> = {}): Field => ({ id, label, source, type: "number", role: "measure", format: "currency", currency: "AED", aggregate: "sum", noAnomalies: true, ...extra });
const cnt = (id: string, label: string, source: string, extra: Partial<Field> = {}): Field => ({ id, label, source, type: "number", role: "measure", format: "integer", aggregate: "sum", noAnomalies: true, ...extra });
const is = (field: string, value: string | number): FilterExpr => ({ field, op: "eq", value });
const PENDING = is("po_status", "PO pending"), ISSUED = is("po_status", "PO issued");
const WAITING = is("stage", "Waiting for PO"), TO_RAISE = is("stage", "PR to raise"), NEW_PO = is("stage", "New PO needed");
const OVER_30: FilterExpr = { field: "pending_days", op: "gt", value: 30 };
const CHECKED: FilterExpr = { field: "check", op: "notNull" };

export function prpoSchema(): SchemaMap {
  const fields: Field[] = [
    { id: "line", label: "PR line", source: "Line", type: "string", role: "id" },
    { id: "raised", label: "Raised", source: "Raised", type: "date", role: "date", format: "date" },
    dim("period", "Month raised", "Period", { semantic: "period" }),
    { id: "period_start", label: "Month raised", source: "Period start", type: "date", role: "date", format: "date", hidden: true },
    dim("date_source", "Date source", "Date source", { hidden: true, order: ["Typed", "From the row above", "Before dating began", "Not dated"] }),
    dim("reg", "Registration no", "Registration no", { hidden: true }),
    dim("supplier", "Supplier", "Supplier", { semantic: "customer" }),
    txt("supplier_raw", "Supplier as typed", "Supplier as typed", { hidden: true }),
    dim("pr", "PR", "PR"),
    dim("po", "PO", "PO"),
    dim("po_series", "PO series", "PO series"),
    dim("for", "For", "For", { hidden: true }),
    dim("bu", "BU", "BU", { hidden: true }),
    dim("currency", "Currency", "Currency"),
    { id: "amount", label: "Amount (as typed)", source: "Amount", type: "number", role: "measure", format: "decimal", aggregate: "sum", noAnomalies: true },
    aed("amount_aed", "Amount (AED)", "Amount (AED)", { semantic: "amount" }),
    dim("status_typed", "Status as typed", "Status as typed", { hidden: true }),
    dim("po_status", "PO status", "PO status", { semantic: "status", order: PO_STATUS }),
    dim("stage", "Stage", "Stage", { order: STAGES }),
    txt("next_step", "Next step", "Next step"),
    { id: "pending_since", label: "Pending since", source: "Pending since", type: "date", role: "date", format: "date", hidden: true, description: "Date raised; for an undated line, the date it sits under (so its wait is a minimum)" },
    dim("wait_minimum", "Wait is a minimum", "Wait is a minimum", { hidden: true }),
    aed("issued_aed", "Issued (AED)", "Issued (AED)"),
    aed("pending_aed", "Pending (AED)", "Pending (AED)"),
    cnt("issued", "POs issued", "Issued", { hidden: true }),
    cnt("pending", "POs pending", "Pending", { hidden: true }),
    cnt("lines", "PR lines", "Lines", { hidden: true }),
    { id: "prs_on_po", label: "PRs on the PO", source: "PRs on the PO", type: "number", role: "measure", format: "integer", aggregate: "max", noAnomalies: true, hidden: true },
    { id: "pos_on_pr", label: "POs on the PR", source: "POs on the PR", type: "number", role: "measure", format: "integer", aggregate: "max", noAnomalies: true, hidden: true },
    dim("pattern", "How the PR became a PO", "How the PR became a PO", { order: PATTERNS }),
    aed("srn_done", "SRN done", "SRN done (AED)", { hidden: true }),
    aed("balance", "Balance", "Balance (AED)", { hidden: true }),
    txt("check", "Check", "Check", { hidden: true }),
    txt("exclude_reason", "Excluded because", "Excluded because", { hidden: true }),
    { id: "source_row", label: "Sheet row", source: "Sheet row", type: "number", role: "measure", format: "integer", hidden: true, noAnomalies: true },
    txt("notes", "Corrections", "Corrections", { hidden: true }),
    { id: "pending_days", label: "Pending for", source: null, type: "number", role: "measure", format: "days", aggregate: "max", noAnomalies: true, derived: { kind: "ageDays", from: "pending_since", when: PENDING } },
    { id: "age_band_raw", label: "Waiting", source: null, type: "string", role: "dimension", hidden: true, derived: { kind: "bucket", from: "pending_days", edges: [8, 15, 31, 61], labels: AGE } },
    { id: "age_band", label: "Waiting", source: null, type: "string", role: "dimension", order: [...AGE, "Not dated", "New PO, not raised"], derived: { kind: "case", cases: [{ when: NEW_PO, value: "New PO, not raised" }, { when: { and: [PENDING, { field: "pending_days", op: "isNull" }] }, value: "Not dated" }, { when: PENDING, from: "age_band_raw" }], fallback: null } },
    { id: "latest", label: "Latest month", source: null, type: "string", role: "dimension", order: ["Latest month", "Earlier"], hidden: true, derived: { kind: "latestPeriod", from: "period_start", unit: "month" } },
  ];
  return { version: 1, sheet: PRPO_SHEET, fields, idField: "line", primaryDate: "period_start", noteField: "notes", excludeField: "exclude_reason", foldCase: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Layout

const sum = (field: string, filter?: FilterExpr): MetricSpec => ({ agg: "sum", field, format: "currency", currency: "AED", ...(filter ? { filter } : {}) });
const count = (field: string, filter?: FilterExpr): MetricSpec => ({ agg: "sum", field, format: "integer", ...(filter ? { filter } : {}) });
const distinctPo = (filter?: FilterExpr): MetricSpec => ({ agg: "distinct", field: "po", format: "integer", ...(filter ? { filter } : {}) });
const share = (field: string, over: string): MetricSpec => ({ agg: "ratio", field, over, unpaired: true, format: "percent" });
const table = (w: Omit<Extract<Widget, { type: "table" }>, "type">): Widget => ({ type: "table", ...w });
const PENDING_COLS = ["line", "supplier", "stage", "amount_aed", "currency", "amount", "raised", "pending_days", "next_step"];
const PENDING_SHORT = ["line", "supplier", "stage", "amount_aed", "currency", "amount", "pending_days"];
const ISSUED_COLS = ["po", "supplier", "pr", "currency", "amount", "amount_aed", "raised", "pattern"];

export function prpoLayout(): Layout {
  const overview: Page = {
    id: "overview", title: "Overview", widgets: [
      { id: "story", type: "story", title: "This month", dateField: "period_start", monthField: "period", metrics: [
        { id: "raised", label: "PR lines raised", metric: count("lines"), good: "none" },
        { id: "value", label: "requested", metric: sum("amount_aed"), good: "none" },
        { id: "issued", label: "POs issued", metric: count("issued"), good: "up" },
        { id: "pending", label: "still pending", metric: count("pending"), good: "down" },
      ] },
      { id: "k_pending", type: "kpi", title: "POs pending", metric: count("pending"), good: "down", onClick: PENDING, secondary: { metric: sum("pending_aed"), label: "waiting" } },
      { id: "k_pending_val", type: "kpi", title: "Value waiting for a PO", metric: sum("pending_aed"), good: "down", onClick: PENDING, secondary: { metric: share("pending_aed", "amount_aed"), label: "of all requested" } },
      { id: "k_oldest", type: "kpi", title: "Waiting longest", metric: { agg: "max", field: "pending_days", format: "days", filter: PENDING }, good: "down", onClick: PENDING, secondary: { metric: count("pending", OVER_30), label: "pending over 30 days" } },
      { id: "k_issued", type: "kpi", title: "POs issued", metric: distinctPo(ISSUED), good: "up", onClick: ISSUED, secondary: { metric: sum("issued_aed"), label: "value" } },
      { id: "k_raise", type: "kpi", title: "PRs still to raise", metric: count("pending", { or: [TO_RAISE, NEW_PO] }), good: "down", onClick: { or: [TO_RAISE, NEW_PO] }, secondary: { metric: count("pending", NEW_PO), label: "new POs needed" } },
      { id: "k_suppliers", type: "kpi", title: "Suppliers", metric: { agg: "distinct", field: "supplier", format: "integer" }, good: "none", secondary: { metric: { agg: "distinct", field: "supplier", format: "integer", filter: PENDING }, label: "with a PO pending" } },
      { id: "funnel", type: "funnel", title: "From request to PO", subtitle: "Every PR line, where it stands", stages: [
        { label: "Requests", filter: { field: "lines", op: "eq", value: 1 } }, { label: "PR raised", filter: { field: "pr", op: "notNull" } }, { label: "PO issued", filter: ISSUED, status: "pos" },
      ] },
      { id: "spot", type: "spotlight", title: "Where pending money sits", subtitle: "Biggest in each", metric: sum("pending_aed"), items: [
        { label: "Supplier", dimension: "supplier" }, { label: "Stage", dimension: "stage" }, { label: "Month raised", dimension: "period" }, { label: "Currency", dimension: "currency" },
      ] },
      table({ id: "pending_table", title: "POs pending, oldest first", subtitle: "No PO number in the sheet yet. Click a row for details", filter: PENDING, columns: PENDING_SHORT, sort: { field: "pending_days", dir: "desc" }, pageSize: 25, statusField: "stage", rowLabel: "pending lines" }),
      { id: "by_supplier", type: "bar", title: "Requested by supplier", subtitle: "Issued and pending", dimension: "supplier", metric: sum("amount_aed"), stackBy: "po_status", topN: 12, orientation: "horizontal", colorBy: "status" },
      { id: "by_month", type: "bar", title: "PR lines by month raised", subtitle: "Where they stand now", dimension: "period", metric: count("lines"), stackBy: "stage", sort: "date", orientation: "vertical", colorBy: "status" },
      { id: "age", type: "bar", title: "How long pending POs have waited", subtitle: "Pending lines", dimension: "age_band", metric: count("pending"), filter: PENDING, sort: "order", orientation: "horizontal", colorBy: "single", share: false },
    ], grid: [
      { i: "story", x: 0, y: 0, w: 12, h: 5, minH: 5 },
      { i: "k_pending", x: 0, y: 5, w: 2, h: 3 }, { i: "k_pending_val", x: 2, y: 5, w: 2, h: 3 }, { i: "k_oldest", x: 4, y: 5, w: 2, h: 3 }, { i: "k_raise", x: 6, y: 5, w: 2, h: 3 }, { i: "k_issued", x: 8, y: 5, w: 2, h: 3 }, { i: "k_suppliers", x: 10, y: 5, w: 2, h: 3 },
      { i: "pending_table", x: 0, y: 8, w: 8, h: 17 }, { i: "spot", x: 8, y: 8, w: 4, h: 7 }, { i: "age", x: 8, y: 15, w: 4, h: 6 }, { i: "funnel", x: 8, y: 21, w: 4, h: 4 },
      { i: "by_month", x: 0, y: 25, w: 6, h: 10 }, { i: "by_supplier", x: 6, y: 25, w: 6, h: 10 },
    ],
  };
  const pending: Page = {
    id: "pending", title: "Pending POs", widgets: [
      { id: "p_wait", type: "kpi", title: "PR raised, waiting for PO", metric: count("pending", WAITING), good: "down", onClick: WAITING, secondary: { metric: sum("pending_aed", WAITING), label: "value" } },
      { id: "p_raise", type: "kpi", title: "PR to raise", metric: count("pending", TO_RAISE), good: "down", onClick: TO_RAISE, secondary: { metric: sum("pending_aed", TO_RAISE), label: "value" } },
      { id: "p_new", type: "kpi", title: "New PO needed", metric: count("pending", NEW_PO), good: "down", onClick: NEW_PO, secondary: { metric: { agg: "distinct", field: "supplier", format: "integer", filter: NEW_PO }, label: "suppliers" } },
      { id: "p_30", type: "kpi", title: "Pending over 30 days", metric: count("pending", OVER_30), good: "down", onClick: { and: [PENDING, OVER_30] }, secondary: { metric: sum("pending_aed", OVER_30), label: "value" } },
      { id: "p_alerts", type: "auxTable", title: "What to do next", subtitle: "Every pending line, most urgent first", sheet: "actions", columns: ["priority", "what", "supplier", "value", "waiting", "next"], statusField: "priority", rowLabel: "actions", pageSize: 25 },
      { id: "p_age", type: "bar", title: "How long they have waited", subtitle: "Pending lines", dimension: "age_band", metric: count("pending"), filter: PENDING, sort: "order", orientation: "horizontal", colorBy: "single", share: false },
      { id: "p_supplier", type: "bar", title: "Pending value by supplier", dimension: "supplier", metric: sum("pending_aed"), filter: PENDING, stackBy: "stage", orientation: "horizontal", colorBy: "status" },
      table({ id: "p_wait_t", title: "PR raised, waiting for the PO", subtitle: "Chase approval", filter: WAITING, columns: PENDING_COLS, sort: { field: "pending_days", dir: "desc" }, pageSize: 20, statusField: "stage", rowLabel: "lines" }),
      table({ id: "p_raise_t", title: "PR still to raise, or a new PO needed", filter: { or: [TO_RAISE, NEW_PO] }, columns: ["line", "supplier", "stage", "for", "amount_aed", "currency", "raised", "next_step"], pageSize: 15, statusField: "stage", rowLabel: "lines" }),
    ], grid: [
      { i: "p_wait", x: 0, y: 0, w: 3, h: 3 }, { i: "p_raise", x: 3, y: 0, w: 3, h: 3 }, { i: "p_new", x: 6, y: 0, w: 3, h: 3 }, { i: "p_30", x: 9, y: 0, w: 3, h: 3 },
      { i: "p_alerts", x: 0, y: 3, w: 12, h: 16 },
      { i: "p_age", x: 0, y: 19, w: 5, h: 9 }, { i: "p_supplier", x: 5, y: 19, w: 7, h: 9 },
      { i: "p_wait_t", x: 0, y: 28, w: 12, h: 14 }, { i: "p_raise_t", x: 0, y: 42, w: 12, h: 8 },
    ],
  };
  const issued: Page = {
    id: "issued", title: "Issued POs", widgets: [
      { id: "i_count", type: "kpi", title: "POs issued", metric: distinctPo(ISSUED), good: "up", secondary: { metric: count("issued"), label: "PR lines" } },
      { id: "i_value", type: "kpi", title: "PO value", metric: sum("issued_aed"), good: "none", secondary: { metric: share("issued_aed", "amount_aed"), label: "of all requested" } },
      { id: "i_avg", type: "kpi", title: "Average PO line", metric: { agg: "avg", field: "issued_aed", format: "currency", currency: "AED" }, good: "none", secondary: { metric: { agg: "max", field: "issued_aed", format: "currency", currency: "AED" }, label: "largest" } },
      { id: "i_latest", type: "kpi", title: "Suppliers with a PO", metric: { agg: "distinct", field: "supplier", format: "integer", filter: ISSUED }, good: "none", secondary: { metric: { agg: "distinct", field: "currency", format: "integer", filter: ISSUED }, label: "currencies" } },
      { id: "i_month", type: "bar", title: "PO value by month raised", dimension: "period", metric: sum("issued_aed"), filter: ISSUED, stackBy: "currency", sort: "date", orientation: "vertical", colorBy: "categorical" },
      { id: "i_series", type: "bar", title: "By PO number series", subtitle: "4600… older, 5800… since late July, 9700… small orders", dimension: "po_series", metric: count("issued"), filter: ISSUED, orientation: "horizontal", colorBy: "categorical" },
      { id: "i_currency", type: "bar", title: "By currency (in AED)", dimension: "currency", metric: sum("issued_aed"), filter: ISSUED, orientation: "horizontal", colorBy: "categorical" },
      table({ id: "i_register", title: "PO register", subtitle: "One line per PO; PRs on it rolled up", filter: ISSUED, groupBy: "po", columns: ["po", "supplier", "pr", "currency", "amount", "amount_aed", "raised", "pattern"], sort: { field: "amount_aed", dir: "desc" }, pageSize: 25, search: true, rowLabel: "POs" }),
    ], grid: [
      { i: "i_count", x: 0, y: 0, w: 3, h: 3 }, { i: "i_value", x: 3, y: 0, w: 3, h: 3 }, { i: "i_avg", x: 6, y: 0, w: 3, h: 3 }, { i: "i_latest", x: 9, y: 0, w: 3, h: 3 },
      { i: "i_month", x: 0, y: 3, w: 6, h: 9 }, { i: "i_series", x: 6, y: 3, w: 3, h: 9 }, { i: "i_currency", x: 9, y: 3, w: 3, h: 9 },
      { i: "i_register", x: 0, y: 12, w: 12, h: 14 },
    ],
  };
  const suppliers: Page = {
    id: "suppliers", title: "Suppliers", widgets: [
      table({ id: "s_table", title: "Every supplier", subtitle: "Issued, pending and the longest wait", groupBy: "supplier", columns: ["supplier", "lines", "issued", "issued_aed", "pending", "pending_aed", "pending_days", "currency"], sort: { field: "amount_aed", dir: "desc" }, pageSize: 50, search: true, rowLabel: "suppliers" }),
      { id: "s_bar", type: "bar", title: "Value by supplier", dimension: "supplier", metric: sum("amount_aed"), stackBy: "po_status", orientation: "horizontal", colorBy: "status" },
      { id: "s_tree", type: "treemap", title: "Share of requested value", dimension: "supplier", groupBy: "po_status", metric: sum("amount_aed") },
    ], grid: [{ i: "s_table", x: 0, y: 0, w: 12, h: 13 }, { i: "s_bar", x: 0, y: 13, w: 5, h: 15 }, { i: "s_tree", x: 5, y: 13, w: 7, h: 15 }],
  };
  const links: Page = {
    id: "links", title: "PR → PO links", widgets: [
      { id: "l_pattern", type: "bar", title: "How each PR became a PO", dimension: "pattern", metric: count("lines"), sort: "order", orientation: "horizontal", colorBy: "categorical" },
      { id: "l_pattern_v", type: "bar", title: "Value by pattern", dimension: "pattern", metric: sum("amount_aed"), sort: "order", orientation: "horizontal", colorBy: "categorical" },
      table({ id: "l_multi_pr", title: "POs that cover several PRs", filter: { field: "prs_on_po", op: "gt", value: 1 }, columns: ["po", "pr", "supplier", "currency", "amount", "amount_aed", "raised"], sort: { field: "po", dir: "asc" }, pageSize: 20, rowLabel: "lines" }),
      table({ id: "l_multi_po", title: "PRs spread over several POs, or posted in parts", filter: { or: [{ field: "pos_on_pr", op: "gt", value: 1 }, is("pattern", "One PR, one PO, in parts")] }, columns: ["pr", "po", "supplier", "currency", "amount", "amount_aed", "raised"], sort: { field: "pr", dir: "asc" }, pageSize: 20, rowLabel: "lines" }),
    ], grid: [{ i: "l_pattern", x: 0, y: 0, w: 6, h: 7 }, { i: "l_pattern_v", x: 6, y: 0, w: 6, h: 7 }, { i: "l_multi_pr", x: 0, y: 7, w: 6, h: 11 }, { i: "l_multi_po", x: 6, y: 7, w: 6, h: 11 }],
  };
  const checks: Page = {
    id: "checks", title: "Checks", widgets: [
      { id: "c_checks", type: "auxTable", title: "Worth a look in the sheet", subtitle: "Numbers and names that do not add up", sheet: "checks", columns: ["check", "rows", "detail", "todo"], rowLabel: "checks", pageSize: 30 },
      { id: "c_recon", type: "auxTable", title: "Against the sheet", subtitle: "What the dashboard counts and why", sheet: "reconciliation", columns: ["check", "report", "sheet", "note"], rowLabel: "lines", pageSize: 30 },
      table({ id: "c_rows", title: "Lines with a check", filter: CHECKED, columns: ["line", "supplier", "po", "reg", "check", "amount_aed", "raised"], pageSize: 20, rowLabel: "lines" }),
    ], grid: [{ i: "c_checks", x: 0, y: 0, w: 12, h: 10 }, { i: "c_recon", x: 0, y: 10, w: 12, h: 10 }, { i: "c_rows", x: 0, y: 20, w: 12, h: 10 }],
  };
  const register: Page = {
    id: "register", title: "Register", widgets: [
      table({ id: "register", title: "Every PR line", columns: ["line", "raised", "period", "supplier", "reg", "pr", "po", "bu", "currency", "amount", "amount_aed", "po_status", "stage", "pending_days", "status_typed", "next_step", "srn_done", "balance"], sort: { field: "source_row", dir: "desc" }, search: true, pageSize: 50, statusField: "stage" }),
    ], grid: [{ i: "register", x: 0, y: 0, w: 12, h: 18 }],
  };
  const quality: Page = { id: "quality", title: "Data quality", widgets: [{ id: "quality", type: "quality", title: "Data quality" }], grid: [{ i: "quality", x: 0, y: 0, w: 12, h: 16 }] };
  return {
    version: 1, dateField: "period_start", datePresets: false, pages: [overview, pending, issued, suppliers, links, checks, register, quality],
    filters: [
      { kind: "select", field: "period", label: "Month" }, { kind: "select", field: "supplier", label: "Supplier" }, { kind: "select", field: "po_status", label: "PO status" },
      { kind: "select", field: "stage", label: "Stage" }, { kind: "select", field: "currency", label: "Currency" }, { kind: "search", field: "line", label: "PR / PO" },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Secondary sheets: the action list, the checks and the reconciliation with the sheet.

export function prpoAux(wb: ParsedWorkbook): Record<string, AuxSheet> {
  const sheet = wb.sheets.find((s) => s.name === PRPO_SHEET);
  if (!sheet) return {};
  const rows = sheet.rows.map((r) => r.cells);
  const counted = rows.filter((r) => !r["Excluded because"]);
  const now = Date.now();
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  const sumOf = (rs: typeof rows, h: string) => rs.reduce((a, r) => a + (typeof r[h] === "number" ? (r[h] as number) : 0), 0);

  // What to do next: every pending line, most urgent first.
  const actions = counted.filter((r) => r["PO status"] === "PO pending").map((r) => {
    const raised = typeof r["Pending since"] === "string" ? Date.parse(r["Pending since"] as string) : null;
    const atLeast = r["Wait is a minimum"] === "Yes";
    const days = raised !== null ? Math.max(0, Math.floor((now - raised) / 86_400_000)) : null;
    const value = typeof r["Amount (AED)"] === "number" ? (r["Amount (AED)"] as number) : null;
    const stage = r["Stage"] as string;
    const priority = stage === "New PO needed" ? "Plan" : (days !== null && days > 30) || (value !== null && value >= 1_000_000) ? "Act now" : days === null ? "Check" : days > 7 ? "This week" : "On track";
    const what = stage === "Waiting for PO" ? `PR ${r["PR"]} has no PO yet` : stage === "PR to raise" ? "No PR raised yet" : `New PO needed${r["For"] ? ` for ${r["For"]}` : ""}`;
    return { priority, what, supplier: (r["Supplier"] as string | null) ?? null, value, waiting: days === null ? (stage === "New PO needed" ? "–" : "Not dated") : atLeast ? `Over ${days} days` : days === 1 ? "1 day" : `${days} days`, next: (r["Next step"] as string | null) ?? null, _days: days ?? -1, _p: ["Act now", "This week", "Check", "On track", "Plan"].indexOf(priority) };
  }).sort((a, b) => a._p - b._p || b._days - a._days || (b.value ?? 0) - (a.value ?? 0)).map(({ _days, _p, ...a }) => a);

  // Checks.
  const byCheck = new Map<string, number[]>();
  for (const r of rows) for (const c of String(r["Check"] ?? "").split("; ").filter(Boolean)) (byCheck.get(c.startsWith("Registration no is") ? "Registration no of another supplier" : c) ?? byCheck.set(c.startsWith("Registration no is") ? "Registration no of another supplier" : c, []).get(c.startsWith("Registration no is") ? "Registration no of another supplier" : c)!).push(r["Sheet row"] as number);
  const dupes = rows.filter((r) => r["Excluded because"]);
  const detail: Record<string, [string, string]> = {
    "PO number outside its series": ["Far from every other PO number of its series; likely a digit missed.", "Check the PO number in the ERP."],
    "PR number outside its series": ["Far from every other PR number of its series; likely a digit added.", "Check the PR number in the ERP."],
    "Registration no of another supplier": ["The registration number is used by another supplier on most rows.", "Correct the registration number."],
    "Registration no equals the PR no": ["The registration number is the same as the PR number.", "Type the supplier's registration number."],
    "No registration no": ["The supplier has no registration number on this line.", "Add it once the supplier is registered."],
    "No supplier named": ["A person was typed in the supplier column; the name is not shown.", "Type the supplier the PR is for."],
    "No BU": ["The business unit is blank.", "Add the BU (CBD on every other line)."],
  };
  const checks = [...byCheck.entries()].map(([check, rs]) => ({ check, rows: rs.join(", "), detail: detail[check]?.[0] ?? null, todo: detail[check]?.[1] ?? null }));
  if (dupes.length) checks.unshift({ check: "Line typed twice", rows: dupes.map((r) => r["Sheet row"]).join(", "), detail: dupes.map((r) => r["Excluded because"]).join("; "), todo: "Delete the repeat; the dashboard counts it once." });
  const srnFilled = rows.some((r) => r["SRN done (AED)"] !== null) || rows.some((r) => r["Balance (AED)"] !== null);
  if (!srnFilled) checks.push({ check: "SRN done and Balance PO are empty", rows: "all", detail: "Without them the dashboard cannot show how much of each PO is used.", todo: "Fill SRN done per PO; the balance and usage pages light up on the next upload." });

  // Reconciliation.
  const typed = new Map<string, number>(); for (const r of rows) { const s = (r["Status as typed"] as string) ?? "(blank)"; typed.set(s, (typed.get(s) ?? 0) + 1); }
  const byCur = new Map<string, number>(); for (const r of counted) if (typeof r["Amount"] === "number") byCur.set((r["Currency"] as string) ?? "AED", (byCur.get((r["Currency"] as string) ?? "AED") ?? 0) + (r["Amount"] as number));
  const conflicts = rows.filter((r) => String(r["Corrections"] ?? "").includes("\"field\":\"po_status\"")).length;
  const stageCount = (s: string) => counted.filter((r) => r["Stage"] === s).length;
  const pivot = Object.entries(wb.grids ?? {}).find(([k]) => k !== sheet.name && !/^po\s*$/i.test(k) && Array.isArray(wb.grids?.[k]))?.[1];
  const reconciliation = [
    { check: "Rows in the sheet", report: String(rows.length), sheet: String(rows.length), note: dupes.length ? `${dupes.length} typed twice and counted once: ${counted.length} PR lines.` : "Every row counted." },
    { check: "Status as typed", report: [...typed.entries()].map(([k, v]) => `${k} ${v}`).join(" · "), sheet: null, note: `Counted from the PO column: ${stageCount("PO issued")} with a PO, ${stageCount("Waiting for PO")} PR raised and waiting, ${stageCount("PR to raise")} PR to raise, ${stageCount("New PO needed")} new PO needed. ${conflicts ? `${conflicts} lines where the typed status disagrees with the PO column (the PO column wins; listed on Data quality).` : "The typed status agrees with the PO column on every line."}` },
    { check: "Amounts by currency (as typed)", report: [...byCur.entries()].map(([k, v]) => `${k} ${fmt(v)}`).join(" · "), sheet: null, note: "Added in AED at USD 3.6725, SAR 0.979, EUR 4.28." },
    { check: "Total requested (AED)", report: fmt(sumOf(counted, "Amount (AED)")), sheet: null, note: `Issued ${fmt(sumOf(counted, "Issued (AED)"))}, pending ${fmt(sumOf(counted, "Pending (AED)"))}. ${counted.filter((r) => r["Amount"] === null).length} lines have no amount (new POs to create).` },
    { check: "Dates", report: `${counted.filter((r) => r["Date source"] === "Typed").length} dated`, sheet: null, note: `Dates start on the first dated row; ${counted.filter((r) => r["Date source"] === "Before dating began").length} earlier rows are grouped as "Before" that date, ${counted.filter((r) => r["Date source"] === "From the row above").length} later rows without a date take the month of the row above.` },
    ...(pivot ? [{ check: "Supplier list sheet (pivot)", report: "Not used", sheet: null, note: "A pivot of registration number × supplier built from the log; it is not refreshed after new rows, so newer suppliers are missing and it repeats the registration slip of the log. The dashboard reads suppliers from the log itself." }] : []),
  ];

  return {
    actions: { id: "actions", label: "What to do next", columns: [
      { id: "priority", label: "Priority", type: "string" }, { id: "what", label: "What", type: "string" }, { id: "supplier", label: "Supplier", type: "string" }, { id: "value", label: "Value (AED)", type: "number", format: "currency" },
      { id: "waiting", label: "Waiting", type: "string" }, { id: "next", label: "Next step", type: "string", wrap: true },
    ], rows: actions },
    checks: { id: "checks", label: "Checks", columns: [{ id: "check", label: "Check", type: "string" }, { id: "rows", label: "Sheet rows", type: "string" }, { id: "detail", label: "What it means", type: "string", wrap: true }, { id: "todo", label: "What to do", type: "string", wrap: true }], rows: checks },
    reconciliation: { id: "reconciliation", label: "Reconciliation", columns: [{ id: "check", label: "Check", type: "string" }, { id: "report", label: "This report", type: "string" }, { id: "sheet", label: "In the sheet", type: "string" }, { id: "note", label: "Note", type: "string", wrap: true }], rows: reconciliation },
  };
}

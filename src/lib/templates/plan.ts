import type { AuxSheet, ColumnValue, Field, FilterExpr, ParsedSheet, ParsedWorkbook, RawCell, RawRow, SchemaMap } from "@/lib/schema/types";
import { cleanText, normKey } from "@/lib/schema/types";
import { toDate } from "@/lib/schema/normalize";
import { readCountry, readPort, title } from "@/lib/templates/quotes";
import type { Layout, Page, Widget } from "@/lib/dashboard/types";
import type { MetricSpec } from "@/lib/engine/metrics";

/**
 * Shipping (loading) plan: the sheet a logistics team keeps of every export lane it is working on this month. One row
 * = one lane (sales person · country · port · carrier · container type) with the containers planned for it and how far
 * they have got, as cumulative counts: Total container → Rate given to sales → Sales confirmed rate → Booking placed
 * → Empty pick up → Loaded. Plus the loading date and place, a Pending to ship count, "Planned" and "SO ready" counts,
 * a stock readiness note and a remark saying what the lane is waiting for. A "Shipping Summary" sheet carries the
 * owner's weekly country summary; earlier versions of the plan are kept as hidden tabs (not read).
 *
 * What the preparation keeps true:
 * - One tidy row per lane with a key that survives re-sorting ("Oct 2026 · Indonesia · Jakarta · 40HC"), so a month
 *   uploaded again replaces exactly that month (monthly cadence in src/lib/data/uploads.ts). The month is the plan's
 *   month: from the tab's date or month word, else the title row ("October Shipping Plan till 15/10/2026"), else the
 *   loading dates, else the upload date (noted).
 * - Country and port spellings are folded with the correction noted; "India ( Bait)" becomes India with the customer;
 *   a country typed in the port column (Uganda, Zambia) is moved to the country.
 * - Container types are folded (40HC / 40 HC); trailer, tonnage and truck types count as trucks, not containers.
 * - The step counts are cumulative in the sheet, so blank means none yet (0). A later step larger than an earlier one
 *   is kept as typed and noted. Pending = planned − loaded (how the sheet's own Grand Total works); a typed Pending
 *   that differs is kept beside it and noted.
 * - Stage = the furthest step any container on the lane reached; Waiting on = who has to act next (Carrier, Sales,
 *   Production, Customer, Logistics), from the remark first, then from the counts.
 */

export const PLAN_SHEET = "Shipping plan";
const HEADERS = [
  "Lane", "Month", "Month start", "Plan date", "Sales", "Customer", "Country", "Region", "Port", "Destination", "Carrier", "Container type", "Unit",
  "Planned", "Rate given", "Rate confirmed", "Booked", "Empties picked", "Loaded", "Pending", "Pending (as typed)", "Planned next", "SO ready", "Stock readiness",
  "Loading date", "Loading place", "Remarks", "Stage", "Waiting on", "Next step", "No rate yet", "Waiting for sales", "To book", "Booked not loaded", "Sheet", "Sheet row", "Corrections",
];
export const STAGES = ["No rate yet", "Rate with sales", "Rate confirmed", "Booked", "Empties picked", "Partly loaded", "Loaded"];
export const WAITING = ["Sales", "Carrier", "Production", "Customer", "Logistics", "Done"];
const UNITS = ["Containers", "Trucks"];
const WINDOWS = ["Past", "Next 7 days", "7–14 days", "Later", "No date"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_WORDS: Record<string, number> = {};
["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].forEach((m, i) => { MONTH_WORDS[m] = i; MONTH_WORDS[m.slice(0, 3)] = i; });
MONTH_WORDS.sept = 8;

type Cols = { sales?: string; country: string; port?: string; carrier?: string; type?: string; total: string; given?: string; confirmed?: string; booked?: string; picked?: string; loaded: string; date?: string; pending?: string; planned?: string; soReady?: string; stock?: string; place?: string; remarks?: string };
const pick = (headers: string[], ...names: string[]) => headers.find((h) => names.includes(normKey(h)));

function planColumns(sheet: ParsedSheet): Cols | null {
  const h = sheet.headers;
  const country = pick(h, "country", "destination country"), total = pick(h, "total container", "total containers", "containers", "total"), loaded = pick(h, "loaded", "loaded container", "loaded containers");
  const given = pick(h, "rate given to sales", "rate given"), booked = pick(h, "booking placed", "booked", "booking");
  if (!country || !total || !loaded || !(given || booked)) return null;
  return {
    sales: pick(h, "sales", "sales person", "salesperson", "sales name"), country, port: pick(h, "destination port", "port", "pod", "destination"), carrier: pick(h, "carrier", "shipping line", "line"),
    type: pick(h, "container type", "type", "equipment"), total, given, confirmed: pick(h, "sales confirmed rate", "rate confirmed", "confirmed rate", "sales confirmed"), booked, picked: pick(h, "empty pick up", "empty pickup", "empties picked", "empty picked"),
    loaded, date: pick(h, "loading date", "load date", "planned loading date"), pending: pick(h, "pending to ship", "pending", "balance"), planned: pick(h, "planned"), soReady: pick(h, "so ready", "so-ready", "sales order ready"),
    stock: pick(h, "stock readiness", "stock", "readiness"), place: pick(h, "loading place", "warehouse", "loading from"), remarks: pick(h, "remarks", "remark", "comments", "status"),
  };
}

/** The prepared sheet, by its own headers. */
export function matchesPlan(headers: string[]): boolean {
  return ["lane", "month start", "rate given", "empties picked", "waiting on"].every((k) => headers.some((h) => normKey(h) === k));
}
export const isPlanSource = (sheet: ParsedSheet): boolean => planColumns(sheet) !== null;

const text = (v: RawCell): string | null => { if (v === null || v === undefined) return null; const s = cleanText(v); return s ? s : null; };
const num = (v: RawCell): number | null => { if (typeof v === "number") return Number.isFinite(v) ? v : null; const s = text(v); if (!s) return null; const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
type Note = { field: string; from: string; to: string; reason: string };

/** The month a plan tab is about: the tab's date or month word, else the title row, else the loading dates, else now. */
function planMonth(sheet: ParsedSheet, grid: RawCell[][] | undefined, c: Cols, now: Date): { month: number; year: number; planDate: number | null; source: "tab" | "title" | "dates" | "assumed" } {
  const fromDate = (s: string): { month: number; year: number; t: number } | null => {
    const m = /(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/.exec(s);
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]) - 1, y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
    return { month: mo, year: y, t: Date.UTC(y, mo, d) };
  };
  const fromWord = (s: string): number | null => { const w = /\b([A-Za-z]{3,9})\b/g; let m: RegExpExecArray | null; while ((m = w.exec(s))) { const i = MONTH_WORDS[m[1].toLowerCase()]; if (i !== undefined) return i; } return null; };
  const yearIn = (s: string): number | null => { const m = /\b(20\d\d)\b/.exec(s); return m ? Number(m[1]) : null; };
  const tab = sheet.name;
  const tabDate = fromDate(tab);
  if (tabDate) return { month: tabDate.month, year: tabDate.year, planDate: tabDate.t, source: "tab" };
  const titleRows = (grid ?? []).slice(0, Math.max(0, sheet.headerRow - 1)).map((r) => r.map((v) => (v === null ? "" : String(v))).join(" ")).filter((s) => s.trim());
  const titleText = titleRows.join(" ");
  const titleDate = fromDate(titleText);
  const tabWord = fromWord(tab);
  if (tabWord !== null) return { month: tabWord, year: yearIn(tab) ?? titleDate?.year ?? now.getUTCFullYear(), planDate: titleDate?.t ?? null, source: "tab" };
  const titleWord = fromWord(titleText);
  if (titleWord !== null) return { month: titleWord, year: yearIn(titleText) ?? titleDate?.year ?? now.getUTCFullYear(), planDate: titleDate?.t ?? null, source: "title" };
  if (titleDate) return { month: titleDate.month, year: titleDate.year, planDate: titleDate.t, source: "title" };
  // Majority month of the loading dates.
  const counts = new Map<string, number>();
  for (const r of sheet.rows) { const t = c.date ? toDate(r.cells[c.date] ?? null) : null; if (t !== null) { const d = new Date(t); const k = `${d.getUTCFullYear()}-${d.getUTCMonth()}`; counts.set(k, (counts.get(k) ?? 0) + 1); } }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) { const [y, m] = best[0].split("-").map(Number); return { month: m, year: y, planDate: null, source: "dates" }; }
  return { month: now.getUTCMonth(), year: now.getUTCFullYear(), planDate: null, source: "assumed" };
}

const CARRIERS: Record<string, string> = { "gt line": "GT Line", "gtline": "GT Line", "cma cgm": "CMA CGM", "cmacgm": "CMA CGM", "evergreen": "Evergreen", "barsan": "Barsan", "noatum": "Noatum", "km ctc": "KMTC", "kmtc": "KMTC", "ekmtc": "KMTC", "al sahaara": "Al Sahaara", "al sahara": "Al Sahaara", "bait al ezz": "Bait Al Ezz", "maersk": "Maersk", "msc": "MSC", "hapag": "Hapag-Lloyd", "hapag lloyd": "Hapag-Lloyd", "hapag-lloyd": "Hapag-Lloyd", "one": "ONE", "cosco": "COSCO", "oocl": "OOCL", "pil": "PIL", "yang ming": "Yang Ming" };
const PLACES: Record<string, string> = { "al saad": "Al Saad", "alsaad": "Al Saad", "al sad": "Al Saad", "mirfa": "Mirfa", "al mirfa": "Mirfa" };

/** "40 HC" → 40HC; "40 HR" → 40HC reefer; "Box Trailer" / "500 MT" / "40 Ton" → trucks. */
function readType(v: RawCell): { type: string | null; unit: string } {
  const s = text(v);
  if (!s) return { type: null, unit: "Containers" };
  const k = normKey(s).replace(/\s+/g, "");
  if (/trailer|truck|lorry/.test(k)) return { type: "Box trailer", unit: "Trucks" };
  if (/^\d+(mt|ton|tons|t)$/.test(k)) return { type: `Trucks (${s.replace(/\s+/g, " ")})`, unit: "Trucks" };
  if (/^(40|45)(hc|hq)$/.test(k)) return { type: `${k.slice(0, 2)}HC`, unit: "Containers" };
  if (/^(40|45)(hr|rf|rh|reefer)$/.test(k)) return { type: `${k.slice(0, 2)}HC reefer`, unit: "Containers" };
  if (/^(20|40)(ft|gp|dv|std|')?$/.test(k)) return { type: `${k.slice(0, 2)}FT`, unit: "Containers" };
  if (/^(20|40)(rf|rh|hr|reefer)$/.test(k)) return { type: `${k.slice(0, 2)}FT reefer`, unit: "Containers" };
  if (/^40&20$|^20&40$|^40\+20$/.test(k)) return { type: "40 & 20", unit: "Containers" };
  return { type: s.replace(/\s+/g, " ").toUpperCase(), unit: "Containers" };
}

function readSales(v: RawCell): string | null {
  const s = text(v);
  if (!s) return null;
  return s.split(/\s*[\/&,]\s*/).map((p) => title(cleanText(p))).filter(Boolean).sort((a, b) => a.localeCompare(b)).join(" / ");
}

/** "India ( Bait)" → India + "Bait Al Tamour"; "India ( New Customer)" → India + "New customer". */
function splitCustomer(raw: string): { place: string; customer: string | null } {
  const m = /^(.*?)\s*[\(\[]\s*(.*?)\s*[\)\]]\s*$/.exec(raw);
  if (!m) return { place: raw, customer: null };
  const inside = cleanText(m[2]);
  const k = normKey(inside);
  const customer = /bait/.test(k) ? "Bait Al Tamour" : /new/.test(k) ? "New customer" : /fruit bounty/.test(k) ? "Fruit Bounty" : title(inside);
  return { place: cleanText(m[1]), customer };
}

interface Lane {
  sheet: string; row: number; month: number; year: number; planDate: number | null; monthSource: string; sales: string | null; customer: string | null; country: string | null; region: string | null; port: string | null; destination: string | null;
  carrier: string | null; type: string | null; unit: string; planned: number; given: number; confirmed: number; booked: number; picked: number; loaded: number; pending: number; pendingTyped: number | null; plannedNext: number | null; soReady: number | null;
  stock: string | null; loadingDate: RawCell; place: string | null; remarks: string | null; stage: string; waitingOn: string; nextStep: string; notes: Note[];
}
export interface PlanTotals { planned: number | null; given: number | null; confirmed: number | null; booked: number | null; picked: number | null; loaded: number | null; pending: number | null; soReady: number | null }

const fmtDate = (v: RawCell): string | null => { const t = toDate(v); if (t === null) return null; const d = new Date(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };

function stageOf(l: { planned: number; given: number; confirmed: number; booked: number; picked: number; loaded: number }): string {
  if (l.planned > 0 && l.loaded >= l.planned) return "Loaded";
  if (l.loaded > 0) return "Partly loaded";
  if (l.picked > 0) return "Empties picked";
  if (l.booked > 0) return "Booked";
  if (l.confirmed > 0) return "Rate confirmed";
  if (l.given > 0) return "Rate with sales";
  return "No rate yet";
}

/** Who acts next and what they do: the remark first (it says why the lane is stuck), then the counts. */
function nextOf(l: Omit<Lane, "waitingOn" | "nextStep" | "notes" | "stage">, stage: string): { waitingOn: string; nextStep: string } {
  if (stage === "Loaded") return { waitingOn: "Done", nextStep: "Loaded" };
  const k = normKey(l.remarks);
  const when = fmtDate(l.loadingDate);
  const left = Math.max(0, l.planned - l.loaded);
  if (/rate not (yet )?(rec|receiv)|not yet rec|awaiting rate|waiting (for )?(the )?rate|no rate|rate pending/.test(k)) return { waitingOn: "Carrier", nextStep: "Get the rate from the carrier" };
  if (/truck/.test(k) && /sales/.test(k)) return { waitingOn: "Sales", nextStep: "Sales to confirm so the truck can be placed" };
  if (/sales (to be |to )?confirm|sales reviewing|sales not agreed|waiting for sales|confirmation from sales|rate given to sales|sales to confirm|sales approval|with sales/.test(k)) return { waitingOn: "Sales", nextStep: `Sales to confirm the rate${l.given > l.confirmed ? ` (${l.given - l.confirmed} ${l.unit === "Trucks" ? "trucks" : "containers"})` : ""}` };
  if (/payment/.test(k)) return { waitingOn: "Customer", nextStep: "Waiting for the customer's payment" };
  if (/under loading|loading in progress|balance container/.test(k)) return { waitingOn: "Logistics", nextStep: `Loading in progress (${left} to go)` };
  if (/(product|production|stock|order|sticker).*(read|not ready|pending)|rediness|readiness|not ready/.test(k) && !/production ready|stock ready/.test(k)) return { waitingOn: "Production", nextStep: `Waiting for product to be ready (${left} to load)` };
  if (/returned to factory|reefer/.test(k)) return { waitingOn: "Logistics", nextStep: "Load the reefer container" };
  if (l.given === 0) return { waitingOn: "Carrier", nextStep: "Get the rate from the carrier" };
  if (l.confirmed < l.given) return { waitingOn: "Sales", nextStep: `Sales to confirm the rate (${l.given - l.confirmed} ${l.unit === "Trucks" ? "trucks" : "containers"})` };
  if (l.booked < l.confirmed) return { waitingOn: "Logistics", nextStep: `Place the booking (${l.confirmed - l.booked})` };
  if (l.loaded < l.booked) return { waitingOn: "Logistics", nextStep: when ? `Loading planned ${when}` : "Load the booked containers" };
  return { waitingOn: "Logistics", nextStep: when ? `Loading planned ${when}` : "Plan the loading" };
}

function readLanes(sheet: ParsedSheet, grid: RawCell[][] | undefined, c: Cols, now: Date): { lanes: Lane[]; totals: PlanTotals | null } {
  const pm = planMonth(sheet, grid, c, now);
  const lanes: Lane[] = [];
  let totals: PlanTotals | null = null;
  for (const r of sheet.rows) {
    const cell = (h?: string): RawCell => (h ? r.cells[h] ?? null : null);
    const first = text(cell(c.sales)) ?? text(cell(c.country));
    if (first && /^(grand\s+)?(sub\s*)?total\b/i.test(first)) {
      totals = { planned: num(cell(c.total)), given: num(cell(c.given)), confirmed: num(cell(c.confirmed)), booked: num(cell(c.booked)), picked: num(cell(c.picked)), loaded: num(cell(c.loaded)), pending: num(cell(c.pending)), soReady: num(cell(c.soReady)) };
      continue;
    }
    const countryRaw = text(cell(c.country)), portRaw = text(cell(c.port)), planned = num(cell(c.total));
    if (!countryRaw && !portRaw && planned === null) continue;
    const notes: Note[] = [];
    // Country, with a customer in brackets; a country typed in the port column.
    let customer: string | null = null, countryText = countryRaw, portText = portRaw;
    if (countryRaw) { const sc = splitCustomer(countryRaw); countryText = sc.place; customer = sc.customer; if (sc.customer) notes.push({ field: "country", from: countryRaw, to: `${sc.place} · ${sc.customer}`, reason: "Customer named in brackets moved to its own column" }); }
    let cty = countryText ? readCountry(countryText) : null;
    if (!cty && portRaw) { const asCountry = readCountry(portRaw); if (asCountry && asCountry.region !== "Other") { cty = asCountry; portText = null; notes.push({ field: "country", from: "(blank)", to: asCountry.name, reason: `"${portRaw}" was typed in the port column; read as the country` }); } }
    if (cty && countryText && cty.name !== countryText && cty.region !== "Other") notes.push({ field: "country", from: countryText, to: cty.name, reason: "Country spelling folded" });
    const pd = portText ? readPort(portText, cty?.name ?? null) : { port: null, note: null, mismatch: null };
    if (pd.note && portText) notes.push({ field: "port", from: portText, to: pd.port!, reason: pd.note });
    if (pd.mismatch && portText) notes.push({ field: "port", from: portText, to: pd.port ?? "(kept)", reason: `Port "${portText}" is in ${pd.mismatch}, not ${cty?.name}; kept as typed, worth checking` });
    const portIsCountry = Boolean(portText && cty && (normKey(portText) === normKey(cty.name) || readCountry(portText)?.name === cty.name));
    const port = pd.port ?? (portText && !portIsCountry ? title(portText) : null);
    const destination = cty ? (port ? `${port}, ${cty.name}` : cty.name) : port ?? portRaw;
    const carrierRaw = text(cell(c.carrier));
    const carrier = carrierRaw ? CARRIERS[normKey(carrierRaw)] ?? title(carrierRaw) : null;
    if (carrierRaw && carrier && normKey(carrierRaw) !== normKey(carrier)) notes.push({ field: "carrier", from: carrierRaw, to: carrier, reason: "Carrier name folded" });
    const typeRaw = text(cell(c.type));
    const ty = readType(cell(c.type));
    if (typeRaw && ty.type && normKey(typeRaw) !== normKey(ty.type) && !/^trucks \(/i.test(ty.type)) notes.push({ field: "container_type", from: typeRaw, to: ty.type, reason: ty.unit === "Trucks" ? "Trailer type: counted as trucks" : "Container type folded" });
    const step = (h: string | undefined, label: string, prev: { label: string; value: number } | null): number => {
      const v = num(cell(h)) ?? 0;
      if (prev && v > prev.value && prev.value >= 0) notes.push({ field: normKey(label).replace(/\s+/g, "_"), from: String(v), to: String(v), reason: `${label} (${v}) is more than ${prev.label} (${prev.value}); kept as typed` });
      return Math.max(0, v);
    };
    const p = Math.max(0, planned ?? 0);
    const given = step(c.given, "Rate given", { label: "Planned", value: p });
    const confirmed = step(c.confirmed, "Rate confirmed", { label: "Rate given", value: given });
    const booked = step(c.booked, "Booked", { label: "Rate confirmed", value: confirmed });
    const picked = step(c.picked, "Empties picked", { label: "Booked", value: booked });
    const loaded = step(c.loaded, "Loaded", { label: "Booked", value: booked });
    const pendingTyped = num(cell(c.pending));
    const pending = Math.max(0, p - loaded);
    if (pendingTyped !== null && pendingTyped !== pending) notes.push({ field: "pending", from: String(pendingTyped), to: String(pending), reason: `Pending to ship typed as ${pendingTyped}; planned − loaded is ${pending} (used, as in the sheet's own total)` });
    if (planned === null) notes.push({ field: "planned", from: "(blank)", to: "0", reason: "No container count typed on the lane" });
    const placeRaw = text(cell(c.place));
    const base = {
      sheet: sheet.name, row: r.row, month: pm.month, year: pm.year, planDate: pm.planDate, monthSource: pm.source, sales: readSales(cell(c.sales)), customer, country: cty?.name ?? (countryText ? title(countryText) : null), region: cty?.region ?? null,
      port, destination, carrier, type: ty.type, unit: ty.unit, planned: p, given, confirmed, booked, picked, loaded, pending, pendingTyped, plannedNext: num(cell(c.planned)), soReady: num(cell(c.soReady)),
      stock: text(cell(c.stock)), loadingDate: c.date ? cell(c.date) : null, place: placeRaw ? PLACES[normKey(placeRaw)] ?? title(placeRaw) : null, remarks: text(cell(c.remarks)),
    };
    const stage = stageOf(base);
    const next = nextOf(base, stage);
    lanes.push({ ...base, stage, waitingOn: next.waitingOn, nextStep: next.nextStep, notes });
  }
  return { lanes, totals };
}

/** Merges every plan tab of the workbook into one "Shipping plan" sheet; other workbooks pass through untouched. */
export function preparePlanWorkbook(wb: ParsedWorkbook, now = new Date()): ParsedWorkbook {
  if (wb.sheets.some((s) => s.name === PLAN_SHEET)) return wb;
  const sources = wb.sheets.filter((s) => planColumns(s));
  if (sources.length === 0) return wb;
  // Two tabs for the same month (an older copy of the plan left visible): only the latest-dated one counts.
  const read = sources.map((s, i) => ({ sheet: s, i, lanes: readLanes(s, wb.grids?.[s.name], planColumns(s)!, now).lanes }));
  const byMonth = new Map<string, typeof read>();
  for (const r of read) { const l = r.lanes[0]; const k = l ? `${l.year}-${l.month}` : `tab-${r.i}`; byMonth.set(k, [...(byMonth.get(k) ?? []), r]); }
  const chosen = new Set<number>();
  for (const group of byMonth.values()) { const best = group.slice().sort((a, b) => (b.lanes[0]?.planDate ?? -1) - (a.lanes[0]?.planDate ?? -1) || b.i - a.i)[0]; chosen.add(best.i); }
  const all = read.filter((r) => chosen.has(r.i)).flatMap((r) => r.lanes);
  all.sort((a, b) => a.year - b.year || a.month - b.month || a.row - b.row);
  const seen = new Map<string, number>();
  const rows: RawRow[] = all.map((l, i) => {
    const monthLabel = `${MONTHS[l.month]} ${l.year}`;
    const keyBase = `${monthLabel} · ${l.destination ?? l.country ?? "?"} · ${l.type ?? "?"}`;
    const k = (seen.get(keyBase) ?? 0) + 1;
    seen.set(keyBase, k);
    const notes = [...l.notes];
    if (l.monthSource === "assumed") notes.push({ field: "month", from: "(none)", to: monthLabel, reason: "No month in the tab name, title or loading dates; taken from the upload date" });
    const cells: Record<string, RawCell> = {
      "Lane": k === 1 ? keyBase : `${keyBase} (${k})`, "Month": monthLabel, "Month start": new Date(Date.UTC(l.year, l.month, 1)).toISOString(), "Plan date": l.planDate !== null ? new Date(l.planDate).toISOString() : null,
      "Sales": l.sales, "Customer": l.customer, "Country": l.country, "Region": l.region, "Port": l.port, "Destination": l.destination, "Carrier": l.carrier, "Container type": l.type, "Unit": l.unit,
      "Planned": l.planned, "Rate given": l.given, "Rate confirmed": l.confirmed, "Booked": l.booked, "Empties picked": l.picked, "Loaded": l.loaded, "Pending": l.pending, "Pending (as typed)": l.pendingTyped, "Planned next": l.plannedNext, "SO ready": l.soReady,
      "Stock readiness": l.stock, "Loading date": l.loadingDate, "Loading place": l.place, "Remarks": l.remarks, "Stage": l.stage, "Waiting on": l.waitingOn, "Next step": l.nextStep,
      "No rate yet": Math.max(0, l.planned - l.given), "Waiting for sales": Math.max(0, l.given - l.confirmed), "To book": Math.max(0, l.confirmed - l.booked), "Booked not loaded": Math.max(0, l.booked - l.loaded),
      "Sheet": l.sheet, "Sheet row": l.row, "Corrections": notes.length ? JSON.stringify(notes) : null,
    };
    return { row: i + 2, cells };
  });
  const sheet: ParsedSheet = { name: PLAN_SHEET, headerRow: 1, headers: HEADERS, rows, stats: statsFor(HEADERS, rows), validations: {}, totalRowsInSheet: rows.length + 1 };
  const grids = { ...(wb.grids ?? {}) };
  for (const s of sources) if (!grids[s.name]) grids[s.name] = [s.headers, ...s.rows.map((r) => s.headers.map((h) => r.cells[h] ?? null))];
  return { ...wb, sheets: [sheet, ...wb.sheets.filter((s) => !sources.includes(s))], primary: 0, grids };
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
const cnt = (id: string, label: string, source: string, extra: Partial<Field> = {}): Field => ({ id, label, source, type: "number", role: "measure", format: "integer", aggregate: "sum", ...extra });
const OPEN: FilterExpr = { field: "stage", op: "neq", value: "Loaded" };
const waiting = (who: string): FilterExpr => ({ field: "waiting_on", op: "eq", value: who });

export function planSchema(): SchemaMap {
  const fields: Field[] = [
    { id: "lane", label: "Lane", source: "Lane", type: "string", role: "id" },
    dim("month", "Month", "Month", { semantic: "period" }),
    { id: "month_start", label: "Month", source: "Month start", type: "date", role: "date", format: "date", hidden: true },
    { id: "plan_date", label: "Plan dated", source: "Plan date", type: "date", role: "date", format: "date", hidden: true, description: "The date in the plan's title or tab name" },
    dim("sales", "Sales", "Sales", { semantic: "owner" }),
    dim("customer", "Customer", "Customer", { semantic: "customer" }),
    dim("country", "Country", "Country"),
    dim("region", "Region", "Region", { order: ["Middle East", "Asia", "Europe", "Africa", "Americas", "Oceania"], hidden: true }),
    dim("port", "Port", "Port", { hidden: true }),
    dim("destination", "Destination", "Destination", { semantic: "destination" }),
    dim("carrier", "Carrier", "Carrier"),
    dim("container_type", "Container type", "Container type"),
    dim("unit", "Unit", "Unit", { order: UNITS }),
    cnt("planned", "Planned", "Planned", { semantic: "quantity", description: "Containers (or trucks) on the plan for the lane" }),
    cnt("rate_given", "Rate given", "Rate given", { description: "Of the planned, how many have a rate given to Sales" }),
    cnt("rate_confirmed", "Rate confirmed", "Rate confirmed", { description: "How many Sales confirmed the rate for" }),
    cnt("booked", "Booked", "Booked"),
    cnt("picked", "Empties picked", "Empties picked", { hidden: true }),
    cnt("loaded", "Loaded", "Loaded"),
    cnt("pending", "Pending to ship", "Pending", { description: "Planned − loaded" }),
    cnt("pending_typed", "Pending (as typed)", "Pending (as typed)", { hidden: true }),
    cnt("planned_next", "Planned next", "Planned next", { hidden: true, description: "The sheet's own Planned column" }),
    cnt("so_ready", "SO ready", "SO ready", { hidden: true }),
    txt("stock", "Stock readiness", "Stock readiness", { hidden: true }),
    { id: "loading_date", label: "Loading date", source: "Loading date", type: "date", role: "date", format: "date" },
    dim("loading_place", "Loading place", "Loading place"),
    txt("remarks", "Remarks", "Remarks", { semantic: "remarks" }),
    dim("stage", "Stage", "Stage", { semantic: "status", order: STAGES, description: "The furthest step any container on the lane has reached" }),
    dim("waiting_on", "Waiting on", "Waiting on", { order: WAITING, description: "Who acts next" }),
    txt("next_step", "Next step", "Next step"),
    cnt("n_no_rate", "No rate yet", "No rate yet", { hidden: true, description: "Planned − rate given" }),
    cnt("n_sales", "Waiting for sales", "Waiting for sales", { hidden: true, description: "Rate given − rate confirmed" }),
    cnt("n_to_book", "To book", "To book", { hidden: true, description: "Rate confirmed − booked" }),
    cnt("n_booked_not_loaded", "Booked, not loaded", "Booked not loaded", { hidden: true, description: "Booked − loaded" }),
    txt("source_sheet", "Sheet", "Sheet", { hidden: true }),
    { id: "source_row", label: "Sheet row", source: "Sheet row", type: "number", role: "measure", format: "integer", hidden: true },
    txt("notes", "Corrections", "Corrections", { hidden: true }),
    { id: "lanes", label: "Lanes", source: null, type: "number", role: "measure", format: "integer", aggregate: "sum", hidden: true, derived: { kind: "case", cases: [], fallback: 1 } },
    { id: "n_open", label: "Open lanes", source: null, type: "number", role: "measure", format: "integer", aggregate: "sum", hidden: true, derived: { kind: "case", cases: [{ when: OPEN, value: 1 }], fallback: 0 } },
    { id: "days_to_loading", label: "Days to loading", source: null, type: "number", role: "measure", format: "days", hidden: true, derived: { kind: "daysUntil", from: "loading_date" } },
    { id: "loading_window", label: "Loading window", source: null, type: "string", role: "dimension", order: WINDOWS, hidden: true, derived: { kind: "case", cases: [
      { when: { field: "days_to_loading", op: "lt", value: 0 }, value: "Past" }, { when: { field: "days_to_loading", op: "lt", value: 7 }, value: "Next 7 days" }, { when: { field: "days_to_loading", op: "lt", value: 14 }, value: "7–14 days" }, { when: { field: "days_to_loading", op: "notNull" }, value: "Later" },
    ], fallback: "No date" } },
    { id: "open_status", label: "Open or loaded", source: null, type: "string", role: "dimension", order: ["Open", "Loaded"], hidden: true, derived: { kind: "case", cases: [{ when: OPEN, value: "Open" }], fallback: "Loaded" } },
    { id: "latest", label: "Latest month", source: null, type: "string", role: "dimension", order: ["Latest month", "Earlier"], hidden: true, derived: { kind: "latestPeriod", from: "month_start", unit: "month" } },
  ];
  return { version: 1, sheet: PLAN_SHEET, fields, idField: "lane", primaryDate: "loading_date", noteField: "notes", foldCase: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Layout

const sum = (field: string, filter?: FilterExpr): MetricSpec => ({ agg: "sum", field, format: "integer", ...(filter ? { filter } : {}) });
const lanes = (filter?: FilterExpr): MetricSpec => ({ agg: "count", format: "integer", ...(filter ? { filter } : {}) });
const share = (field: string, over: string, filter?: FilterExpr): MetricSpec => ({ agg: "ratio", field, over, format: "percent", ...(filter ? { filter } : {}) });
const LATEST: FilterExpr = { field: "latest", op: "eq", value: "Latest month" };
const TRUCKS: FilterExpr = { field: "unit", op: "eq", value: "Trucks" };
const table = (w: Omit<Extract<Widget, { type: "table" }>, "type">): Widget => ({ type: "table", statusField: "stage", ...w });
const ACTION_COLUMNS = ["destination", "sales", "customer", "carrier", "container_type", "planned", "loaded", "pending", "loading_date", "next_step", "remarks"];
const LANE_COLUMNS = ["destination", "sales", "customer", "carrier", "container_type", "planned", "rate_confirmed", "booked", "loaded", "pending", "loading_date", "stage", "waiting_on"];

export function planLayout(): Layout {
  const overview: Page = {
    id: "overview", title: "Overview", widgets: [
      { id: "story", type: "story", title: "This month", dateField: "month_start", monthField: "month", metrics: [
        { id: "planned", label: "containers planned", metric: sum("planned"), good: "none" },
        { id: "loaded", label: "loaded", metric: sum("loaded"), good: "up" },
        { id: "pending", label: "still to ship", metric: sum("pending"), good: "down" },
        { id: "sales", label: "waiting for sales", metric: sum("n_sales"), good: "down" },
        { id: "lanes", label: "lanes", metric: lanes(), good: "none" },
      ] },
      { id: "months", type: "months", title: "Month by month", subtitle: "Containers planned, by how far they got. Click a month to see it alone", dateField: "month_start", monthField: "month", metric: sum("planned"), stackBy: "stage" },
      { id: "kpi_planned", type: "kpi", title: "Planned", metric: sum("planned"), good: "none", secondary: { metric: sum("planned", TRUCKS), label: "of them trucks" } },
      { id: "kpi_loaded", type: "kpi", title: "Loaded", metric: sum("loaded"), good: "up", onClick: { field: "stage", op: "in", value: ["Loaded", "Partly loaded"] }, secondary: { metric: share("loaded", "planned"), label: "of planned" } },
      { id: "kpi_pending", type: "kpi", title: "Still to ship", metric: sum("pending"), good: "down", onClick: OPEN, secondary: { metric: lanes(OPEN), label: "open lanes" } },
      { id: "kpi_sales", type: "kpi", title: "Waiting for sales", metric: sum("n_sales"), good: "down", onClick: waiting("Sales"), secondary: { metric: lanes(waiting("Sales")), label: "lanes: rate given, not confirmed" } },
      { id: "kpi_norate", type: "kpi", title: "No rate yet", metric: sum("n_no_rate"), good: "down", onClick: waiting("Carrier"), secondary: { metric: lanes(waiting("Carrier")), label: "lanes waiting for the carrier" } },
      { id: "kpi_booked", type: "kpi", title: "Booked, not loaded", metric: sum("n_booked_not_loaded"), good: "none", onClick: { field: "stage", op: "in", value: ["Booked", "Empties picked", "Partly loaded"] }, secondary: { metric: sum("n_to_book"), label: "confirmed, booking not placed" } },
      { id: "funnel", type: "funnel", title: "Where the containers are", subtitle: "Each step counts the containers that reached it", stages: [
        { label: "Planned", metric: sum("planned"), status: "neutral" }, { label: "Rate given", metric: sum("rate_given"), status: "accent" }, { label: "Confirmed", metric: sum("rate_confirmed"), status: "accent" },
        { label: "Booked", metric: sum("booked"), status: "accent" }, { label: "Empties picked", metric: sum("picked"), status: "accent" }, { label: "Loaded", metric: sum("loaded"), status: "pos" },
      ] },
      { id: "insights", type: "insights", title: "What changed since the last update" },
      { id: "map", type: "map", title: "Where it is going", subtitle: "Dot size = containers planned, colour = share loaded. Click a country to filter", countryField: "country", metric: sum("planned"), executedMetric: sum("loaded"), words: { value: "Planned", done: "Loaded" } },
      { id: "by_waiting", type: "bar", title: "Still to ship, by who acts next", subtitle: "Containers not yet loaded", dimension: "waiting_on", metric: sum("pending"), stackBy: "stage", filter: OPEN, sort: "order", orientation: "horizontal", colorBy: "status" },
      { id: "calendar", type: "line", title: "Loading calendar", subtitle: "By loading week: planned and loaded", dateField: "loading_date", unit: "week", series: [{ label: "Planned", metric: sum("planned"), kind: "bar" }, { label: "Loaded", metric: sum("loaded"), kind: "line" }] },
      { id: "by_sales", type: "bar", title: "By sales person", subtitle: "Containers planned, by how far they got", dimension: "sales", metric: sum("planned"), stackBy: "stage", orientation: "horizontal", colorBy: "status" },
      { id: "by_carrier", type: "bar", title: "By carrier", dimension: "carrier", metric: sum("planned"), stackBy: "stage", orientation: "horizontal", colorBy: "status", includeNull: true },
      { id: "by_type", type: "bar", title: "By equipment", dimension: "container_type", metric: sum("planned"), stackBy: "stage", orientation: "horizontal", colorBy: "status" },
    ], grid: [
      { i: "story", x: 0, y: 0, w: 12, h: 5, minH: 5 }, { i: "months", x: 0, y: 5, w: 12, h: 4, minH: 4 },
      { i: "kpi_planned", x: 0, y: 9, w: 2, h: 3 }, { i: "kpi_loaded", x: 2, y: 9, w: 2, h: 3 }, { i: "kpi_pending", x: 4, y: 9, w: 2, h: 3 }, { i: "kpi_sales", x: 6, y: 9, w: 2, h: 3 }, { i: "kpi_norate", x: 8, y: 9, w: 2, h: 3 }, { i: "kpi_booked", x: 10, y: 9, w: 2, h: 3 },
      { i: "funnel", x: 0, y: 12, w: 6, h: 8 }, { i: "insights", x: 6, y: 12, w: 6, h: 8 },
      { i: "map", x: 0, y: 20, w: 7, h: 12 }, { i: "by_waiting", x: 7, y: 20, w: 5, h: 6 }, { i: "calendar", x: 7, y: 26, w: 5, h: 6 },
      { i: "by_sales", x: 0, y: 32, w: 4, h: 9 }, { i: "by_carrier", x: 4, y: 32, w: 4, h: 9 }, { i: "by_type", x: 8, y: 32, w: 4, h: 9 },
    ],
  };
  const actions: Page = {
    id: "actions", title: "Action list", widgets: [
      { id: "a_sales", type: "kpi", title: "Waiting on Sales", metric: lanes(waiting("Sales")), good: "down", onClick: waiting("Sales"), secondary: { metric: sum("pending", waiting("Sales")), label: "containers held up" } },
      { id: "a_carrier", type: "kpi", title: "Waiting on the carrier", metric: lanes(waiting("Carrier")), good: "down", onClick: waiting("Carrier"), secondary: { metric: sum("pending", waiting("Carrier")), label: "containers without a rate" } },
      { id: "a_prod", type: "kpi", title: "Waiting for product", metric: lanes(waiting("Production")), good: "down", onClick: waiting("Production"), secondary: { metric: sum("pending", waiting("Production")), label: "containers" } },
      { id: "a_log", type: "kpi", title: "With logistics", metric: lanes(waiting("Logistics")), good: "none", onClick: waiting("Logistics"), secondary: { metric: sum("pending", waiting("Logistics")), label: "containers to book or load" } },
      table({ id: "a_sales_t", title: "Sales to confirm", subtitle: "A rate was given; Sales has not confirmed it (or must confirm before a truck is placed)", filter: waiting("Sales"), columns: ACTION_COLUMNS, sort: { field: "pending", dir: "desc" }, pageSize: 20 }),
      table({ id: "a_carrier_t", title: "Rate not received from the carrier", filter: waiting("Carrier"), columns: ACTION_COLUMNS, sort: { field: "pending", dir: "desc" }, pageSize: 15 }),
      table({ id: "a_prod_t", title: "Product not ready", subtitle: "Booked or confirmed, waiting for stock or production", filter: { field: "waiting_on", op: "in", value: ["Production", "Customer"] }, columns: ACTION_COLUMNS, sort: { field: "loading_date", dir: "asc" }, pageSize: 15 }),
      table({ id: "a_log_t", title: "Logistics: book and load", subtitle: "Confirmed lanes to book, booked lanes to load", filter: waiting("Logistics"), columns: ACTION_COLUMNS, sort: { field: "loading_date", dir: "asc" }, pageSize: 20 }),
    ], grid: [
      { i: "a_sales", x: 0, y: 0, w: 3, h: 3 }, { i: "a_carrier", x: 3, y: 0, w: 3, h: 3 }, { i: "a_prod", x: 6, y: 0, w: 3, h: 3 }, { i: "a_log", x: 9, y: 0, w: 3, h: 3 },
      { i: "a_sales_t", x: 0, y: 3, w: 12, h: 11 }, { i: "a_carrier_t", x: 0, y: 14, w: 12, h: 7 }, { i: "a_prod_t", x: 0, y: 21, w: 12, h: 6 }, { i: "a_log_t", x: 0, y: 27, w: 12, h: 11 },
    ],
  };
  const schedule: Page = {
    id: "schedule", title: "Loading schedule", widgets: [
      { id: "s_week", type: "kpi", title: "Loading in the next 7 days", metric: sum("pending", { and: [OPEN, { field: "loading_window", op: "eq", value: "Next 7 days" }] }), good: "none", onClick: { and: [OPEN, { field: "loading_window", op: "eq", value: "Next 7 days" }] }, secondary: { metric: lanes({ and: [OPEN, { field: "loading_window", op: "eq", value: "Next 7 days" }] }), label: "lanes" } },
      { id: "s_next", type: "kpi", title: "In 7–14 days", metric: sum("pending", { and: [OPEN, { field: "loading_window", op: "eq", value: "7–14 days" }] }), good: "none", onClick: { and: [OPEN, { field: "loading_window", op: "eq", value: "7–14 days" }] }, secondary: { metric: sum("pending", { and: [OPEN, { field: "loading_window", op: "eq", value: "Later" }] }), label: "later than that" } },
      { id: "s_past", type: "kpi", title: "Loading date passed, not loaded", metric: sum("pending", { and: [OPEN, { field: "loading_window", op: "eq", value: "Past" }] }), good: "down", onClick: { and: [OPEN, { field: "loading_window", op: "eq", value: "Past" }] }, secondary: { metric: lanes({ and: [OPEN, { field: "loading_window", op: "eq", value: "Past" }] }), label: "lanes to update or re-plan" } },
      { id: "s_nodate", type: "kpi", title: "No loading date yet", metric: sum("pending", { and: [OPEN, { field: "loading_window", op: "eq", value: "No date" }] }), good: "down", onClick: { and: [OPEN, { field: "loading_window", op: "eq", value: "No date" }] }, secondary: { metric: lanes({ and: [OPEN, { field: "loading_window", op: "eq", value: "No date" }] }), label: "lanes" } },
      { id: "s_window", type: "bar", title: "Still to ship, by loading window", dimension: "loading_window", metric: sum("pending"), stackBy: "waiting_on", filter: OPEN, sort: "order", orientation: "horizontal", colorBy: "categorical" },
      { id: "s_place", type: "bar", title: "By loading place", subtitle: "Containers planned per warehouse", dimension: "loading_place", metric: sum("planned"), stackBy: "stage", orientation: "horizontal", colorBy: "status", includeNull: true },
      table({ id: "s_soon", title: "Loading in the next 14 days", filter: { and: [OPEN, { field: "loading_window", op: "in", value: ["Next 7 days", "7–14 days"] }] }, columns: ["loading_date", "destination", "sales", "carrier", "container_type", "planned", "loaded", "pending", "loading_place", "waiting_on", "next_step"], sort: { field: "loading_date", dir: "asc" }, pageSize: 20 }),
      table({ id: "s_past_t", title: "Loading date passed", subtitle: "Still not fully loaded: update the sheet or re-plan", filter: { and: [OPEN, { field: "loading_window", op: "eq", value: "Past" }] }, columns: ["loading_date", "destination", "sales", "carrier", "planned", "loaded", "pending", "waiting_on", "next_step", "remarks"], sort: { field: "loading_date", dir: "asc" }, pageSize: 15 }),
      table({ id: "s_done", title: "Loaded", subtitle: "Lanes fully loaded", filter: { field: "stage", op: "eq", value: "Loaded" }, columns: ["loading_date", "destination", "sales", "customer", "carrier", "container_type", "loaded", "loading_place", "remarks"], sort: { field: "loading_date", dir: "desc" }, pageSize: 20 }),
    ], grid: [
      { i: "s_week", x: 0, y: 0, w: 3, h: 3 }, { i: "s_next", x: 3, y: 0, w: 3, h: 3 }, { i: "s_past", x: 6, y: 0, w: 3, h: 3 }, { i: "s_nodate", x: 9, y: 0, w: 3, h: 3 },
      { i: "s_window", x: 0, y: 3, w: 6, h: 7 }, { i: "s_place", x: 6, y: 3, w: 6, h: 7 },
      { i: "s_soon", x: 0, y: 10, w: 12, h: 8 }, { i: "s_past_t", x: 0, y: 18, w: 12, h: 9 }, { i: "s_done", x: 0, y: 27, w: 12, h: 10 },
    ],
  };
  const monthly: Page = {
    id: "monthly", title: "Monthly", widgets: [
      { id: "m_planned", type: "kpi", title: "Latest month · planned", metric: sum("planned", LATEST), good: "none", onClick: LATEST, secondary: { metric: lanes(LATEST), label: "lanes" } },
      { id: "m_loaded", type: "kpi", title: "Latest month · loaded", metric: sum("loaded", LATEST), good: "up", onClick: { and: [LATEST, { field: "stage", op: "in", value: ["Loaded", "Partly loaded"] }] }, secondary: { metric: share("loaded", "planned", LATEST), label: "of planned" } },
      { id: "m_pending", type: "kpi", title: "Latest month · still to ship", metric: sum("pending", LATEST), good: "down", onClick: { and: [LATEST, OPEN] }, secondary: { metric: sum("n_sales", LATEST), label: "waiting for sales" } },
      { id: "m_countries", type: "kpi", title: "Latest month · countries", metric: { agg: "distinct", field: "country", format: "integer", filter: LATEST }, good: "none", secondary: { metric: { agg: "distinct", field: "carrier", format: "integer", filter: LATEST }, label: "carriers" } },
      table({ id: "month_table", title: "Month by month", subtitle: "Every month on the dashboard", groupBy: "month", rowLabel: "months", columns: ["month", "lanes", "planned", "rate_given", "rate_confirmed", "booked", "loaded", "pending", "n_sales", "n_no_rate"], sort: { field: "month_start", dir: "desc" }, pageSize: 24 }),
      { id: "m_stage", type: "bar", title: "Stage by month", subtitle: "Containers planned, by how far they got", dimension: "month", metric: sum("planned"), stackBy: "stage", sort: "date", orientation: "vertical", colorBy: "status" },
      { id: "m_waiting", type: "bar", title: "Who holds things up, by month", subtitle: "Containers still to ship", dimension: "month", metric: sum("pending"), stackBy: "waiting_on", filter: OPEN, sort: "date", orientation: "vertical", colorBy: "categorical" },
      { id: "m_country", type: "bar", title: "Top countries by month", dimension: "country", metric: sum("planned"), stackBy: "month", topN: 12, orientation: "horizontal", colorBy: "categorical" },
      table({ id: "m_lanes", title: "Lanes in the latest month", filter: LATEST, columns: LANE_COLUMNS, sort: { field: "pending", dir: "desc" }, pageSize: 25, search: true }),
    ], grid: [
      { i: "m_planned", x: 0, y: 0, w: 3, h: 3 }, { i: "m_loaded", x: 3, y: 0, w: 3, h: 3 }, { i: "m_pending", x: 6, y: 0, w: 3, h: 3 }, { i: "m_countries", x: 9, y: 0, w: 3, h: 3 },
      { i: "month_table", x: 0, y: 3, w: 12, h: 6 },
      { i: "m_stage", x: 0, y: 10, w: 6, h: 9 }, { i: "m_waiting", x: 6, y: 10, w: 6, h: 9 }, { i: "m_country", x: 0, y: 19, w: 12, h: 9 },
      { i: "m_lanes", x: 0, y: 28, w: 12, h: 14 },
    ],
  };
  const summary: Page = {
    id: "summary", title: "Weekly summary", widgets: [
      { id: "summary", type: "auxTable", title: "The owner's weekly summary", subtitle: "The Shipping Summary sheet as it is in the workbook, block by block", sheet: "summary", columns: ["block", "customer", "planned", "loaded", "under_planning", "total", "planning_to_ship", "remarks"], rowLabel: "lines", pageSize: 40 },
      { id: "recon", type: "auxTable", title: "Against the sheet's own totals", subtitle: "What the dashboard counts next to the Grand Total row and the summary sheet", sheet: "reconciliation", columns: ["check", "report", "sheet", "note"], rowLabel: "checks", pageSize: 30 },
    ], grid: [{ i: "summary", x: 0, y: 0, w: 12, h: 16 }, { i: "recon", x: 0, y: 16, w: 12, h: 13 }],
  };
  const register: Page = {
    id: "register", title: "Register", widgets: [
      table({ id: "register", title: "All lanes", columns: ["lane", "month", "sales", "customer", "country", "destination", "carrier", "container_type", "unit", "planned", "rate_given", "rate_confirmed", "booked", "picked", "loaded", "pending", "pending_typed", "planned_next", "so_ready", "stock", "loading_date", "loading_place", "stage", "waiting_on", "next_step", "remarks"], sort: { field: "month_start", dir: "desc" }, search: true, pageSize: 50 }),
    ], grid: [{ i: "register", x: 0, y: 0, w: 12, h: 18 }],
  };
  const quality: Page = { id: "quality", title: "Data quality", widgets: [{ id: "quality", type: "quality", title: "Data quality" }], grid: [{ i: "quality", x: 0, y: 0, w: 12, h: 16 }] };
  return {
    version: 1, dateField: "loading_date",
    pages: [overview, actions, schedule, monthly, summary, register, quality],
    filters: [
      { kind: "select", field: "month", label: "Month" }, { kind: "select", field: "sales", label: "Sales" }, { kind: "select", field: "country", label: "Country" }, { kind: "select", field: "carrier", label: "Carrier" },
      { kind: "select", field: "waiting_on", label: "Waiting on" }, { kind: "select", field: "stage", label: "Stage" }, { kind: "search", field: "destination", label: "Search" },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Secondary sheets: the owner's weekly summary, and a reconciliation against the plan's Grand Total row

const fmt = (n: number) => n.toLocaleString("en-US");
const dateLabel = (v: RawCell): string | null => { const t = toDate(v); if (t === null) return null; const d = new Date(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };

/** The "Shipping Summary" sheet: blocks headed "Country: | Planned | Loaded | Under Planning | Total | Planning to ship | Remarks", each preceded by a date cell. */
function readSummary(grid: RawCell[][]): Record<string, ColumnValue>[] {
  const out: Record<string, ColumnValue>[] = [];
  let cols: { customer: number; planned: number; loaded: number; under: number; total: number; when: number; remarks: number } | null = null;
  let block = "Undated block", blockNo = 0, pendingDate: string | null = null;
  for (const r of grid) {
    const first = normKey(r[0]);
    if (!first) { if (r.every((v) => v === null || v === "")) continue; }
    if (/^country/.test(first)) {
      const idx = (re: RegExp) => r.findIndex((v) => re.test(normKey(v)));
      cols = { customer: 0, planned: idx(/^planned/), loaded: idx(/^loaded/), under: idx(/^under planning/), total: idx(/^total/), when: idx(/^plann?ig? to|^planning to|^plan to/), remarks: idx(/^remarks?/) };
      blockNo++;
      block = pendingDate ? `Dated ${pendingDate}` : blockNo === 1 ? "First block (no date)" : `Block ${blockNo} (no date)`;
      pendingDate = null;
      continue;
    }
    if (!cols) { const d = dateLabel(r[0]); if (d) pendingDate = d; continue; }
    const label = text(r[0]);
    if (!label) { const d = dateLabel(r.find((v) => v !== null && v !== "") ?? null); if (d) { pendingDate = d; cols = null; } continue; }
    const at = (i: number): RawCell => (i >= 0 ? r[i] ?? null : null);
    const whenRaw = at(cols.when);
    const when = typeof whenRaw === "string" && /^\d{4}-\d{2}-\d{2}T/.test(whenRaw) ? dateLabel(whenRaw) : text(whenRaw);
    out.push({ block, customer: /^total$/i.test(label) ? "Total" : label, planned: num(at(cols.planned)), loaded: num(at(cols.loaded)), under_planning: num(at(cols.under)), total: num(at(cols.total)), planning_to_ship: when, remarks: text(at(cols.remarks)) });
    if (/^total$/i.test(label)) { cols = null; }
  }
  return out;
}

export function planAux(wb: ParsedWorkbook): Record<string, AuxSheet> {
  const sheet = wb.sheets.find((s) => s.name === PLAN_SHEET);
  if (!sheet) return {};
  const rows = sheet.rows.map((r) => r.cells);
  const out: Record<string, AuxSheet> = {};
  // The summary sheet, as a table.
  const summaryName = Object.keys(wb.grids ?? {}).find((k) => /summary/i.test(k) && wb.grids![k].some((r) => /^country/.test(normKey(r[0]))));
  const summaryRows = summaryName ? readSummary(wb.grids![summaryName]) : [];
  if (summaryRows.length) {
    out.summary = {
      id: "summary", label: "Weekly summary",
      columns: [
        { id: "block", label: "Block", type: "string" }, { id: "customer", label: "Country / customer", type: "string" }, { id: "planned", label: "Planned", type: "number", format: "integer" }, { id: "loaded", label: "Loaded", type: "number", format: "integer" },
        { id: "under_planning", label: "Under planning", type: "number", format: "integer" }, { id: "total", label: "Total", type: "number", format: "integer" }, { id: "planning_to_ship", label: "Planning to ship", type: "string" }, { id: "remarks", label: "Remarks", type: "string", wrap: true },
      ],
      rows: summaryRows,
    };
  }
  // Reconciliation against each plan tab's Grand Total row.
  const checks: Record<string, ColumnValue>[] = [];
  const add = (check: string, report: string, sheetValue: string | null, note: string) => checks.push({ check, report, sheet: sheetValue, note });
  const sumOf = (h: string, pred?: (r: Record<string, RawCell>) => boolean) => rows.filter((r) => !pred || pred(r)).reduce((a, r) => a + (typeof r[h] === "number" ? (r[h] as number) : 0), 0);
  const months = [...new Set(rows.map((r) => r["Month"]).filter(Boolean))] as string[];
  add("Lanes on the dashboard", fmt(rows.length), null, `${months.length} month${months.length === 1 ? "" : "s"}: ${months.join(", ")}. ${fmt(rows.filter((r) => r["Unit"] === "Trucks").length)} lanes are trucks (trailers, tonnage), the rest containers.`);
  const tabs = [...new Set(rows.map((r) => r["Sheet"]).filter((v): v is string => typeof v === "string"))];
  for (const tab of tabs) {
    const grid = wb.grids?.[tab];
    if (!grid) continue;
    const headerIdx = grid.findIndex((r) => r.some((v) => /^total container/.test(normKey(v))) && r.some((v) => /^loaded/.test(normKey(v))));
    if (headerIdx < 0) continue;
    const header = grid[headerIdx].map((v) => normKey(v));
    const totalRow = grid.slice(headerIdx + 1).find((r) => /^(grand\s+)?total\b/.test(normKey(r[0])));
    if (!totalRow) { add(`${tab} · Grand Total row`, "—", null, "No Grand Total row in this tab to compare with."); continue; }
    const inTab = (r: Record<string, RawCell>) => r["Sheet"] === tab;
    const colIdx = (re: RegExp) => header.findIndex((h) => re.test(h));
    const col = (re: RegExp) => { const i = colIdx(re); return i >= 0 ? num(totalRow[i]) : null; };
    const rawSum = (re: RegExp) => { const i = colIdx(re); return i < 0 ? null : grid.slice(headerIdx + 1).filter((r) => r !== totalRow).reduce((a, r) => a + (num(r[i] ?? null) ?? 0), 0); };
    const pairs: [string, string, RegExp][] = [["Planned", "Planned", /^total container/], ["Rate given", "Rate given", /^rate given/], ["Rate confirmed", "Rate confirmed", /^sales confirmed|^rate confirmed/], ["Booked", "Booked", /^booking placed|^booked/], ["Empties picked", "Empties picked", /^empty pick/], ["Loaded", "Loaded", /^loaded/], ["Pending to ship", "Pending", /^pending/], ["SO ready", "SO ready", /^so ready/]];
    for (const [label, h, re] of pairs) {
      const theirs = col(re);
      if (theirs === null) continue;
      const mine = sumOf(h, inTab);
      const raw = rawSum(re);
      const note = mine === theirs ? "Matches the Grand Total row." : label === "Pending to ship" ? `The dashboard uses planned − loaded per lane (${fmt(mine)}); the Grand Total cell says ${fmt(theirs)}. The typed Pending column adds up to ${fmt(sumOf("Pending (as typed)", inTab))}.` : raw === mine ? `The column's cells add up to ${fmt(mine)}; the Grand Total cell says ${fmt(theirs)}. Its formula probably does not cover every row; worth fixing in the sheet.` : `Differs by ${fmt(mine - theirs)}: a lane the dashboard reads differently (see the Corrections on the Data quality page).`;
      add(`${tab} · ${label}`, fmt(mine), fmt(theirs), note);
    }
  }
  const typedDiff = rows.filter((r) => typeof r["Pending (as typed)"] === "number" && r["Pending (as typed)"] !== r["Pending"]);
  if (typedDiff.length) add("Pending typed differently", fmt(typedDiff.length), null, typedDiff.map((r) => `${r["Destination"]}: typed ${r["Pending (as typed)"]}, planned − loaded ${r["Pending"]}`).join("; ") + ". The dashboard shows planned − loaded.");
  if (summaryRows.length) {
    const blocks = [...new Set(summaryRows.map((r) => r.block as string))];
    const lines = summaryRows.filter((r) => r.customer !== "Total");
    add("Weekly summary", `${fmt(blocks.length)} blocks, ${fmt(lines.length)} lines`, null, "The owner's weekly plan by customer, shown as it is in the workbook. Its counts are a different cut from the plan's lanes and are not expected to add up to them.");
    const planCountries = [...new Set(rows.map((r) => normKey(r["Country"])).filter(Boolean))];
    const planNames = [...new Set(rows.flatMap((r) => [normKey(r["Customer"]), normKey(r["Destination"])]).filter(Boolean))];
    const onPlan = (label: string) => { const k = normKey(label.replace(/\(.*?\)/g, "")); const c = readCountry(k); return planCountries.some((p) => k.includes(p) || (c && normKey(c.name) === p)) || planNames.some((p) => p.includes(k) || k.includes(p)); };
    const notOnPlan = [...new Set(lines.map((r) => String(r.customer)))].filter((c) => !onPlan(c));
    if (notOnPlan.length) add("Summary lines not on the plan", fmt(notOnPlan.length), null, notOnPlan.join(", ") + ": in the weekly summary but with no lane on the plan sheet (or named differently there).");
  }
  const corrected = rows.filter((r) => r["Corrections"]).length;
  add("Lanes with a correction noted", fmt(corrected), null, corrected ? "Spellings folded, a customer moved out of the country cell, a count that does not follow the earlier step, a Pending that differs from planned − loaded. Each is listed on the Data quality page." : "Nothing needed correcting.");
  out.reconciliation = {
    id: "reconciliation", label: "Reconciliation",
    columns: [{ id: "check", label: "Check", type: "string" }, { id: "report", label: "This report", type: "string" }, { id: "sheet", label: "In the sheet", type: "string" }, { id: "note", label: "Note", type: "string", wrap: true }],
    rows: checks,
  };
  return out;
}

export const planMonthField = { label: "Month", date: "month_start" } as const;

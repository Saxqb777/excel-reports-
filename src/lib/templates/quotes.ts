import type { AuxSheet, ColumnValue, Field, FilterExpr, ParsedSheet, ParsedWorkbook, RawCell, RawRow, SchemaMap } from "@/lib/schema/types";
import { cleanText, normKey } from "@/lib/schema/types";
import type { Layout, Page, Widget } from "@/lib/dashboard/types";
import type { MetricSpec } from "@/lib/engine/metrics";

/**
 * Freight rate quote log: the sheet a logistics team keeps of every rate request it handles for the business
 * (Sales asks for an outbound rate to a customer's port, Procurement for an inbound one from a supplier). One row =
 * one request: the month it came in, who asked, the lane (POL → country → POD), whether the quote was shared, what
 * happened to the shipment (executed, not executed, under process, nobody quoted), the mode and the quantity as
 * free text, and a remark. The sheet has no dates beyond the month word and no id column; a small pivot sheet
 * summarises outbound requests by country.
 *
 * What the preparation keeps true:
 * - One tidy row per request with a stable key ("Oct 2026 · 3": the month and the request's order within it), so a
 *   month uploaded again replaces exactly that month (see the monthly cadence in src/lib/data/uploads.ts).
 * - The month word is read in any spelling ("Aug", "August", "Sept"); the year comes from a Year column, else the
 *   tab name when it is a year ("2026"), else the upload date (a month later than today belongs to last year).
 * - Country and port spellings are folded to one name with the correction noted on the row; a port typed as the
 *   country (Santos, Sydney) becomes the port with the country filled in; a country typed as the port is left blank
 *   as "port not specified".
 * - The quantity text is parsed into containers, TEU, equipment, reefer and air weight; what cannot be parsed stays
 *   as a note. Nothing is invented: a blank quantity stays blank.
 * - The outcome words are standardised and a Stage is added that the sheet owner would recognise: Executed,
 *   Under process, Waiting for confirmation (the remark says so), Quote pending (requested, not yet shared),
 *   Not executed, No quote received. "Open" on the dashboard means the first three after Executed.
 */

export const QUOTES_SHEET = "Quote requests";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_WORDS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

export const HEADERS = [
  "Request", "Month", "Month start", "Year", "Direction", "Requested by", "Requestor", "Origin", "Country", "Region", "Destination", "Port", "Lane",
  "Quote status", "Outcome", "Stage", "Mode", "Quantity (as typed)", "Containers", "TEU", "Equipment", "Reefer", "Weight (kg)", "Quantity note",
  "Waiting on", "Product", "Remarks", "Sheet", "Sheet row", "Corrections",
];

export const STAGES = ["Executed", "Under process", "Waiting for confirmation", "Quote pending", "Not executed", "No quote received"];
export const OPEN_STAGES = ["Under process", "Waiting for confirmation", "Quote pending"];
const OUTCOMES = ["Executed", "Not executed", "Under process", "No one quoted"];
const QUOTE_STATUSES = ["Quote shared", "Quote requested", "CIF (supplier arranges freight)"];
const MODES = ["Sea", "Road & Sea", "Air", "Road"];
const REGIONS = ["Middle East", "Asia", "Europe", "Africa", "Americas", "Oceania"];

/** Country spellings seen in the log, folded to one name, with the region used on the dashboard. */
const COUNTRIES: Record<string, { name: string; region: string }> = {};
const country = (name: string, region: string, ...spellings: string[]) => { for (const s of [name, ...spellings]) COUNTRIES[normKey(s)] = { name, region }; };
country("UAE", "Middle East", "united arab emirates", "u.a.e", "al foah", "al ain");
country("Qatar", "Middle East", "qatat");
country("Saudi Arabia", "Middle East", "ksa");
country("Oman", "Middle East");
country("Kuwait", "Middle East"); country("Bahrain", "Middle East"); country("Jordan", "Middle East"); country("Iraq", "Middle East"); country("Lebanon", "Middle East");
country("India", "Asia"); country("China", "Asia"); country("Vietnam", "Asia", "viet nam"); country("Malaysia", "Asia"); country("South Korea", "Asia", "korea", "korea, south", "republic of korea");
country("Japan", "Asia"); country("Taiwan", "Asia"); country("Nepal", "Asia"); country("Bangladesh", "Asia", "bangaladesh"); country("Pakistan", "Asia", "pakisthan"); country("Sri Lanka", "Asia", "srilanka");
country("Indonesia", "Asia"); country("Philippines", "Asia", "phillipines"); country("Thailand", "Asia"); country("Singapore", "Asia"); country("Hong Kong", "Asia", "hongkong");
country("Sweden", "Europe", "swedan"); country("Germany", "Europe"); country("United Kingdom", "Europe", "uk", "england", "britain", "great britain"); country("Norway", "Europe"); country("Ukraine", "Europe");
country("Turkey", "Europe", "türkiye", "turkiye"); country("Croatia", "Europe", "crotia"); country("Netherlands", "Europe", "holland"); country("France", "Europe"); country("Italy", "Europe"); country("Spain", "Europe");
country("Belgium", "Europe"); country("Poland", "Europe"); country("Denmark", "Europe"); country("Finland", "Europe"); country("Greece", "Europe"); country("Russia", "Europe");
country("Tanzania", "Africa", "tanzania"); country("Kenya", "Africa"); country("Somalia", "Africa"); country("Ghana", "Africa"); country("South Africa", "Africa"); country("Egypt", "Africa");
country("Algeria", "Africa"); country("Morocco", "Africa"); country("Nigeria", "Africa"); country("Ethiopia", "Africa"); country("Sudan", "Africa"); country("Djibouti", "Africa"); country("Tunisia", "Africa"); country("Libya", "Africa");
country("USA", "Americas", "united states", "united states of america", "us", "u.s.a", "america"); country("Mexico", "Americas"); country("Brazil", "Americas", "brasil"); country("Argentina", "Americas");
country("Bolivia", "Americas", "bolevia"); country("Uruguay", "Americas"); country("Canada", "Americas"); country("Chile", "Americas"); country("Peru", "Americas"); country("Colombia", "Americas");
country("Australia", "Oceania"); country("New Zealand", "Oceania", "new zeland", "newzeland", "newzealand", "nz"); country("Fiji", "Oceania");

/** Port spellings and the country each port is in, so a port typed in the country column still lands on the map. */
const PORTS: Record<string, { name: string; country: string }> = {};
const port = (name: string, cty: string, ...spellings: string[]) => { for (const s of [name, ...spellings]) PORTS[normKey(s)] = { name, country: cty }; };
port("Nhava Sheva", "India", "nava sheva", "nhava seva", "jnpt"); port("Mundra", "India"); port("Chennai", "India"); port("Cochin", "India", "kochi");
port("Santos", "Brazil", "santoz"); port("Paranaguá", "Brazil", "paranagua"); port("Dar es Salaam", "Tanzania", "dar al salam", "dar es salam", "dar-es-salaam"); port("Mombasa", "Kenya");
port("Mogadishu", "Somalia", "magadishu"); port("Chittagong", "Bangladesh", "chitagong", "chattogram"); port("Los Angeles", "USA", "lose angels", "los angels"); port("Long Beach", "USA");
port("New York", "USA"); port("New Jersey", "USA"); port("Galveston", "USA"); port("Chicago", "USA"); port("Houston", "USA"); port("Cape Town", "South Africa", "captown", "capetown"); port("Durban", "South Africa");
port("Sydney", "Australia"); port("Melbourne", "Australia"); port("Auckland", "New Zealand", "port of auckland"); port("Shanghai", "China", "port of shanghai", "shanghai,china."); port("Ningbo", "China");
port("Veracruz", "Mexico", "vera cruz"); port("Buenos Aires", "Argentina"); port("Hamburg", "Germany"); port("Southampton", "United Kingdom"); port("London Gateway", "United Kingdom");
port("Gothenburg", "Sweden", "gothenburg port", "goteborg"); port("Oslo", "Norway"); port("Port Klang", "Malaysia", "klang"); port("Busan", "South Korea"); port("Port Rashid", "UAE", "rashid port", "mina rashid");
port("Jebel Ali", "UAE"); port("Khorfakkan", "UAE", "khor fakkan"); port("Montevideo", "Uruguay"); port("Istanbul", "Turkey"); port("Mersin", "Turkey"); port("Alexandria", "Egypt"); port("Tema", "Ghana"); port("Kathmandu", "Nepal");

const PRODUCTS: { match: string[]; value: string }[] = [
  { match: ["pitred date", "pitted date"], value: "Pitted dates" },
  { match: ["khalas"], value: "Khalas dates & syrup" },
  { match: ["date seed"], value: "Date seed" },
  { match: ["mix dates", "mixed dates"], value: "Mixed dates" },
  { match: ["paste"], value: "Date paste" },
  { match: ["palm tree"], value: "Palm trees" },
  { match: ["ethylformat", "ethyl formate"], value: "Ethyl formate" },
  { match: ["shutter door"], value: "High-speed shutter door" },
  { match: ["raw material"], value: "Raw materials" },
  { match: ["resiliance plan", "resilience plan"], value: "Dates (resilience plan)" },
  { match: ["dates"], value: "Dates" },
];

type Cols = { month: string; country: string; outcome: string; quote: string; mode?: string; direction?: string; pol?: string; pod?: string; qty?: string; requestor?: string; remarks?: string; year?: string; bu?: string };
const pick = (headers: string[], ...names: string[]) => headers.find((h) => names.includes(normKey(h)));

function quoteColumns(sheet: ParsedSheet): Cols | null {
  const h = sheet.headers;
  // A lookup tab ("Lists") carries the same headers as dropdown sources; the log itself names the ports.
  if (/^(lists?|lookups?|dropdowns?|validation)$/i.test(sheet.name.trim())) return null;
  const month = pick(h, "month"), cty = pick(h, "country", "destination country"), outcome = pick(h, "status of the shipemnt", "status of the shipment", "shipment status", "status"), quote = pick(h, "quote status", "quotation status");
  if (!month || !cty || !outcome || !quote || !(pick(h, "pol", "port of loading", "origin") || pick(h, "pod", "port of discharge", "destination"))) return null;
  return {
    month, country: cty, outcome, quote, mode: pick(h, "shipment mode", "mode", "mode of shipment"), direction: pick(h, "inbound / outbound", "inbound/outbound", "direction"),
    pol: pick(h, "pol", "port of loading", "origin"), pod: pick(h, "pod", "port of discharge", "destination"), qty: pick(h, "qty", "quantity"), requestor: pick(h, "requestor", "requester", "requested by"),
    remarks: pick(h, "remarks", "remark", "comments"), year: pick(h, "year"), bu: pick(h, "bu", "business unit"),
  };
}

/** The prepared sheet, by its own headers. */
export function matchesQuotes(headers: string[]): boolean {
  return ["request", "month start", "stage", "quote status", "teu"].every((k) => headers.some((h) => normKey(h) === k));
}
/** A raw log sheet the preparation knows how to read. */
export const isQuotesSource = (sheet: ParsedSheet): boolean => quoteColumns(sheet) !== null;

const text = (v: RawCell): string | null => { if (v === null || v === undefined) return null; const s = cleanText(v); return s ? s : null; };
const title = (s: string) => s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
type Note = { field: string; from: string; to: string; reason: string };

/** Month index and year of a month cell: a month word, "Oct 2026", a typed date, or "10/2026". */
function readMonth(v: RawCell, yearHint: number | null, now: Date): { month: number; year: number; source: "typed" | "tab" | "assumed" } | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86_400_000)); return { month: d.getUTCMonth(), year: d.getUTCFullYear(), source: "typed" }; }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const d = new Date(s); return { month: d.getUTCMonth(), year: d.getUTCFullYear(), source: "typed" }; }
  const my = /^([A-Za-z]+)\.?[\s,'-]*(\d{2}|\d{4})$/.exec(s);
  if (my && MONTH_WORDS[my[1].toLowerCase()] !== undefined) return { month: MONTH_WORDS[my[1].toLowerCase()], year: my[2].length === 2 ? 2000 + Number(my[2]) : Number(my[2]), source: "typed" };
  const num = /^(\d{1,2})[\/.-](\d{4})$/.exec(s);
  if (num && Number(num[1]) >= 1 && Number(num[1]) <= 12) return { month: Number(num[1]) - 1, year: Number(num[2]), source: "typed" };
  const word = MONTH_WORDS[s.toLowerCase().replace(/\.$/, "")];
  if (word === undefined) return null;
  if (yearHint) return { month: word, year: yearHint, source: "tab" };
  // No year anywhere: a month later than today's belongs to last year.
  const y = word > now.getUTCMonth() ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  return { month: word, year: y, source: "assumed" };
}

function readCountry(v: RawCell): { name: string; region: string } | null {
  const s = text(v);
  if (!s) return null;
  const hit = COUNTRIES[normKey(s)];
  if (hit) return hit;
  // A port typed as the country: Santos, Sydney.
  const p = PORTS[normKey(s)];
  if (p) return COUNTRIES[normKey(p.country)] ?? null;
  return { name: title(s), region: "Other" };
}

/** A port name folded to one spelling; null when the cell names the country instead of a port. */
function readPort(v: RawCell, countryName: string | null): { port: string | null; note: string | null; mismatch: string | null } {
  const s = text(v);
  if (!s) return { port: null, note: null, mismatch: null };
  const key = normKey(s);
  const p = PORTS[key];
  if (p) return { port: p.name, note: p.name !== s ? `Port spelling "${s}" read as ${p.name}` : null, mismatch: countryName && p.country !== countryName && !(countryName === "UAE" && p.country === "UAE") ? p.country : null };
  const c = COUNTRIES[key];
  if (c) return c.name === countryName || !countryName ? { port: null, note: null, mismatch: null } : { port: null, note: null, mismatch: c.name };
  return { port: title(s).replace(/\bOf\b/g, "of"), note: null, mismatch: null };
}

interface Qty { containers: number | null; teu: number | null; equipment: string | null; reefer: string | null; weightKg: number | null; note: string | null }
/** "1X20HC & 1 X40HC" → 2 containers, 3 TEU, "20HC + 40HC"; "1100 KG" → weight; the rest becomes a note. */
function readQty(v: RawCell, mode: string | null): Qty {
  const s = text(v);
  if (!s) return { containers: null, teu: null, equipment: null, reefer: null, weightKg: null, note: null };
  const out: Qty = { containers: null, teu: null, equipment: null, reefer: null, weightKg: null, note: null };
  const lower = s.toLowerCase();
  const reefer = /\b(rf|rh|hr|reefer|temp(?:o|e)rature)\b/i.test(s.replace(/(\d)(rf|rh|hr)\b/gi, "$1 $2")) || /temp(?:o|e)rature/i.test(s);
  const equipment: string[] = [];
  let containers = 0, teu = 0, parsed = false;
  const re = /(\d+)\s*[x×]\s*(\d+)\s*(hc|hq|rf|rh|hr|gp|std|dv|ft|'|mt|ton|tons)?/gi;
  let m: RegExpExecArray | null;
  const rest = lower.replace(re, " ");
  while ((m = re.exec(s))) {
    const n = Number(m[1]), size = Number(m[2]), unit = (m[3] ?? "").toLowerCase();
    if (unit === "mt" || unit === "ton" || unit === "tons") { out.weightKg = (out.weightKg ?? 0) + n * size * 1000; parsed = true; continue; }
    if (size === 20 || size === 40 || size === 45) {
      containers += n; teu += n * (size === 20 ? 1 : 2); parsed = true;
      const type = ["rf", "rh", "hr"].includes(unit) ? `${size}RF` : unit === "std" || unit === "gp" || unit === "dv" ? `${size}GP` : `${size}HC`;
      if (!equipment.includes(type)) equipment.push(type);
    } else if (mode === "Road" || /\b(truck|trailer)\b/.test(lower)) { out.equipment = `${n} × ${size} t truck${n > 1 ? "s" : ""}`; parsed = true; }
  }
  const lone = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(s);
  if (!parsed && lone) { // "1X20+1X40" without types: plain containers
    containers = Number(lone[1]); teu = Number(lone[1]) * (Number(lone[2]) === 20 ? 1 : 2); parsed = true;
  }
  const sum = /(\d+)\s*[x×]\s*(\d+)\s*\+\s*(\d+)\s*[x×]\s*(\d+)/i.exec(s);
  if (!parsed && sum) { containers = Number(sum[1]) + Number(sum[3]); teu = Number(sum[1]) * (Number(sum[2]) === 20 ? 1 : 2) + Number(sum[3]) * (Number(sum[4]) === 20 ? 1 : 2); parsed = true; equipment.push(...[sum[2], sum[4]].map((x) => `${x}HC`)); }
  const kg = /(\d[\d,.]*)\s*(kg|kgs|kilo)/i.exec(s), mt = /(\d[\d,.]*)\s*(mt|ton|tons|tonne|tonnes)\b/i.exec(s);
  if (kg) { out.weightKg = (out.weightKg ?? 0) + Number(kg[1].replace(/,/g, "")); parsed = true; }
  else if (mt && !/[x×]/i.test(s)) { out.weightKg = (out.weightKg ?? 0) + Number(mt[1].replace(/,/g, "")) * 1000; parsed = true; }
  if (containers > 0) { out.containers = containers; out.teu = teu; out.equipment = [...new Set(equipment)].join(" + ") || "Containers"; }
  if (reefer) out.reefer = "Yes"; else if (containers > 0) out.reefer = "No";
  if (!parsed) {
    if (/^air\s*freight$/i.test(s)) out.note = "Quantity not given (the cell repeats the mode)";
    else out.note = s;
    if (!out.equipment && mode === "Air") out.equipment = "Air cargo";
  } else if (rest.replace(/[\s&+,()]/g, "") && !/^(air|freight|temporaturecontrolled|temperaturecontrolled|kg|mt)+$/.test(rest.replace(/[\s&+,()]/g, ""))) {
    // Words left over after the parse ("Temporature Controlled" is covered by the reefer flag).
    const leftover = cleanText(rest.replace(/[&+,()]/g, " "));
    if (leftover && !/^(kg|mt|air freight)$/i.test(leftover)) out.note = leftover;
  }
  if (out.weightKg !== null && !out.equipment) out.equipment = mode === "Air" ? "Air cargo" : "Bulk / loose";
  return out;
}

function readOutcome(v: RawCell): string {
  const k = normKey(v);
  if (!k) return "Not recorded";
  if (/exc?ecut|executed|shipped|done|complete/.test(k) && !/^not|^no /.test(k)) return "Executed";
  if (/^not|^no /.test(k) && /exc?ecut/.test(k)) return "Not executed";
  if (/under|process|progress/.test(k)) return "Under process";
  if (/no one|nobody|no quote/.test(k)) return "No one quoted";
  return title(k);
}
function readQuoteStatus(v: RawCell): string {
  const k = normKey(v);
  if (!k) return "Not recorded";
  if (/shared|sent|provided|submitted/.test(k)) return "Quote shared";
  if (/request|pending|awaiting/.test(k)) return "Quote requested";
  if (/\bcif\b|supplier/.test(k)) return "CIF (supplier arranges freight)";
  return title(k);
}
function readMode(v: RawCell): string | null {
  const k = normKey(v);
  if (!k) return null;
  const sea = /sea|ocean|fcl|lcl/.test(k), road = /road|truck|land/.test(k), air = /air/.test(k);
  if (sea && road) return "Road & Sea";
  if (air) return "Air";
  if (sea) return "Sea";
  if (road) return "Road";
  return title(k);
}
function readDirection(v: RawCell): string | null {
  const k = normKey(v);
  if (!k) return null;
  if (/^in|import/.test(k)) return "Inbound";
  if (/^out|export/.test(k)) return "Outbound";
  return title(k);
}
function readRequestor(v: RawCell): string | null {
  const s = text(v);
  if (!s) return null;
  return s.split(/\s*[\/&,]\s*/).map((p) => cleanText(p)).filter(Boolean).sort((a, b) => a.localeCompare(b)).join(" / ");
}
function readWaitingOn(remarks: string | null): string | null {
  if (!remarks) return null;
  const k = normKey(remarks);
  if (!/waiting|awaiting|confirmation/.test(k)) return null;
  if (/procur/.test(k)) return "Procurement";
  if (/sales/.test(k)) return "Sales";
  if (/customer|client/.test(k)) return "Customer";
  return "Confirmation";
}
function readProduct(remarks: string | null, qtyNote: string | null): string | null {
  const k = normKey(`${remarks ?? ""} ${qtyNote ?? ""}`);
  if (!k.trim()) return null;
  for (const p of PRODUCTS) if (p.match.some((m) => k.includes(m))) return p.value;
  return null;
}

interface Req {
  sheet: string; row: number; order: number; month: number; year: number; monthSource: "typed" | "tab" | "assumed"; direction: string | null; requestor: string | null;
  origin: string | null; country: string | null; region: string | null; destination: string | null; port: string | null; quote: string; outcome: string; mode: string | null;
  qtyRaw: string | null; qty: Qty; remarks: string | null; waitingOn: string | null; product: string | null; notes: Note[];
}

function readRequests(sheet: ParsedSheet, c: Cols, now: Date): Req[] {
  const tabYear = /^(20\d\d)$/.exec(sheet.name.trim());
  const out: Req[] = [];
  for (const r of sheet.rows) {
    const cell = (h?: string): RawCell => (h ? r.cells[h] ?? null : null);
    const yearCell = c.year ? Number(cell(c.year)) : NaN;
    const m = readMonth(cell(c.month), Number.isFinite(yearCell) && yearCell > 2000 ? yearCell : tabYear ? Number(tabYear[1]) : null, now);
    const countryRaw = text(cell(c.country));
    if (!m && !countryRaw && !text(cell(c.outcome))) continue;
    const notes: Note[] = [];
    if (!m) { notes.push({ field: "month", from: text(cell(c.month)) ?? "(blank)", to: "(blank)", reason: "Month not understood; the request is kept without a month" }); }
    const direction = readDirection(cell(c.direction));
    const mode = readMode(cell(c.mode));
    const remarks = text(cell(c.remarks));
    const cty = readCountry(cell(c.country));
    const polRaw = text(cell(c.pol)), podRaw = text(cell(c.pod));
    // Outbound: Al Foah → country/port. Inbound: the sheet's Country column says UAE and the POL names the supplier's country.
    let origin: string | null = null, destination: string | null = null, partner: { name: string; region: string } | null = cty, portName: string | null = null;
    if (direction === "Inbound" || (cty?.name === "UAE" && polRaw && !/al foah/i.test(polRaw))) {
      const from = readCountry(cell(c.pol));
      const fromPort = polRaw ? readPort(cell(c.pol), from?.name ?? null) : { port: null, note: null, mismatch: null };
      partner = from && from.name !== "UAE" ? from : fromPort.port && PORTS[normKey(fromPort.port)] ? COUNTRIES[normKey(PORTS[normKey(fromPort.port)].country)] ?? null : from;
      portName = fromPort.port && fromPort.port !== partner?.name ? fromPort.port : null;
      if (fromPort.note) notes.push({ field: "port", from: polRaw!, to: fromPort.port!, reason: fromPort.note });
      origin = partner ? (portName ? `${portName}, ${partner.name}` : partner.name) : polRaw;
      destination = "Al Foah";
    } else {
      const pod = readPort(cell(c.pod), cty?.name ?? null);
      if (pod.note) notes.push({ field: "port", from: podRaw!, to: pod.port!, reason: pod.note });
      if (pod.mismatch) notes.push({ field: "port", from: podRaw!, to: "(blank)", reason: `Port "${podRaw}" is in ${pod.mismatch}, not ${cty?.name}; country kept as typed, port left blank` });
      portName = pod.mismatch ? null : pod.port;
      if (countryRaw && PORTS[normKey(countryRaw)] && cty) { // "Santos" typed as the country
        portName = portName ?? PORTS[normKey(countryRaw)].name;
        notes.push({ field: "country", from: countryRaw, to: cty.name, reason: `"${countryRaw}" is a port; country set to ${cty.name}` });
      } else if (cty && countryRaw && cty.name !== countryRaw.trim()) notes.push({ field: "country", from: countryRaw, to: cty.name, reason: "Country spelling folded" });
      origin = "Al Foah";
      destination = cty ? (portName ? `${portName}, ${cty.name}` : cty.name) : podRaw;
    }
    const qty = readQty(cell(c.qty), mode);
    const req: Req = {
      sheet: sheet.name, row: r.row, order: 0, month: m?.month ?? -1, year: m?.year ?? 0, monthSource: m?.source ?? "assumed", direction, requestor: readRequestor(cell(c.requestor)),
      origin, country: partner?.name ?? null, region: partner?.region ?? null, destination, port: portName, quote: readQuoteStatus(cell(c.quote)), outcome: readOutcome(cell(c.outcome)), mode,
      qtyRaw: text(cell(c.qty)), qty, remarks, waitingOn: readWaitingOn(remarks), product: readProduct(remarks, qty.note), notes,
    };
    if (m?.source === "assumed") notes.push({ field: "month", from: text(cell(c.month))!, to: `${MONTHS[m.month]} ${m.year}`, reason: "No year in the sheet or tab name; year taken from the upload date" });
    if (req.qty.containers !== null && req.qty.containers >= 100) notes.push({ field: "containers", from: req.qtyRaw!, to: String(req.qty.containers), reason: "Unusually large container count; kept as typed, worth checking" });
    if (req.outcome === "Executed" && remarks && /\b(\d+)\s*exc?ecuted\b/i.test(remarks)) notes.push({ field: "outcome", from: remarks, to: "Executed", reason: "Remark says only part of the request was executed; counted as executed" });
    out.push(req);
  }
  return out;
}

const stageOf = (r: Req): string => {
  if (r.outcome === "Executed") return "Executed";
  if (r.outcome === "Under process") return "Under process";
  if (r.outcome === "No one quoted") return "No quote received";
  if (r.quote === "Quote requested") return "Quote pending";
  if (r.waitingOn) return "Waiting for confirmation";
  if (r.outcome === "Not executed") return "Not executed";
  return r.outcome;
};

/** Merges every quote-log sheet of the workbook into one tidy "Quote requests" sheet; other workbooks pass through untouched. */
export function prepareQuotesWorkbook(wb: ParsedWorkbook, now = new Date()): ParsedWorkbook {
  if (wb.sheets.some((s) => s.name === QUOTES_SHEET)) return wb;
  const sources = wb.sheets.filter((s) => quoteColumns(s));
  if (sources.length === 0) return wb;
  const reqs = sources.flatMap((s) => readRequests(s, quoteColumns(s)!, now));
  // Stable order: by month, then as the rows sit in the sheet; the key counts within the month.
  reqs.sort((a, b) => a.year - b.year || a.month - b.month || a.row - b.row);
  const seq = new Map<string, number>();
  const rows: RawRow[] = reqs.map((r, i) => {
    const monthLabel = r.month >= 0 ? `${MONTHS[r.month]} ${r.year}` : null;
    const k = (seq.get(monthLabel ?? "?") ?? 0) + 1;
    seq.set(monthLabel ?? "?", k);
    r.order = k;
    const requestedBy = r.direction === "Inbound" ? "Procurement" : r.direction === "Outbound" ? "Sales" : null;
    const lane = r.origin && r.destination ? `${r.origin} → ${r.destination}` : null;
    const cells: Record<string, RawCell> = {
      "Request": `${monthLabel ?? "No month"} · ${k}`, "Month": monthLabel, "Month start": r.month >= 0 ? new Date(Date.UTC(r.year, r.month, 1)).toISOString() : null, "Year": r.month >= 0 ? r.year : null,
      "Direction": r.direction, "Requested by": requestedBy, "Requestor": r.requestor, "Origin": r.origin, "Country": r.country, "Region": r.region, "Destination": r.destination, "Port": r.port, "Lane": lane,
      "Quote status": r.quote, "Outcome": r.outcome, "Stage": stageOf(r), "Mode": r.mode, "Quantity (as typed)": r.qtyRaw, "Containers": r.qty.containers, "TEU": r.qty.teu, "Equipment": r.qty.equipment ?? (r.qtyRaw ? null : "Not specified"),
      "Reefer": r.qty.reefer, "Weight (kg)": r.qty.weightKg, "Quantity note": r.qty.note, "Waiting on": r.waitingOn, "Product": r.product, "Remarks": r.remarks, "Sheet": r.sheet, "Sheet row": r.row,
      "Corrections": r.notes.length ? JSON.stringify(r.notes) : null,
    };
    return { row: i + 2, cells };
  });
  const sheet: ParsedSheet = { name: QUOTES_SHEET, headerRow: 1, headers: HEADERS, rows, stats: statsFor(HEADERS, rows), validations: {}, totalRowsInSheet: rows.length + 1 };
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
const num = (id: string, label: string, source: string, extra: Partial<Field> = {}): Field => ({ id, label, source, type: "number", role: "measure", format: "integer", aggregate: "sum", ...extra });
const flag = (when: FilterExpr) => ({ kind: "case" as const, cases: [{ when, value: 1 }], fallback: 0 });
const count = (id: string, label: string, when: FilterExpr): Field => ({ id, label, source: null, type: "number", role: "measure", format: "integer", aggregate: "sum", hidden: true, derived: flag(when) });
const stage = (...values: string[]): FilterExpr => (values.length === 1 ? { field: "stage", op: "eq", value: values[0] } : { field: "stage", op: "in", value: values });
export const IS_OPEN: FilterExpr = stage(...OPEN_STAGES);
const EXECUTED: FilterExpr = stage("Executed");
const DECIDED: FilterExpr = stage("Executed", "Not executed");

export function quotesSchema(): SchemaMap {
  const fields: Field[] = [
    { id: "request", label: "Request", source: "Request", type: "string", role: "id" },
    dim("month", "Month", "Month", { semantic: "period" }),
    { id: "month_start", label: "Month", source: "Month start", type: "date", role: "date", format: "date", hidden: true },
    dim("year", "Year", "Year", { hidden: true }),
    dim("direction", "Direction", "Direction", { order: ["Outbound", "Inbound"] }),
    dim("requested_by", "Requested by", "Requested by", { order: ["Sales", "Procurement"], semantic: "owner" }),
    dim("requestor", "Requestor", "Requestor"),
    dim("origin", "Origin", "Origin", { semantic: "origin", hidden: true }),
    dim("country", "Country", "Country", { description: "The country the goods go to (outbound) or come from (inbound)" }),
    dim("region", "Region", "Region", { order: REGIONS }),
    dim("destination", "Destination", "Destination", { semantic: "destination", hidden: true }),
    dim("port", "Port", "Port"),
    txt("lane", "Lane", "Lane", { semantic: "lane" }),
    dim("quote_status", "Quote status", "Quote status", { order: QUOTE_STATUSES }),
    dim("outcome", "Outcome (as typed)", "Outcome", { order: OUTCOMES, hidden: true }),
    dim("stage", "Stage", "Stage", { semantic: "status", order: STAGES }),
    dim("mode", "Mode", "Mode", { semantic: "mode", order: MODES }),
    txt("qty_raw", "Quantity (as typed)", "Quantity (as typed)", { hidden: true }),
    num("containers", "Containers", "Containers", { semantic: "quantity" }),
    num("teu", "TEU", "TEU"),
    dim("equipment", "Equipment", "Equipment"),
    dim("reefer", "Reefer", "Reefer", { order: ["Yes", "No"], hidden: true }),
    num("weight_kg", "Weight (kg)", "Weight (kg)", { hidden: true }),
    txt("qty_note", "Quantity note", "Quantity note", { hidden: true }),
    dim("waiting_on", "Waiting on", "Waiting on", { order: ["Sales", "Procurement", "Customer", "Confirmation"] }),
    dim("product", "Product", "Product"),
    txt("remarks", "Remarks", "Remarks", { semantic: "remarks" }),
    txt("source_sheet", "Sheet", "Sheet", { hidden: true }),
    { id: "source_row", label: "Sheet row", source: "Sheet row", type: "number", role: "measure", format: "integer", hidden: true },
    txt("notes", "Corrections", "Corrections", { hidden: true }),
    // Per-row counters so tables grouped by month, country or requestor roll up.
    { id: "requests", label: "Requests", source: null, type: "number", role: "measure", format: "integer", aggregate: "sum", hidden: true, derived: { kind: "case", cases: [], fallback: 1 } },
    count("n_executed", "Executed", EXECUTED),
    count("n_open", "Open", IS_OPEN),
    count("n_not_executed", "Not executed", stage("Not executed")),
    count("n_waiting", "Waiting for confirmation", stage("Waiting for confirmation")),
    { id: "executed_rate", label: "Executed rate", source: null, type: "number", role: "measure", format: "percent", aggregate: "avg", hidden: true, description: "Executed ÷ (executed + not executed); open requests are left out",
      derived: { kind: "case", cases: [{ when: EXECUTED, value: 1 }, { when: stage("Not executed"), value: 0 }], fallback: null } },
    { id: "open_status", label: "Open or closed", source: null, type: "string", role: "dimension", order: ["Open", "Executed", "Closed without shipment"], hidden: true,
      derived: { kind: "case", cases: [{ when: IS_OPEN, value: "Open" }, { when: EXECUTED, value: "Executed" }], fallback: "Closed without shipment" } },
    { id: "latest", label: "Latest month", source: null, type: "string", role: "dimension", order: ["Latest month", "Earlier"], hidden: true, derived: { kind: "latestPeriod", from: "month_start", unit: "month" } },
  ];
  return { version: 1, sheet: QUOTES_SHEET, fields, idField: "request", primaryDate: "month_start", noteField: "notes", foldCase: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Layout

const requests = (filter?: FilterExpr): MetricSpec => ({ agg: "count", format: "integer", ...(filter ? { filter } : {}) });
const sum = (field: string, filter?: FilterExpr): MetricSpec => ({ agg: "sum", field, format: "integer", ...(filter ? { filter } : {}) });
const distinct = (field: string, filter?: FilterExpr): MetricSpec => ({ agg: "distinct", field, format: "integer", ...(filter ? { filter } : {}) });
const LATEST: FilterExpr = { field: "latest", op: "eq", value: "Latest month" };
const table = (w: Omit<Extract<Widget, { type: "table" }>, "type">): Widget => ({ type: "table", statusField: "stage", ...w });
const REQUEST_COLUMNS = ["request", "requested_by", "requestor", "lane", "mode", "equipment", "containers", "quote_status", "stage", "waiting_on", "product"];

export function quotesLayout(): Layout {
  const overview: Page = {
    id: "overview", title: "Overview", widgets: [
      { id: "story", type: "story", title: "This month", dateField: "month_start", monthField: "month", metrics: [
        { id: "requests", label: "quote requests", metric: requests(), good: "none" },
        { id: "executed", label: "executed", metric: requests(EXECUTED), good: "up" },
        { id: "open", label: "open", metric: requests(IS_OPEN), good: "none" },
        { id: "waiting", label: "waiting for confirmation", metric: requests(stage("Waiting for confirmation")), good: "down" },
        { id: "countries", label: "countries", metric: distinct("country"), good: "none" },
      ] },
      { id: "months", type: "months", title: "Month by month", subtitle: "Click a month to see it alone", dateField: "month_start", monthField: "month", metric: requests(), stackBy: "stage" },
      { id: "kpi_requests", type: "kpi", title: "Quote requests", metric: requests(), good: "none", secondary: { metric: distinct("month"), label: "months" } },
      { id: "kpi_executed", type: "kpi", title: "Executed", metric: requests(EXECUTED), good: "up", onClick: EXECUTED, secondary: { metric: { agg: "rate", numerator: EXECUTED, denominator: DECIDED, format: "percent" }, label: "of decided requests" } },
      { id: "kpi_open", type: "kpi", title: "Open", metric: requests(IS_OPEN), good: "none", onClick: IS_OPEN, secondary: { metric: requests(stage("Waiting for confirmation")), label: "waiting for confirmation" } },
      { id: "kpi_not", type: "kpi", title: "Not executed", metric: requests(stage("Not executed")), good: "down", onClick: stage("Not executed"), secondary: { metric: requests(stage("No quote received")), label: "got no quote at all" } },
      { id: "kpi_teu", type: "kpi", title: "Containers quoted", metric: sum("containers"), good: "none", secondary: { metric: sum("teu"), label: "TEU" } },
      { id: "kpi_countries", type: "kpi", title: "Countries", metric: distinct("country"), good: "none", secondary: { metric: distinct("port"), label: "ports" } },
      { id: "map", type: "map", title: "Where the requests go", subtitle: "Dot size = requests, colour = share executed. Click a country to filter", countryField: "country", metric: requests(), executedMetric: requests(EXECUTED) },
      { id: "flow", type: "flow", title: "How requests flow", subtitle: "Direction → mode → stage. Hover to trace, click to filter", levels: ["requested_by", "mode", "stage"], metric: requests() },
      { id: "by_month", type: "bar", title: "Requests by month", subtitle: "Stacked by stage", dimension: "month", metric: requests(), stackBy: "stage", sort: "date", orientation: "vertical", colorBy: "status" },
      { id: "by_mode", type: "bar", title: "By mode", dimension: "mode", metric: requests(), stackBy: "stage", sort: "order", orientation: "horizontal", colorBy: "status" },
      { id: "by_country", type: "bar", title: "Top countries", subtitle: "Requests, stacked by stage", dimension: "country", metric: requests(), stackBy: "stage", topN: 15, orientation: "horizontal", colorBy: "status" },
      { id: "by_requestor", type: "bar", title: "Who asks for quotes", subtitle: "Requests per requestor, stacked by stage", dimension: "requestor", metric: requests(), stackBy: "stage", topN: 12, orientation: "horizontal", colorBy: "status" },
    ], grid: [
      { i: "story", x: 0, y: 0, w: 12, h: 5, minH: 5 }, { i: "months", x: 0, y: 5, w: 12, h: 4, minH: 4 },
      { i: "kpi_requests", x: 0, y: 9, w: 2, h: 3 }, { i: "kpi_executed", x: 2, y: 9, w: 2, h: 3 }, { i: "kpi_open", x: 4, y: 9, w: 2, h: 3 }, { i: "kpi_not", x: 6, y: 9, w: 2, h: 3 }, { i: "kpi_teu", x: 8, y: 9, w: 2, h: 3 }, { i: "kpi_countries", x: 10, y: 9, w: 2, h: 3 },
      { i: "map", x: 0, y: 12, w: 7, h: 12 }, { i: "flow", x: 7, y: 12, w: 5, h: 12 },
      { i: "by_month", x: 0, y: 24, w: 7, h: 9 }, { i: "by_mode", x: 7, y: 24, w: 5, h: 9 },
      { i: "by_country", x: 0, y: 33, w: 6, h: 11 }, { i: "by_requestor", x: 6, y: 33, w: 6, h: 11 },
    ],
  };
  const monthly: Page = {
    id: "monthly", title: "Monthly", widgets: [
      { id: "m_kpi_requests", type: "kpi", title: "Latest month · requests", metric: requests(LATEST), good: "none", onClick: LATEST, secondary: { metric: sum("containers", LATEST), label: "containers quoted" } },
      { id: "m_kpi_executed", type: "kpi", title: "Latest month · executed", metric: requests({ and: [LATEST, EXECUTED] }), good: "up", onClick: { and: [LATEST, EXECUTED] }, secondary: { metric: { agg: "rate", numerator: { and: [LATEST, EXECUTED] }, denominator: { and: [LATEST, DECIDED] }, format: "percent" }, label: "of decided" } },
      { id: "m_kpi_open", type: "kpi", title: "Latest month · open", metric: requests({ and: [LATEST, IS_OPEN] }), good: "none", onClick: { and: [LATEST, IS_OPEN] }, secondary: { metric: requests({ and: [LATEST, stage("Waiting for confirmation")] }), label: "waiting for confirmation" } },
      { id: "m_kpi_countries", type: "kpi", title: "Latest month · countries", metric: distinct("country", LATEST), good: "none", secondary: { metric: requests({ and: [LATEST, { field: "direction", op: "eq", value: "Inbound" }] }), label: "inbound requests" } },
      table({ id: "month_table", title: "Month by month", subtitle: "Every month in the log. Executed rate leaves open requests out", groupBy: "month", rowLabel: "months", columns: ["month", "requests", "n_executed", "executed_rate", "n_open", "n_waiting", "n_not_executed", "containers", "teu"], sort: { field: "month_start", dir: "desc" }, pageSize: 24 }),
      { id: "m_stage", type: "bar", title: "Stage by month", subtitle: "What happened to each month's requests", dimension: "month", metric: requests(), stackBy: "stage", sort: "date", orientation: "vertical", colorBy: "status" },
      { id: "m_mode", type: "bar", title: "Mode by month", dimension: "month", metric: requests(), stackBy: "mode", sort: "date", orientation: "vertical", colorBy: "categorical" },
      { id: "m_containers", type: "bar", title: "Containers quoted by month", dimension: "month", metric: sum("containers"), sort: "date", orientation: "vertical", colorBy: "single", share: false },
      { id: "m_rate", type: "bar", title: "Executed rate by month", subtitle: "Executed ÷ (executed + not executed)", dimension: "month", metric: { agg: "avg", field: "executed_rate", format: "percent" }, sort: "date", orientation: "vertical", colorBy: "single", share: false },
      table({ id: "m_requests", title: "Requests in the latest month", filter: LATEST, columns: REQUEST_COLUMNS, sort: { field: "request", dir: "asc" }, pageSize: 25, search: true }),
    ], grid: [
      { i: "m_kpi_requests", x: 0, y: 0, w: 3, h: 3 }, { i: "m_kpi_executed", x: 3, y: 0, w: 3, h: 3 }, { i: "m_kpi_open", x: 6, y: 0, w: 3, h: 3 }, { i: "m_kpi_countries", x: 9, y: 0, w: 3, h: 3 },
      { i: "month_table", x: 0, y: 3, w: 12, h: 8 },
      { i: "m_stage", x: 0, y: 11, w: 6, h: 9 }, { i: "m_mode", x: 6, y: 11, w: 6, h: 9 },
      { i: "m_containers", x: 0, y: 20, w: 6, h: 8 }, { i: "m_rate", x: 6, y: 20, w: 6, h: 8 },
      { i: "m_requests", x: 0, y: 28, w: 12, h: 14 },
    ],
  };
  const destinations: Page = {
    id: "destinations", title: "Destinations", widgets: [
      { id: "d_map", type: "map", title: "Countries quoted", subtitle: "Dot size = requests, colour = share executed. Click a country to filter", countryField: "country", metric: requests(), executedMetric: requests(EXECUTED) },
      { id: "d_region", type: "bar", title: "By region", dimension: "region", metric: requests(), stackBy: "stage", sort: "order", orientation: "horizontal", colorBy: "status" },
      table({ id: "d_table", title: "By country", subtitle: "Requests, what happened to them, and the containers quoted", groupBy: "country", rowLabel: "countries", columns: ["country", "region", "requests", "n_executed", "executed_rate", "n_open", "n_not_executed", "containers", "teu"], sort: { field: "requests", dir: "desc" }, pageSize: 20, search: true }),
      table({ id: "d_ports", title: "By port", subtitle: "Where a port was named", groupBy: "port", rowLabel: "ports", filter: { field: "port", op: "notNull" }, columns: ["port", "country", "requests", "n_executed", "n_open", "containers", "mode"], sort: { field: "requests", dir: "desc" }, pageSize: 15 }),
      { id: "d_inbound", type: "bar", title: "Inbound origins", subtitle: "Where Procurement asked for rates from", dimension: "origin", metric: requests(), stackBy: "stage", filter: { field: "direction", op: "eq", value: "Inbound" }, orientation: "horizontal", colorBy: "status" },
      { id: "d_equipment", type: "bar", title: "Equipment asked for", dimension: "equipment", metric: requests(), stackBy: "mode", orientation: "horizontal", colorBy: "categorical" },
    ], grid: [
      { i: "d_map", x: 0, y: 0, w: 8, h: 13 }, { i: "d_region", x: 8, y: 0, w: 4, h: 13 },
      { i: "d_table", x: 0, y: 13, w: 12, h: 13 },
      { i: "d_ports", x: 0, y: 26, w: 7, h: 11 }, { i: "d_inbound", x: 7, y: 26, w: 5, h: 5 }, { i: "d_equipment", x: 7, y: 31, w: 5, h: 6 },
    ],
  };
  const followup: Page = {
    id: "followup", title: "Follow-up", widgets: [
      { id: "f_open", type: "kpi", title: "Open requests", metric: requests(IS_OPEN), good: "none", onClick: IS_OPEN, secondary: { metric: sum("containers", IS_OPEN), label: "containers" } },
      { id: "f_sales", type: "kpi", title: "Waiting on Sales", metric: requests({ field: "waiting_on", op: "eq", value: "Sales" }), good: "down", onClick: { field: "waiting_on", op: "eq", value: "Sales" }, secondary: { metric: requests({ field: "waiting_on", op: "eq", value: "Procurement" }), label: "waiting on Procurement" } },
      { id: "f_process", type: "kpi", title: "Under process", metric: requests(stage("Under process")), good: "none", onClick: stage("Under process"), secondary: { metric: requests(stage("Quote pending")), label: "quotes not shared yet" } },
      { id: "f_noquote", type: "kpi", title: "No quote received", metric: requests(stage("No quote received")), good: "down", onClick: stage("No quote received"), secondary: { metric: requests({ field: "quote_status", op: "eq", value: "CIF (supplier arranges freight)" }), label: "CIF, supplier arranges" } },
      table({ id: "f_waiting", title: "Waiting for confirmation", subtitle: "Quote shared, the requesting side has not confirmed", filter: stage("Waiting for confirmation"), columns: ["request", "requestor", "waiting_on", "lane", "mode", "equipment", "containers", "remarks"], sort: { field: "month_start", dir: "asc" }, pageSize: 20 }),
      table({ id: "f_process_t", title: "Under process and quotes pending", subtitle: "Being worked on, or asked for and not yet shared", filter: stage("Under process", "Quote pending"), columns: ["request", "requestor", "lane", "mode", "equipment", "quote_status", "stage", "remarks"], sort: { field: "month_start", dir: "asc" }, pageSize: 15 }),
      { id: "f_open_month", type: "bar", title: "Open requests by month raised", subtitle: "Older open requests are worth a chase", dimension: "month", metric: requests(IS_OPEN), stackBy: "stage", filter: IS_OPEN, sort: "date", orientation: "vertical", colorBy: "status" },
      table({ id: "f_executed", title: "Executed", subtitle: "Requests that became shipments", filter: EXECUTED, columns: ["request", "requestor", "lane", "mode", "equipment", "containers", "product", "remarks"], sort: { field: "month_start", dir: "desc" }, pageSize: 15 }),
    ], grid: [
      { i: "f_open", x: 0, y: 0, w: 3, h: 3 }, { i: "f_sales", x: 3, y: 0, w: 3, h: 3 }, { i: "f_process", x: 6, y: 0, w: 3, h: 3 }, { i: "f_noquote", x: 9, y: 0, w: 3, h: 3 },
      { i: "f_waiting", x: 0, y: 3, w: 12, h: 12 }, { i: "f_process_t", x: 0, y: 15, w: 8, h: 9 }, { i: "f_open_month", x: 8, y: 15, w: 4, h: 9 }, { i: "f_executed", x: 0, y: 24, w: 12, h: 11 },
    ],
  };
  const reconciliation: Page = {
    id: "reconciliation", title: "Reconciliation", widgets: [
      { id: "recon", type: "auxTable", title: "Against the sheet's own pivot", subtitle: "What the dashboard counts next to the pivot table in the workbook", sheet: "reconciliation", columns: ["check", "report", "sheet", "note"], rowLabel: "checks", pageSize: 30 },
    ], grid: [{ i: "recon", x: 0, y: 0, w: 12, h: 14 }],
  };
  const register: Page = {
    id: "register", title: "Register", widgets: [
      table({ id: "register", title: "All quote requests", columns: ["request", "direction", "requested_by", "requestor", "origin", "destination", "port", "quote_status", "outcome", "stage", "mode", "qty_raw", "containers", "teu", "equipment", "waiting_on", "product", "remarks"], sort: { field: "month_start", dir: "desc" }, search: true, pageSize: 50 }),
    ], grid: [{ i: "register", x: 0, y: 0, w: 12, h: 18 }],
  };
  const quality: Page = { id: "quality", title: "Data quality", widgets: [{ id: "quality", type: "quality", title: "Data quality" }], grid: [{ i: "quality", x: 0, y: 0, w: 12, h: 16 }] };
  return {
    version: 1, dateField: "month_start",
    pages: [overview, monthly, destinations, followup, reconciliation, register, quality],
    filters: [
      { kind: "select", field: "month", label: "Month" }, { kind: "select", field: "direction", label: "Direction" }, { kind: "select", field: "mode", label: "Mode" },
      { kind: "select", field: "stage", label: "Stage" }, { kind: "select", field: "country", label: "Country" }, { kind: "select", field: "requestor", label: "Requestor" },
      { kind: "search", field: "lane", label: "Search" },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reconciliation against the workbook's pivot

const fmt = (n: number) => n.toLocaleString("en-US");

/** The pivot sheet: "Row Labels" / outcome columns / "Grand Total", filtered to one direction in its first row. */
function readPivot(grid: RawCell[][]): { direction: string | null; outcomes: string[]; rows: { label: string; counts: number[]; total: number }[]; total: number[]; grand: number } | null {
  const headerIdx = grid.findIndex((r) => normKey(r[0]) === "row labels");
  if (headerIdx < 0) return null;
  const header = grid[headerIdx].map((v) => cleanText(v ?? ""));
  const totalCol = header.findIndex((h) => /grand total/i.test(h));
  const outcomeCols = header.map((h, i) => ({ h, i })).filter((x) => x.i > 0 && x.i !== totalCol && x.h);
  const dirRow = grid.slice(0, headerIdx).find((r) => /inbound|outbound/i.test(String(r[0] ?? "")));
  const rows: { label: string; counts: number[]; total: number }[] = [];
  let total: number[] = outcomeCols.map(() => 0), grand = 0;
  for (const r of grid.slice(headerIdx + 1)) {
    const label = cleanText(r[0] ?? "");
    if (!label) continue;
    const counts = outcomeCols.map((c) => Number(r[c.i] ?? 0) || 0);
    const t = totalCol >= 0 ? Number(r[totalCol] ?? 0) || 0 : counts.reduce((a, b) => a + b, 0);
    if (/grand total/i.test(label)) { total = counts; grand = t; continue; }
    rows.push({ label, counts, total: t });
  }
  return { direction: dirRow ? readDirection(dirRow[1] ?? null) : null, outcomes: outcomeCols.map((c) => readOutcome(c.h)), rows, total, grand };
}

export function quotesAux(wb: ParsedWorkbook): Record<string, AuxSheet> {
  const sheet = wb.sheets.find((s) => s.name === QUOTES_SHEET);
  if (!sheet) return {};
  const rows = sheet.rows.map((r) => r.cells);
  const pivotName = Object.keys(wb.grids ?? {}).find((k) => wb.grids![k].some((r) => normKey(r[0]) === "row labels"));
  const pivot = pivotName ? readPivot(wb.grids![pivotName]) : null;
  const out: Record<string, ColumnValue>[] = [];
  const add = (check: string, report: string, sheetValue: string | null, note: string) => out.push({ check, report, sheet: sheetValue, note });
  const inDir = pivot?.direction ? rows.filter((r) => r["Direction"] === pivot.direction) : rows;
  const months = [...new Set(rows.map((r) => r["Month"]).filter(Boolean))] as string[];
  add("Quote requests", fmt(rows.length), null, `${fmt(months.length)} months, ${months[0] ?? "—"} to ${months[months.length - 1] ?? "—"}. ${fmt(rows.filter((r) => r["Direction"] === "Outbound").length)} outbound (Sales), ${fmt(rows.filter((r) => r["Direction"] === "Inbound").length)} inbound (Procurement).`);
  if (!pivot) { add("Pivot sheet", "—", null, "No pivot table found in the workbook to compare with."); }
  else {
    add(`${pivot.direction ?? "All"} requests in the pivot`, fmt(inDir.length), fmt(pivot.grand), inDir.length === pivot.grand ? "Matches the pivot's grand total." : `The pivot was not refreshed after the log changed (${fmt(inDir.length - pivot.grand)} rows difference).`);
    pivot.outcomes.forEach((o, i) => {
      const mine = inDir.filter((r) => r["Outcome"] === o).length, theirs = pivot.total[i];
      add(`${pivot.direction ?? "All"} · ${o}`, fmt(mine), fmt(theirs), mine === theirs ? "Matches." : `Differs by ${fmt(mine - theirs)}.`);
    });
    // Spelling splits in the pivot: two rows for one country.
    // The pivot nests countries under the POL ("AL Foah" carries the grand total): only the country rows are compared.
    const countryRows = pivot.rows.filter((r) => r.total !== pivot.grand && !/al foah/i.test(r.label));
    const byCanon = new Map<string, Set<string>>();
    for (const r of countryRows) { const c = readCountry(r.label); const k = c?.name ?? r.label; byCanon.set(k, (byCanon.get(k) ?? new Set()).add(r.label)); }
    const splits = [...byCanon.entries()].filter(([, labels]) => labels.size > 1);
    if (splits.length) add("Countries split by spelling in the pivot", fmt(splits.length), null, splits.map(([k, labels]) => `${k}: ${[...labels].map((l) => `"${l}"`).join(" + ")}`).join("; ") + ". The dashboard counts each as one country.");
    const portsAsCountries = [...new Set(countryRows.map((r) => r.label).filter((l) => PORTS[normKey(l)]))];
    if (portsAsCountries.length) add("Ports listed as countries in the pivot", fmt(portsAsCountries.length), null, portsAsCountries.map((l) => `${l} → ${PORTS[normKey(l)].country}`).join(", ") + ". Counted under the country, with the port kept.");
    const others = rows.filter((r) => pivot.direction && r["Direction"] !== pivot.direction);
    if (others.length) add(`Requests not in the pivot`, fmt(others.length), "0", `The pivot is filtered to ${pivot.direction?.toLowerCase()} only; ${fmt(others.length)} ${others.length === 1 ? "request is" : "requests are"} ${pivot.direction === "Outbound" ? "inbound" : "outbound"} (${fmt(others.filter((r) => r["Outcome"] === "Executed").length)} executed).`);
  }
  const noQty = rows.filter((r) => !r["Quantity (as typed)"]).length, unparsed = rows.filter((r) => r["Quantity note"] && r["Containers"] === null && r["Weight (kg)"] === null).length;
  add("Quantity parsed", fmt(rows.length - noQty - unparsed), null, `${fmt(noQty)} requests have no quantity typed; ${fmt(unparsed)} have one the dashboard could not read as containers or weight (kept as a note).`);
  const corrected = rows.filter((r) => r["Corrections"]).length;
  add("Spellings corrected", fmt(corrected), null, corrected ? "Countries and ports folded to one spelling; each correction is listed on the Data quality page and on the row." : "Nothing needed correcting.");
  const assumed = rows.filter((r) => r["Corrections"] && String(r["Corrections"]).includes("upload date")).length;
  if (assumed) add("Year assumed", fmt(assumed), null, "No year in the sheet or tab name for these rows; the year came from the upload date. Name the tab by year (\"2026\") or add a Year column to make it explicit.");
  return {
    reconciliation: {
      id: "reconciliation", label: "Reconciliation",
      columns: [{ id: "check", label: "Check", type: "string" }, { id: "report", label: "This report", type: "string" }, { id: "sheet", label: "Pivot in the sheet", type: "string" }, { id: "note", label: "Note", type: "string", wrap: true }],
      rows: out,
    },
  };
}

export const quotesMonthField = { label: "Month", date: "month_start" } as const;

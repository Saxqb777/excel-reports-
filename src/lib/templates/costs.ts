import type { AuxSheet, ColumnValue, Field, FilterExpr, ParsedSheet, ParsedWorkbook, RawCell, RawRow, SchemaMap } from "@/lib/schema/types";
import { cleanText, normKey } from "@/lib/schema/types";
import { toDate } from "@/lib/schema/normalize";
import { readCountry, readPort, title } from "@/lib/templates/quotes";
import type { Layout, Page, Widget } from "@/lib/dashboard/types";
import type { MetricSpec } from "@/lib/engine/metrics";

/**
 * Import shipment & cost sheet: the log a logistics team keeps of every import shipment (one B/L) and every charge
 * paid for it. One row = one charge line (customs BOE, port charges, sea freight, demurrage & detention, transport…)
 * carrying the shipment's details again; the shipment's first row also carries its container count, the supplier's
 * invoice and the cost of goods. Shipments with no charge yet are a single row with no cost code. A second sheet,
 * "Abbreviation", is the owner's legend of cost codes with standard rates per port.
 *
 * What the preparation keeps true (the owner's brief: every charge recorded separately, freight and clearance totals,
 * cost per shipment, monthly trends, filters by month / year / supplier / origin / mode):
 * - One tidy "Cost lines" row per sheet row with a stable key ("MEDUJW078003 · 2": the B/L and the line's order).
 *   Shipment details are inherited from the B/L's first row where a charge line left them blank.
 * - The reporting month comes from a Reporting month column when the sheet has one, else the shipment's arrival date
 *   (Current ETA), else the charge's invoice date; the source is a column. The year of a date more than a year after
 *   the arrival is corrected to the arrival's year (one invoice typed 2027), and noted.
 * - Cost codes are folded (Storage/STORAGE, blank with an amount → Uncoded) and labelled from the legend sheet; a BOE
 *   line over AED 500 is a customs duty, under it the bill-of-entry fee (the sheet uses one code for both). Each code
 *   belongs to a cost group: Freight, Customs & port, Demurrage & detention (kept apart: it is the avoidable money),
 *   Uncoded. "Clearance" in the owner's sense = Customs & port + Demurrage & detention.
 * - Cost of goods is in the supplier's currency; converted to AED at fixed rates so logistics cost can be read against
 *   goods value. Spellings of suppliers, lines, warehouses, container types and countries are folded with a note;
 *   a port typed as a country or a country typed as a port is put right.
 * - Staff names in the payment columns are never shown: an IOU in a person's name becomes "Staff IOU".
 */

export const COSTS_SHEET = "Cost lines";
export const RATES: Record<string, number> = { AED: 1, USD: 3.6725, EUR: 4.28, EURO: 4.28, GBP: 4.9, SAR: 3.6725 / 3.75 };
const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_WORDS: Record<string, number> = {};
["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].forEach((m, i) => { MONTH_WORDS[m] = i; MONTH_WORDS[m.slice(0, 3)] = i; });
MONTH_WORDS.sept = 8;

const HEADERS = [
  "Line", "Shipment", "Line no", "PO", "Supplier", "Commodity", "Incoterm", "Origin country", "Origin port", "Region", "Via port", "Destination port", "Warehouse", "Lane", "Shipping line", "Mode", "Container type", "Containers", "Container no",
  "Arrival", "Month", "Month start", "Year", "Month source", "Goods invoice", "Goods currency", "Cost of goods", "Cost of goods (AED)", "BOE no",
  "Invoice date", "Service invoice", "Cost code", "Charge", "Cost group", "Amount (AED)", "Paid to", "Payment via", "Payment owner", "Status", "SRN", "Deposited (AED)",
  "Freight (AED)", "Customs & port (AED)", "Demurrage & detention (AED)", "Clearance (AED)", "Uncoded (AED)", "Shipment row", "Has charge", "Sheet row", "Corrections",
];
export const GROUPS = ["Freight", "Customs & port", "Demurrage & detention", "Uncoded"];
const STATUSES = ["Pending", "Submitted", "Completed", "Not recorded"];

/** Code → label and group. The legend sheet overrides the label when it names the code. */
const CODES: Record<string, { label: string; group: string }> = {
  SFRT: { label: "Sea freight", group: "Freight" }, ILF: { label: "Inland freight (import)", group: "Freight" }, LF: { label: "Local freight", group: "Freight" }, DTC: { label: "Destination transport", group: "Freight" },
  TRANSPORT: { label: "Transport", group: "Freight" }, DEO: { label: "Delivery order & destination charges", group: "Freight" }, "DROP OFF": { label: "Container drop-off", group: "Freight" }, TLUC: { label: "Trucking (TLUC)", group: "Freight" },
  BOE: { label: "Bill of entry (customs)", group: "Customs & port" }, DPC: { label: "Port charges", group: "Customs & port" }, THC: { label: "Terminal handling", group: "Customs & port" }, MOFA: { label: "MOFA attestation", group: "Customs & port" },
  DOE: { label: "Delivery order expenses", group: "Customs & port" }, DM: { label: "Dubai Municipality", group: "Customs & port" }, DUMU: { label: "Dubai Municipality", group: "Customs & port" }, RMCI: { label: "Reefer monitoring", group: "Customs & port" },
  CUIS: { label: "Customs inspection", group: "Customs & port" }, MUIS: { label: "Municipality inspection", group: "Customs & port" }, TOK: { label: "Token", group: "Customs & port" }, STORAGE: { label: "Storage", group: "Customs & port" },
  "D&D": { label: "Demurrage & detention", group: "Demurrage & detention" }, DET: { label: "Detention", group: "Demurrage & detention" }, DEM: { label: "Demurrage", group: "Demurrage & detention" },
  UNCODED: { label: "Uncoded charge", group: "Uncoded" },
};
const CODE_ALIASES: Record<string, string> = { "dropp off": "DROP OFF", "drop off": "DROP OFF", "dropoff": "DROP OFF", transport: "TRANSPORT", transportation: "TRANSPORT", storage: "STORAGE", "d&d": "D&D", "d & d": "D&D", dnd: "D&D", "dumu": "DUMU", "dm": "DM" };

const LINES: Record<string, string> = { maersk: "Maersk", "cma cgm": "CMA CGM", cma: "CMA CGM", msc: "MSC", "msc (mediterranean shipping)": "MSC", "msc _dubai": "MSC", "msc dubai": "MSC", cordelia: "Cordelia", "kmtc line": "KMTC", kmtc: "KMTC", esl: "ESL", "emirates shipping line": "ESL", "gt lines": "GT Line", "gt line": "GT Line", unifeeder: "Unifeeder", "interliner services": "Interliner", hapag: "Hapag-Lloyd", "hapag lloyd": "Hapag-Lloyd", "hapag-lloyd": "Hapag-Lloyd", one: "ONE", cosco: "COSCO", oocl: "OOCL", evergreen: "Evergreen" };
const WAREHOUSES: Record<string, string> = { "silal /wh": "Silal WH", "silal/wh": "Silal WH", silal: "Silal WH", oceanfair: "Ocean Fair", "ocean fair": "Ocean Fair", gsl: "GSL", "khatam al shikla": "Khatam Al Shikla", "khatam al sikhla": "Khatam Al Shikla", "al watba": "Al Wathba", wathba: "Al Wathba", "al wathba": "Al Wathba" };
const SUPPLIERS: Record<string, string> = { "agristo nv": "Agristo", agristo: "Agristo", "agthia egypt": "Agthia Egypt", "agthia group - egypt": "Agthia Egypt", "dawn frozen foods": "Dawn Frozen Foods", "dawn frozen foods company pvt ltd": "Dawn Frozen Foods", "master food": "Master Food", ricegrowers: "Ricegrowers", "reliance industries limited": "Reliance Industries", "tex yearindustrial adhesives": "Tex Year Industrial Adhesives", "tex year industrial adhesives": "Tex Year Industrial Adhesives", "comex company srl": "Comex", "ardo nv": "Ardo", "dipitt itt food": "Dipitt" };
const PAID_TO: { match: RegExp; value: string }[] = [
  { match: /shipping line|^msc|^cma|maersk|kavak/i, value: "Shipping line" }, { match: /port charges|dubai trade|dp world|dpw/i, value: "Port / terminal" }, { match: /customs/i, value: "Customs" },
  { match: /ministry|mofa|moait/i, value: "Ministry" }, { match: /municipal/i, value: "Municipality" }, { match: /transport|trucking/i, value: "Transporter" }, { match: /clearance|agent/i, value: "Clearance agent" }, { match: /destination/i, value: "Destination charges" },
];

type Cols = { po?: string; incoterm?: string; supplier: string; country?: string; pol?: string; viaPort?: string; pod?: string; bl: string; containerNo?: string; warehouse?: string; containers?: string; ctype?: string; line?: string; mode?: string; commodity?: string; eta?: string; goodsInvoice?: string; goodsCurrency?: string; goods?: string; boe?: string; invDate?: string; svcInvoice?: string; code: string; amtCurrency?: string; amount: string; service?: string; payVia?: string; payOwner?: string; srn?: string; status?: string; deposited?: string; month?: string };
const pick = (headers: string[], ...names: string[]) => headers.find((h) => names.includes(normKey(h)));
/** The nth header with this normalised name (the sheet has two "Currency" columns). */
const pickNth = (headers: string[], n: number, ...names: string[]) => headers.filter((h) => names.includes(normKey(h)))[n];

function costColumns(sheet: ParsedSheet): Cols | null {
  const h = sheet.headers;
  const supplier = pick(h, "supplier name", "supplier", "vendor"), bl = pick(h, "b/l number", "bl number", "bl no", "bill of lading", "shipment reference", "shipment ref"), code = pick(h, "cost code", "charge code", "code"), amount = pick(h, "invoice amount", "amount", "charge amount");
  if (!supplier || !bl || !code || !amount) return null;
  const currencies = h.filter((x) => /^currency/.test(normKey(x)));
  return {
    supplier, bl, code, amount, po: pick(h, "po number", "po no", "po"), incoterm: pick(h, "incoterm", "incoterms"), country: pick(h, "country of origin", "origin country", "origin"), pol: pick(h, "port of loading", "origin port", "pol"),
    viaPort: pick(h, "initial port of delivery", "via port", "transhipment port"), pod: pick(h, "final port of delivery", "destination port", "pod", "port of discharge"), containerNo: pick(h, "container number", "container no"), warehouse: pick(h, "final wh destination", "warehouse", "final destination"),
    containers: pick(h, "no. of containers", "no of containers", "containers", "quantity"), ctype: pick(h, "container type", "equipment"), line: pick(h, "shipping line", "carrier", "forwarder", "transportation provider"), mode: pick(h, "shipment mode", "mode", "transportation mode"),
    commodity: pick(h, "commodity", "product", "goods"), eta: pick(h, "current eta", "eta", "arrival date", "shipment date"), goodsInvoice: pick(h, "supplier invoice number", "supplier invoice"), goodsCurrency: currencies[0] && normKey(currencies[0]) !== normKey(pickNth(h, 1, "currency") ?? "") ? currencies[0] : currencies.length > 1 ? currencies[0] : undefined,
    goods: pick(h, "cost of goods", "goods value", "invoice value"), boe: pick(h, "boe", "boe number", "boe no"), invDate: pick(h, "invoice date"), svcInvoice: pick(h, "service provider invoice", "service invoice", "provider invoice"),
    amtCurrency: currencies.length > 1 ? currencies[1] : currencies[0], service: pick(h, "type of service", "service type", "service"), payVia: pick(h, "payment via", "payment method", "paid via"), payOwner: pick(h, "payment owner", "paid by", "owner"),
    srn: pick(h, "srn number", "srn no", "srn"), status: pick(h, "expense submitted", "payment status", "status"), deposited: pick(h, "deposited amount"), month: pick(h, "reporting month", "reporting month and year", "month", "report month"),
  };
}

/** The prepared sheet, by its own headers. */
export function matchesCosts(headers: string[]): boolean {
  return ["line", "shipment", "cost group", "amount (aed)", "month start"].every((k) => headers.some((h) => normKey(h) === k));
}
export const isCostsSource = (sheet: ParsedSheet): boolean => costColumns(sheet) !== null;

const text = (v: RawCell): string | null => { if (v === null || v === undefined) return null; const s = cleanText(v); return s ? s : null; };
const num = (v: RawCell): number | null => { if (typeof v === "number") return Number.isFinite(v) ? v : null; const s = text(v); if (!s) return null; const n = Number(s.replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
type Note = { field: string; from: string; to: string; reason: string };
/** Same text apart from case, spaces and punctuation ("40 HC" / "40HC", "MAERSK" / "Maersk"): folded silently, not worth a note. */
const sameWords = (a: string, b: string) => normKey(a).replace(/[^a-z0-9]+/g, "") === normKey(b).replace(/[^a-z0-9]+/g, "");
const fold = (raw: string | null, map: Record<string, string>, notes: Note[], field: string, reason: string): string | null => {
  if (!raw) return null;
  const v = map[normKey(raw)] ?? title(raw).replace(/\bNv\b/g, "NV").replace(/\bSrl\b/g, "SRL").replace(/\bLlc\b/g, "LLC").replace(/\bWh\b/g, "WH");
  if (!sameWords(v, raw)) notes.push({ field, from: raw, to: v, reason });
  return v;
};
/** "40 HC" → 40HC; "40 RH" → 40RH (reefer high cube); "20 FT"/"20 ST"/"20 SD" → 20FT/20ST/20SD. */
function readType(v: RawCell): string | null {
  const s = text(v);
  if (!s) return null;
  const k = normKey(s).replace(/\s+/g, "");
  const m = /^(20|40|45)(hc|hq|rh|rf|hr|ft|st|sd|gp|dv)?$/.exec(k);
  if (!m) return s.toUpperCase();
  const size = m[1], unit = (m[2] ?? "ft").toUpperCase();
  return `${size}${unit === "HQ" ? "HC" : unit === "RF" || unit === "HR" ? "RH" : unit === "GP" || unit === "DV" ? "FT" : unit}`;
}
function readMode(v: RawCell): string | null { const k = normKey(v); if (!k) return null; if (/air/.test(k)) return "Air"; if (/sea|ocean/.test(k) && /road|truck|multi/.test(k)) return "Multimodal"; if (/sea|ocean|fcl|lcl/.test(k)) return "Sea"; if (/road|truck|land/.test(k)) return "Road"; if (/multi/.test(k)) return "Multimodal"; return title(k); }
function readStatus(v: RawCell): string { const k = normKey(v); if (!k) return "Not recorded"; if (/complet|paid|done|closed/.test(k)) return "Completed"; if (/submit/.test(k)) return "Submitted"; if (/pend|await|open/.test(k)) return "Pending"; return title(k); }
/** Payment channel without people's names: an IOU or card in someone's name is "Staff IOU" / "Staff card". */
function readPayVia(v: RawCell): string | null {
  const k = normKey(v);
  if (!k) return null;
  if (/ccc|card/.test(k)) return "Staff card";
  if (/iou/.test(k)) return "Staff IOU";
  if (/advance account/.test(k)) return "Advance account";
  if (/advance deposit/.test(k)) return "Advance deposit";
  if (/advance payment|advance$/.test(k)) return "Advance payment";
  if (/bank transfer|transfer|srn/.test(k)) return "Bank transfer (SRN)";
  if (/direct debit/.test(k)) return "Direct debit";
  if (/agent/.test(k)) return "Paid to agent";
  if (/dpw|dp world|dubai trade/.test(k)) return "Dubai Trade / DP World";
  if (/oman/.test(k)) return "Oman";
  if (/pending/.test(k)) return null;
  if (k === "nxn") return "NXN";
  return title(k);
}
function readPayOwner(v: RawCell): string | null {
  const k = normKey(v);
  if (!k) return null;
  if (/iou|maitha|dev\b|\b\d\b/.test(k) && !/customs|world|trade|shipping|line/.test(k)) return "Staff";
  if (/srn|transfer/.test(k)) return "As per SRN";
  if (/dubai customs/.test(k)) return "Dubai Customs";
  if (/auh|abu dhabi/.test(k)) return "Abu Dhabi Customs";
  if (/dp world|dpw/.test(k)) return "DP World";
  if (/dubai trade/.test(k)) return "Dubai Trade";
  if (/shipping line|^cma|^msc|kmtc|maersk/.test(k)) return "Shipping line";
  if (/direct debit/.test(k)) return "Direct debit";
  if (/pending/.test(k)) return null;
  if (k === "nxn") return "NXN";
  return title(k).replace(/\bL L C\b/, "LLC");
}
function readPaidTo(service: RawCell, code: string | null): string | null {
  const s = text(service);
  if (s) { for (const r of PAID_TO) if (r.match.test(s)) return r.value; return title(s); }
  if (!code) return null;
  const g = CODES[code]?.group;
  if (code === "SFRT" || code === "D&D" || code === "DEO" || code === "DET") return "Shipping line";
  if (code === "BOE") return "Customs";
  if (code === "DPC" || code === "THC") return "Port / terminal";
  if (code === "MOFA") return "Ministry";
  if (code === "DM" || code === "DUMU") return "Municipality";
  if (g === "Freight") return "Transporter";
  return null;
}
function readCode(v: RawCell, amount: number | null): string | null {
  const s = text(v);
  if (!s) return amount !== null ? "UNCODED" : null;
  const k = normKey(s);
  return CODE_ALIASES[k] ?? s.toUpperCase().replace(/\s+/g, " ");
}
/** A month cell: a month word, "Oct 2026", a typed date, or "10/2026". */
function readMonthCell(v: RawCell, yearHint: number | null): { month: number; year: number } | null {
  if (v === null || v === undefined) return null;
  const t = toDate(v);
  if (t !== null && !(typeof v === "string" && /^[A-Za-z]+$/.test(v.trim()))) { const d = new Date(t); return { month: d.getUTCMonth(), year: d.getUTCFullYear() }; }
  const s = String(v).trim();
  const my = /^([A-Za-z]+)\.?[\s,'-]*(\d{2}|\d{4})$/.exec(s);
  if (my && MONTH_WORDS[my[1].toLowerCase()] !== undefined) return { month: MONTH_WORDS[my[1].toLowerCase()], year: my[2].length === 2 ? 2000 + Number(my[2]) : Number(my[2]) };
  const nm = /^(\d{1,2})[\/.-](\d{4})$/.exec(s);
  if (nm && Number(nm[1]) >= 1 && Number(nm[1]) <= 12) return { month: Number(nm[1]) - 1, year: Number(nm[2]) };
  const word = MONTH_WORDS[s.toLowerCase().replace(/\.$/, "")];
  if (word !== undefined && yearHint) return { month: word, year: yearHint };
  return null;
}

interface Head { po: string | null; incoterm: string | null; supplier: string | null; commodity: string | null; country: string | null; region: string | null; pol: string | null; via: string | null; pod: string | null; warehouse: string | null; line: string | null; mode: string | null; ctype: string | null; eta: number | null; goodsInvoice: string | null; goodsCurrency: string | null; goods: number | null; boe: string | null; month: { month: number; year: number; source: string } | null }

function readShipmentHead(r: RawRow, c: Cols, prev: Head | null, allNotes: Note[]): Head {
  const cell = (h?: string): RawCell => (h ? r.cells[h] ?? null : null);
  const inherit = <T,>(mine: T | null, theirs: T | null | undefined): T | null => (mine !== null && mine !== undefined ? mine : theirs ?? null);
  // Spelling folds are the same on every line of a shipment: noted once, on its first row.
  const notes = prev ? [] : allNotes;
  const countryRaw = text(cell(c.country)), polRaw = text(cell(c.pol));
  let cty = countryRaw ? readCountry(countryRaw) : null;
  let polText = polRaw;
  if (countryRaw && cty && cty.region !== "Other" && !sameWords(cty.name, countryRaw)) {
    const asPort = readPort(countryRaw, cty.name);
    const isPort = asPort.port !== null && sameWords(asPort.port, countryRaw) && asPort.mismatch === null && readCountry(countryRaw)?.name === cty.name && normKey(countryRaw) !== normKey(cty.name);
    if (isPort && !polRaw) polText = asPort.port;
    notes.push({ field: "origin_country", from: countryRaw, to: cty.name, reason: isPort ? `"${countryRaw}" is a port; its country is used` : "Country spelling folded" });
  }
  let pol: string | null = null;
  if (polText) {
    const asCountry = readCountry(polText);
    if (asCountry && asCountry.region !== "Other" && normKey(asCountry.name) === normKey(polText.replace(/,.*$/, ""))) { if (!cty) cty = asCountry; notes.push({ field: "origin_port", from: polText, to: "(blank)", reason: `"${polText}" is a country, not a port; port left blank` }); }
    else {
      const p = readPort(polText.replace(/,.*$/, ""), cty?.name ?? null);
      pol = p.port ?? title(polText.replace(/,.*$/, "").toLowerCase());
      if (p.note) notes.push({ field: "origin_port", from: polText, to: pol, reason: p.note });
      else if (!sameWords(pol, polText)) notes.push({ field: "origin_port", from: polText, to: pol, reason: "Port spelling folded" });
      if (!cty && p.port) cty = readCountry(polText) ?? (p.port ? (readCountry(polText) ?? null) : null);
    }
  }
  const viaRaw = text(cell(c.viaPort)), podRaw = text(cell(c.pod));
  const via = viaRaw ? (readPort(viaRaw, "UAE").port ?? title(viaRaw.replace(/\s*port$/i, ""))) : null;
  const pod = podRaw ? (readPort(podRaw, "UAE").port ?? title(podRaw.replace(/\s*port$/i, ""))) : null;
  const samePort = (a: string, b: string) => sameWords(a, b) || sameWords(a, b.replace(/\s*port$/i, "")) || sameWords(a.replace(/\s*port$/i, ""), b);
  if (viaRaw && via && !samePort(via, viaRaw)) notes.push({ field: "via_port", from: viaRaw, to: via, reason: "Port spelling folded" });
  if (podRaw && pod && !samePort(pod, podRaw)) notes.push({ field: "dest_port", from: podRaw, to: pod, reason: "Port spelling folded" });
  const etaRaw = cell(c.eta);
  const eta = toDate(etaRaw);
  const goodsCur = text(cell(c.goodsCurrency));
  const yearHint = eta !== null ? new Date(eta).getUTCFullYear() : null;
  const monthCell = c.month ? readMonthCell(cell(c.month), yearHint ?? prev?.month?.year ?? null) : null;
  const head: Head = {
    po: inherit(text(cell(c.po)), prev?.po), incoterm: inherit(text(cell(c.incoterm)) ? title(text(cell(c.incoterm))!.replace(/\s*,\s*/g, " & ").replace(/ex-?work/i, "Ex works")) : null, prev?.incoterm),
    supplier: inherit(fold(text(cell(c.supplier)), SUPPLIERS, notes, "supplier", "Supplier spelling folded"), prev?.supplier), commodity: inherit(text(cell(c.commodity)) ? title(text(cell(c.commodity))!) : null, prev?.commodity),
    country: inherit(cty?.name ?? (countryRaw ? title(countryRaw) : null), prev?.country), region: inherit(cty?.region ?? null, prev?.region), pol: inherit(pol, prev?.pol), via: inherit(via, prev?.via), pod: inherit(pod, prev?.pod),
    warehouse: inherit(fold(text(cell(c.warehouse)), WAREHOUSES, notes, "warehouse", "Warehouse spelling folded"), prev?.warehouse), line: inherit(fold(text(cell(c.line)), LINES, notes, "shipping_line", "Shipping line spelling folded"), prev?.line),
    mode: inherit(readMode(cell(c.mode)), prev?.mode), ctype: inherit(readType(cell(c.ctype)), prev?.ctype), eta: inherit(eta, prev?.eta),
    goodsInvoice: inherit(text(cell(c.goodsInvoice)), prev?.goodsInvoice), goodsCurrency: inherit(goodsCur ? goodsCur.toUpperCase().replace(/^EURO$/, "EUR") : null, prev?.goodsCurrency), goods: num(cell(c.goods)), boe: inherit(text(cell(c.boe)), prev?.boe),
    month: monthCell ? { ...monthCell, source: "Reporting month column" } : null,
  };
  const ctypeRaw = text(cell(c.ctype));
  if (ctypeRaw && head.ctype && !sameWords(ctypeRaw, head.ctype)) notes.push({ field: "container_type", from: ctypeRaw, to: head.ctype, reason: "Container type folded" });
  if (prev && eta !== null && prev.eta !== null && eta !== prev.eta) allNotes.push({ field: "arrival", from: new Date(eta).toISOString().slice(0, 10), to: new Date(prev.eta).toISOString().slice(0, 10), reason: "Arrival date differs from the shipment's first row; the first row's date is used" });
  if (prev && prev.eta !== null) head.eta = prev.eta;
  return head;
}

interface Line { bl: string; n: number; row: number; head: Head; isHead: boolean; containers: number | null; containerNo: string | null; invDate: number | null; svcInvoice: string | null; code: string | null; amount: number | null; paidTo: string | null; payVia: string | null; payOwner: string | null; status: string; srn: string | null; deposited: number | null; notes: Note[] }

function readLines(sheet: ParsedSheet, c: Cols): Line[] {
  const heads = new Map<string, Head>();
  const counts = new Map<string, number>();
  const out: Line[] = [];
  let lastBl: string | null = null;
  for (const r of sheet.rows) {
    const cell = (h?: string): RawCell => (h ? r.cells[h] ?? null : null);
    const blRaw = text(cell(c.bl));
    const supplier = text(cell(c.supplier));
    const amount = num(cell(c.amount));
    if (!blRaw && !supplier && amount === null) continue;
    if (blRaw && /^(grand\s+)?total\b/i.test(blRaw)) continue;
    const notes: Note[] = [];
    const bl: string = blRaw ? blRaw.replace(/\s+/g, "").toUpperCase() : (lastBl ?? "No B/L");
    if (!blRaw) notes.push({ field: "shipment", from: "(blank)", to: bl, reason: "No B/L on the line; taken from the line above" });
    lastBl = bl;
    const prev = heads.get(bl) ?? null;
    const head = readShipmentHead(r, c, prev, notes);
    if (!prev) heads.set(bl, head);
    const n = (counts.get(bl) ?? 0) + 1;
    counts.set(bl, n);
    const code = readCode(cell(c.code), amount);
    let invDate = toDate(cell(c.invDate));
    const invRaw = text(cell(c.invDate));
    if (invDate === null && invRaw) {
      const dm = /^(\d{1,2})[\/.-](\d{1,2})[\/.-]\d{0,3}$/.exec(invRaw);
      const yr = head.eta !== null ? new Date(head.eta).getUTCFullYear() : null;
      if (dm && yr && Number(dm[2]) >= 1 && Number(dm[2]) <= 12 && Number(dm[1]) >= 1 && Number(dm[1]) <= 31) { invDate = Date.UTC(yr, Number(dm[2]) - 1, Number(dm[1])); notes.push({ field: "invoice_date", from: invRaw, to: new Date(invDate).toISOString().slice(0, 10), reason: "Invoice date typed without a year; the arrival's year is used" }); }
      else notes.push({ field: "invoice_date", from: invRaw, to: "(blank)", reason: "Invoice date could not be read" });
    }
    if (invDate !== null && head.eta !== null && invDate - head.eta > 365 * DAY) { const d = new Date(invDate); const fixed = Date.UTC(new Date(head.eta).getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); notes.push({ field: "invoice_date", from: d.toISOString().slice(0, 10), to: new Date(fixed).toISOString().slice(0, 10), reason: "Invoice year more than a year after arrival; read as the arrival's year" }); invDate = fixed; }
    const curRaw = text(cell(c.amtCurrency));
    if (amount !== null && curRaw && normKey(curRaw) !== "aed") notes.push({ field: "amount", from: `${amount} ${curRaw}`, to: `${amount}`, reason: `Charge typed in ${curRaw}; kept as typed and treated as AED, worth checking` });
    out.push({
      bl, n, row: r.row, head, isHead: n === 1, containers: num(cell(c.containers)), containerNo: text(cell(c.containerNo)), invDate, svcInvoice: text(cell(c.svcInvoice)), code, amount, paidTo: readPaidTo(cell(c.service), code),
      payVia: readPayVia(cell(c.payVia)), payOwner: readPayOwner(cell(c.payOwner)), status: amount === null ? "Not recorded" : readStatus(cell(c.status)), srn: text(cell(c.srn)), deposited: num(cell(c.deposited)), notes,
    });
  }
  // Container counts typed on a later row of the shipment (a second batch) are kept where they are; a shipment with none is noted once.
  for (const l of out) if (l.isHead && l.containers === null && !out.some((o) => o.bl === l.bl && o.containers !== null)) l.notes.push({ field: "containers", from: "(blank)", to: "(blank)", reason: "No container count typed for this shipment" });
  return out;
}

/** Legend sheet "Abbreviation": code → label (+ standard rates per port). */
function readLegend(grid: RawCell[][] | undefined): Map<string, { label: string; rates: Record<string, number> }> {
  const out = new Map<string, { label: string; rates: Record<string, number> }>();
  if (!grid) return out;
  const hi = grid.findIndex((r) => r.some((v) => /short form|code/i.test(String(v ?? ""))));
  if (hi < 0) return out;
  const header = grid[hi].map((v) => cleanText(v ?? ""));
  const codeCol = header.findIndex((h) => /short form|code/i.test(h)), labelCol = header.findIndex((h) => /type of charge|charge|description/i.test(h));
  const rateCols = header.map((h, i) => ({ h, i })).filter((x) => /rate/i.test(x.h));
  for (const r of grid.slice(hi + 1)) {
    const code = text(r[codeCol] ?? null);
    if (!code) continue;
    const label = title((text(r[labelCol] ?? null) ?? code).toLowerCase()).replace(/Frieght|Freeight/g, "Freight").replace(/Etnry/g, "Entry").replace(/Munc\./g, "Municipality").replace(/Reefer Monitor Charges-Imports/i, "Reefer monitoring");
    const rates: Record<string, number> = {};
    for (const rc of rateCols) { const v = num(r[rc.i] ?? null); if (v !== null) rates[rc.h.replace(/standard rate/i, "").trim()] = v; }
    out.set(code.toUpperCase(), { label, rates });
  }
  return out;
}

const labelFor = (code: string | null, amount: number | null, legend: Map<string, { label: string }>): string | null => {
  if (!code) return null;
  if (code === "BOE") return amount !== null && amount > 500 ? "Customs duty" : "Bill of entry fee";
  return CODES[code]?.label ?? legend.get(code)?.label ?? code;
};
const groupFor = (code: string | null): string | null => (code ? CODES[code]?.group ?? "Customs & port" : null);

/** Turns the shipment & cost sheet into one "Cost lines" sheet; other workbooks pass through untouched. */
export function prepareCostsWorkbook(wb: ParsedWorkbook): ParsedWorkbook {
  if (wb.sheets.some((s) => s.name === COSTS_SHEET)) return wb;
  const source = wb.sheets.find((s) => costColumns(s));
  if (!source) return wb;
  const c = costColumns(source)!;
  const legend = readLegend(Object.entries(wb.grids ?? {}).find(([k]) => /abbrev|legend|codes?/i.test(k))?.[1]);
  const lines = readLines(source, c);
  const rows: RawRow[] = lines.map((l, i) => {
    const h = l.head;
    const notes = [...l.notes];
    // Reporting month: the column, else the arrival month, else the invoice month.
    let month: { month: number; year: number } | null = h.month, source = h.month ? "Reporting month column" : "";
    if (!month && h.eta !== null) { const d = new Date(h.eta); month = { month: d.getUTCMonth(), year: d.getUTCFullYear() }; source = "Arrival date"; }
    if (!month && l.invDate !== null) { const d = new Date(l.invDate); month = { month: d.getUTCMonth(), year: d.getUTCFullYear() }; source = "Invoice date"; notes.push({ field: "month", from: "(no arrival date)", to: `${MONTHS[month.month]} ${month.year}`, reason: "No arrival date on the shipment; month taken from the charge's invoice date" }); }
    if (!month) { source = "No date"; notes.push({ field: "month", from: "(none)", to: "(blank)", reason: "No arrival or invoice date: the line has no reporting month" }); }
    const monthLabel = month ? `${MONTHS[month.month]} ${month.year}` : null;
    const code = l.code;
    const group = groupFor(code);
    const amt = l.amount;
    const goodsAed = l.isHead && h.goods !== null ? Math.round(h.goods * (RATES[h.goodsCurrency ?? "AED"] ?? NaN) * 100) / 100 : null;
    if (l.isHead && h.goods !== null && h.goodsCurrency && !(h.goodsCurrency in RATES)) notes.push({ field: "goods_aed", from: h.goodsCurrency, to: "(blank)", reason: `No rate for ${h.goodsCurrency}; goods value not converted` });
    if (l.isHead && h.goods !== null && !h.goodsCurrency) notes.push({ field: "goods_currency", from: "(blank)", to: "AED", reason: "No currency typed for the cost of goods; treated as AED" });
    const lane = h.pol || h.pod ? `${h.pol ?? h.country ?? "?"} → ${h.pod ?? "?"}` : null;
    const cells: Record<string, RawCell> = {
      "Line": `${l.bl} · ${l.n}`, "Shipment": l.bl, "Line no": l.n, "PO": h.po, "Supplier": h.supplier, "Commodity": h.commodity, "Incoterm": h.incoterm, "Origin country": h.country, "Origin port": h.pol, "Region": h.region, "Via port": h.via, "Destination port": h.pod, "Warehouse": h.warehouse, "Lane": lane,
      "Shipping line": h.line, "Mode": h.mode ?? "Sea", "Container type": h.ctype, "Containers": l.containers, "Container no": l.containerNo,
      "Arrival": h.eta !== null ? new Date(h.eta).toISOString() : null, "Month": monthLabel, "Month start": month ? new Date(Date.UTC(month.year, month.month, 1)).toISOString() : null, "Year": month ? month.year : null, "Month source": source || null,
      "Goods invoice": l.isHead ? h.goodsInvoice : null, "Goods currency": l.isHead ? h.goodsCurrency : null, "Cost of goods": l.isHead ? h.goods : null, "Cost of goods (AED)": goodsAed, "BOE no": h.boe,
      "Invoice date": l.invDate !== null ? new Date(l.invDate).toISOString() : null, "Service invoice": l.svcInvoice, "Cost code": code, "Charge": labelFor(code, amt, legend), "Cost group": group, "Amount (AED)": amt,
      "Paid to": l.paidTo, "Payment via": l.payVia, "Payment owner": l.payOwner, "Status": l.status, "SRN": l.srn, "Deposited (AED)": l.deposited,
      "Freight (AED)": group === "Freight" ? amt : null, "Customs & port (AED)": group === "Customs & port" ? amt : null, "Demurrage & detention (AED)": group === "Demurrage & detention" ? amt : null,
      "Clearance (AED)": group === "Customs & port" || group === "Demurrage & detention" ? amt : null, "Uncoded (AED)": group === "Uncoded" ? amt : null,
      "Shipment row": l.isHead ? 1 : 0, "Has charge": amt !== null ? 1 : 0, "Sheet row": l.row, "Corrections": notes.length ? JSON.stringify(notes) : null,
    };
    return { row: i + 2, cells };
  });
  const sheet: ParsedSheet = { name: COSTS_SHEET, headerRow: 1, headers: HEADERS, rows, stats: statsFor(HEADERS, rows), validations: {}, totalRowsInSheet: rows.length + 1 };
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
const cnt = (id: string, label: string, source: string, extra: Partial<Field> = {}): Field => ({ id, label, source, type: "number", role: "measure", format: "integer", aggregate: "sum", ...extra });
const GROUP = (g: string): FilterExpr => ({ field: "cost_group", op: "eq", value: g });
const HAS_CHARGE: FilterExpr = { field: "has_charge", op: "eq", value: 1 };
const HEAD: FilterExpr = { field: "shipment_row", op: "eq", value: 1 };

export function costsSchema(): SchemaMap {
  const fields: Field[] = [
    { id: "line", label: "Line", source: "Line", type: "string", role: "id" },
    dim("shipment", "Shipment (B/L)", "Shipment"),
    cnt("line_no", "Line no", "Line no", { hidden: true, noAnomalies: true }),
    dim("po", "PO", "PO"),
    dim("supplier", "Supplier", "Supplier", { semantic: "customer" }),
    dim("commodity", "Commodity", "Commodity"),
    dim("incoterm", "Incoterm", "Incoterm", { hidden: true }),
    dim("origin_country", "Country of origin", "Origin country", { semantic: "origin" }),
    dim("origin_port", "Origin port", "Origin port"),
    dim("region", "Region", "Region", { order: ["Middle East", "Asia", "Europe", "Africa", "Americas", "Oceania"], hidden: true }),
    dim("via_port", "Via port", "Via port", { hidden: true }),
    dim("dest_port", "Destination port", "Destination port", { semantic: "destination" }),
    dim("warehouse", "Warehouse", "Warehouse"),
    txt("lane", "Lane", "Lane", { semantic: "lane" }),
    dim("shipping_line", "Shipping line", "Shipping line"),
    dim("mode", "Mode", "Mode", { semantic: "mode", order: ["Sea", "Air", "Road", "Multimodal"] }),
    dim("container_type", "Container type", "Container type"),
    cnt("containers", "Containers", "Containers", { semantic: "quantity", description: "Typed on the shipment's first row" }),
    txt("container_no", "Container no", "Container no", { hidden: true }),
    { id: "arrival", label: "Arrival", source: "Arrival", type: "date", role: "date", format: "date" },
    dim("month", "Month", "Month", { semantic: "period" }),
    { id: "month_start", label: "Month", source: "Month start", type: "date", role: "date", format: "date", hidden: true },
    dim("year", "Year", "Year"),
    dim("month_source", "Month source", "Month source", { hidden: true, order: ["Reporting month column", "Arrival date", "Invoice date", "No date"] }),
    txt("goods_invoice", "Supplier invoice", "Goods invoice", { hidden: true }),
    dim("goods_currency", "Goods currency", "Goods currency", { hidden: true }),
    { id: "goods", label: "Cost of goods (as typed)", source: "Cost of goods", type: "number", role: "measure", format: "decimal", aggregate: "sum", hidden: true, noAnomalies: true },
    aed("goods_aed", "Cost of goods (AED)", "Cost of goods (AED)", { semantic: "amount" }),
    txt("boe_no", "BOE no", "BOE no", { hidden: true }),
    { id: "invoice_date", label: "Invoice date", source: "Invoice date", type: "date", role: "date", format: "date" },
    txt("service_invoice", "Service invoice", "Service invoice", { hidden: true }),
    dim("cost_code", "Cost code", "Cost code"),
    dim("charge", "Charge", "Charge"),
    dim("cost_group", "Cost group", "Cost group", { order: GROUPS }),
    aed("amount", "Amount", "Amount (AED)", { semantic: "cost" }),
    dim("paid_to", "Paid to", "Paid to"),
    dim("payment_via", "Payment via", "Payment via"),
    dim("payment_owner", "Payment owner", "Payment owner", { hidden: true }),
    dim("status", "Status", "Status", { semantic: "status", order: STATUSES }),
    txt("srn", "SRN", "SRN", { hidden: true }),
    aed("deposited", "Deposited", "Deposited (AED)", { hidden: true }),
    aed("amt_freight", "Freight", "Freight (AED)"),
    aed("amt_customs", "Customs & port", "Customs & port (AED)"),
    aed("amt_dd", "Demurrage & detention", "Demurrage & detention (AED)"),
    aed("amt_clearance", "Clearance", "Clearance (AED)", { hidden: true, description: "Customs & port plus demurrage & detention" }),
    aed("amt_uncoded", "Uncoded", "Uncoded (AED)", { hidden: true }),
    cnt("shipment_row", "Shipments", "Shipment row", { hidden: true, description: "1 on each shipment's first line, so tables roll up to shipments" }),
    cnt("has_charge", "Charges", "Has charge", { hidden: true }),
    { id: "source_row", label: "Sheet row", source: "Sheet row", type: "number", role: "measure", format: "integer", hidden: true },
    txt("notes", "Corrections", "Corrections", { hidden: true }),
    { id: "lines", label: "Lines", source: null, type: "number", role: "measure", format: "integer", aggregate: "sum", hidden: true, derived: { kind: "case", cases: [], fallback: 1 } },
    { id: "latest", label: "Latest month", source: null, type: "string", role: "dimension", order: ["Latest month", "Earlier"], hidden: true, derived: { kind: "latestPeriod", from: "month_start", unit: "month" } },
  ];
  return { version: 1, sheet: COSTS_SHEET, fields, idField: "line", primaryDate: "month_start", noteField: "notes", foldCase: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Layout

const sum = (field: string, filter?: FilterExpr): MetricSpec => ({ agg: "sum", field, format: "currency", currency: "AED", ...(filter ? { filter } : {}) });
const count = (field: string, filter?: FilterExpr): MetricSpec => ({ agg: "sum", field, format: "integer", ...(filter ? { filter } : {}) });
const shipments = (filter?: FilterExpr): MetricSpec => ({ agg: "distinct", field: "shipment", format: "integer", ...(filter ? { filter } : {}) });
const per = (field: string, over: string, filter?: FilterExpr): MetricSpec => ({ agg: "ratio", field, over, unpaired: true, format: "currency", currency: "AED", ...(filter ? { filter } : {}) });
const share = (field: string, over: string, filter?: FilterExpr): MetricSpec => ({ agg: "ratio", field, over, unpaired: true, format: "percent", ...(filter ? { filter } : {}) });
const LATEST: FilterExpr = { field: "latest", op: "eq", value: "Latest month" };
const table = (w: Omit<Extract<Widget, { type: "table" }>, "type">): Widget => ({ type: "table", ...w });
const SHIP_COLUMNS = ["shipment", "supplier", "commodity", "lane", "shipping_line", "container_type", "containers", "arrival", "goods_aed", "amt_freight", "amt_customs", "amt_dd", "amount"];
const CHARGE_COLUMNS = ["shipment", "supplier", "charge", "cost_group", "amount", "paid_to", "payment_via", "status", "invoice_date", "service_invoice"];

export function costsLayout(): Layout {
  const overview: Page = {
    id: "overview", title: "Overview", widgets: [
      { id: "story", type: "story", title: "This month", dateField: "month_start", monthField: "month", metrics: [
        { id: "spend", label: "logistics spend", metric: sum("amount"), good: "down" },
        { id: "freight", label: "freight", metric: sum("amt_freight"), good: "down" },
        { id: "clearance", label: "clearance", metric: sum("amt_clearance"), good: "down" },
        { id: "ships", label: "shipments", metric: shipments(), good: "none" },
        { id: "cont", label: "containers", metric: count("containers"), good: "none" },
      ] },
      { id: "months", type: "months", title: "Month by month", subtitle: "Spend by cost group. Click a month to see it alone", dateField: "month_start", monthField: "month", metric: sum("amount"), stackBy: "cost_group" },
      { id: "kpi_spend", type: "kpi", title: "Logistics spend", metric: sum("amount"), good: "down", secondary: { metric: per("amount", "containers"), label: "per container" } },
      { id: "kpi_freight", type: "kpi", title: "Freight", metric: sum("amt_freight"), good: "down", onClick: GROUP("Freight"), secondary: { metric: share("amt_freight", "amount"), label: "of spend" } },
      { id: "kpi_customs", type: "kpi", title: "Customs & port", metric: sum("amt_customs"), good: "down", onClick: GROUP("Customs & port"), secondary: { metric: share("amt_customs", "amount"), label: "of spend" } },
      { id: "kpi_dd", type: "kpi", title: "Demurrage & detention", metric: sum("amt_dd"), good: "down", onClick: GROUP("Demurrage & detention"), secondary: { metric: share("amt_dd", "amount"), label: "of spend, avoidable" } },
      { id: "kpi_ships", type: "kpi", title: "Shipments", metric: shipments(), good: "none", secondary: { metric: count("containers"), label: "containers" } },
      { id: "kpi_per", type: "kpi", title: "Cost per shipment", metric: per("amount", "shipment_row"), good: "down", secondary: { metric: share("amount", "goods_aed"), label: "of goods value" } },
      { id: "spot", type: "spotlight", title: "Where the money goes", subtitle: "The biggest in each, with its share of spend", metric: sum("amount"), items: [
        { label: "Costliest origin", dimension: "origin_country" }, { label: "Costliest supplier", dimension: "supplier" }, { label: "Costliest shipping line", dimension: "shipping_line" }, { label: "Biggest charge", dimension: "charge" },
      ] },
      { id: "map", type: "map", title: "Where it comes from", subtitle: "Dot size = spend. Click a country to filter", countryField: "origin_country", metric: sum("amount"), words: { value: "Spend", done: "Spend" }, home: "Agthia" },
      { id: "waterfall", type: "waterfall", title: "From goods to landed cost", subtitle: "Cost of goods plus every logistics cost group", steps: [
        { label: "Cost of goods", metric: sum("goods_aed"), kind: "base" }, { label: "Freight", metric: sum("amt_freight") }, { label: "Customs & port", metric: sum("amt_customs") }, { label: "Demurrage & detention", metric: sum("amt_dd") }, { label: "Uncoded", metric: sum("amt_uncoded") }, { label: "Landed cost", kind: "total" },
      ] },
      { id: "tree", type: "treemap", title: "Every charge", subtitle: "Box size = spend, colour = cost group. Click to filter", dimension: "charge", groupBy: "cost_group", metric: sum("amount") },
      { id: "by_month", type: "bar", title: "Spend by month", subtitle: "Stacked by cost group", dimension: "month", metric: sum("amount"), stackBy: "cost_group", filter: HAS_CHARGE, sort: "date", orientation: "vertical", colorBy: "categorical" },
      { id: "by_supplier", type: "bar", title: "By supplier", dimension: "supplier", metric: sum("amount"), stackBy: "cost_group", filter: HAS_CHARGE, topN: 12, orientation: "horizontal", colorBy: "categorical" },
      { id: "by_origin", type: "bar", title: "By country of origin", dimension: "origin_country", metric: sum("amount"), stackBy: "cost_group", filter: HAS_CHARGE, topN: 12, orientation: "horizontal", colorBy: "categorical" },
      { id: "by_line", type: "bar", title: "By shipping line", dimension: "shipping_line", metric: sum("amount"), stackBy: "cost_group", filter: HAS_CHARGE, topN: 10, orientation: "horizontal", colorBy: "categorical" },
      { id: "by_mode", type: "bar", title: "By mode", dimension: "mode", metric: sum("amount"), stackBy: "cost_group", filter: HAS_CHARGE, sort: "order", orientation: "horizontal", colorBy: "categorical" },
    ], grid: [
      { i: "story", x: 0, y: 0, w: 12, h: 5, minH: 5 }, { i: "months", x: 0, y: 5, w: 12, h: 4, minH: 4 },
      { i: "kpi_spend", x: 0, y: 9, w: 2, h: 3 }, { i: "kpi_freight", x: 2, y: 9, w: 2, h: 3 }, { i: "kpi_customs", x: 4, y: 9, w: 2, h: 3 }, { i: "kpi_dd", x: 6, y: 9, w: 2, h: 3 }, { i: "kpi_ships", x: 8, y: 9, w: 2, h: 3 }, { i: "kpi_per", x: 10, y: 9, w: 2, h: 3 },
      { i: "map", x: 0, y: 12, w: 7, h: 11 }, { i: "spot", x: 7, y: 12, w: 5, h: 11 },
      { i: "waterfall", x: 0, y: 23, w: 6, h: 9 }, { i: "tree", x: 6, y: 23, w: 6, h: 9 },
      { i: "by_month", x: 0, y: 32, w: 6, h: 9 }, { i: "by_supplier", x: 6, y: 32, w: 6, h: 9 },
      { i: "by_origin", x: 0, y: 41, w: 4, h: 9 }, { i: "by_line", x: 4, y: 41, w: 4, h: 9 }, { i: "by_mode", x: 8, y: 41, w: 4, h: 9 },
    ],
  };
  const ships: Page = {
    id: "shipments", title: "Shipments", widgets: [
      { id: "tickets", type: "tickets", title: "Every shipment", subtitle: "Click a shipment to filter the whole dashboard to it", idField: "shipment", titleField: "shipment", subtitleField: "supplier", route: ["origin_port", "via_port", "dest_port", "warehouse"], dateField: "arrival", tags: ["commodity", "shipping_line", "container_type"],
        countMetric: count("containers"), total: sum("amount"), stacks: [{ label: "Freight", metric: sum("amt_freight") }, { label: "Customs & port", metric: sum("amt_customs") }, { label: "Demurrage & detention", metric: sum("amt_dd") }, { label: "Uncoded", metric: sum("amt_uncoded") }], perMetric: per("amount", "containers"), goodsMetric: sum("goods_aed"), pageSize: 12 },
      table({ id: "ship_table", title: "Shipments as a table", subtitle: "One line per B/L; charges rolled up", groupBy: "shipment", rowLabel: "shipments", columns: SHIP_COLUMNS, sort: { field: "amount", dir: "desc" }, pageSize: 25, search: true }),
    ], grid: [{ i: "tickets", x: 0, y: 0, w: 12, h: 20 }, { i: "ship_table", x: 0, y: 20, w: 12, h: 14 }],
  };
  const charges: Page = {
    id: "charges", title: "Charges", widgets: [
      { id: "c_tree", type: "treemap", title: "Every charge, by size", subtitle: "Colour = cost group. Click to filter", dimension: "charge", groupBy: "cost_group", metric: sum("amount") },
      table({ id: "c_table", title: "Charges by type", subtitle: "Each charge recorded separately, as the brief asks", groupBy: "charge", filter: HAS_CHARGE, rowLabel: "charge types", columns: ["charge", "cost_group", "has_charge", "amount"], sort: { field: "amount", dir: "desc" }, pageSize: 25 }),
      { id: "c_clear", type: "bar", title: "Customs & port charges in detail", subtitle: "Clearance side only", dimension: "charge", metric: sum("amount"), filter: GROUP("Customs & port"), orientation: "horizontal", colorBy: "single" },
      { id: "c_dd_line", type: "bar", title: "Demurrage & detention by shipping line", dimension: "shipping_line", metric: sum("amount"), filter: GROUP("Demurrage & detention"), orientation: "horizontal", colorBy: "single" },
      table({ id: "c_dd", title: "Demurrage & detention charges", subtitle: "The avoidable cost: which shipments, which lines", filter: GROUP("Demurrage & detention"), columns: ["shipment", "supplier", "shipping_line", "containers", "arrival", "amount", "status", "invoice_date"], sort: { field: "amount", dir: "desc" }, pageSize: 15 }),
      { id: "c_legend", type: "auxTable", title: "Cost code legend", subtitle: "The Abbreviation sheet: codes and standard rates per port", sheet: "legend", columns: ["code", "label", "group", "rate_ja", "rate_kp", "rate_kfk", "rate_fuj", "lines", "amount"], rowLabel: "codes", pageSize: 30 },
    ], grid: [
      { i: "c_tree", x: 0, y: 0, w: 7, h: 11 }, { i: "c_table", x: 7, y: 0, w: 5, h: 11 },
      { i: "c_clear", x: 0, y: 11, w: 6, h: 9 }, { i: "c_dd_line", x: 6, y: 11, w: 6, h: 9 },
      { i: "c_dd", x: 0, y: 20, w: 12, h: 10 }, { i: "c_legend", x: 0, y: 30, w: 12, h: 10 },
    ],
  };
  const monthly: Page = {
    id: "monthly", title: "Month by month", widgets: [
      { id: "m_spend", type: "kpi", title: "Latest month · spend", metric: sum("amount", LATEST), good: "down", onClick: LATEST, secondary: { metric: shipments(LATEST), label: "shipments" } },
      { id: "m_freight", type: "kpi", title: "Latest month · freight", metric: sum("amt_freight", LATEST), good: "down", onClick: { and: [LATEST, GROUP("Freight")] }, secondary: { metric: share("amt_freight", "amount", LATEST), label: "of the month" } },
      { id: "m_clear", type: "kpi", title: "Latest month · clearance", metric: sum("amt_clearance", LATEST), good: "down", onClick: { and: [LATEST, { field: "cost_group", op: "in", value: ["Customs & port", "Demurrage & detention"] }] }, secondary: { metric: sum("amt_dd", LATEST), label: "of it demurrage & detention" } },
      { id: "m_per", type: "kpi", title: "Latest month · per container", metric: per("amount", "containers", LATEST), good: "down", secondary: { metric: count("containers", LATEST), label: "containers" } },
      table({ id: "m_table", title: "Month by month", subtitle: "Every reporting month on the dashboard; year to date is the total line", groupBy: "month", rowLabel: "months", columns: ["month", "shipment_row", "containers", "amount", "amt_freight", "amt_customs", "amt_dd", "goods_aed"], sort: { field: "month_start", dir: "desc" }, pageSize: 24 }),
      { id: "m_groups", type: "bar", title: "Spend by month and cost group", dimension: "month", metric: sum("amount"), stackBy: "cost_group", filter: HAS_CHARGE, sort: "date", orientation: "vertical", colorBy: "categorical" },
      { id: "m_trend", type: "line", title: "Monthly trend", subtitle: "Freight and clearance, month by month", dateField: "month_start", unit: "month", series: [{ label: "Freight", metric: sum("amt_freight"), kind: "bar" }, { label: "Clearance", metric: sum("amt_clearance"), kind: "bar" }, { label: "Total", metric: sum("amount"), kind: "line" }] },
      { id: "m_supplier", type: "bar", title: "Suppliers by month", dimension: "month", metric: sum("amount"), stackBy: "supplier", sort: "date", orientation: "vertical", colorBy: "categorical" },
      { id: "m_origin", type: "bar", title: "Origins by month", dimension: "month", metric: sum("amount"), stackBy: "origin_country", sort: "date", orientation: "vertical", colorBy: "categorical" },
    ], grid: [
      { i: "m_spend", x: 0, y: 0, w: 3, h: 3 }, { i: "m_freight", x: 3, y: 0, w: 3, h: 3 }, { i: "m_clear", x: 6, y: 0, w: 3, h: 3 }, { i: "m_per", x: 9, y: 0, w: 3, h: 3 },
      { i: "m_table", x: 0, y: 3, w: 12, h: 8 },
      { i: "m_groups", x: 0, y: 11, w: 6, h: 9 }, { i: "m_trend", x: 6, y: 11, w: 6, h: 9 },
      { i: "m_supplier", x: 0, y: 20, w: 6, h: 9 }, { i: "m_origin", x: 6, y: 20, w: 6, h: 9 },
    ],
  };
  const suppliers: Page = {
    id: "suppliers", title: "Suppliers & origins", widgets: [
      { id: "s_map", type: "map", title: "Countries of origin", subtitle: "Dot size = spend. Click a country to filter", countryField: "origin_country", metric: sum("amount"), words: { value: "Spend", done: "Spend" }, home: "Agthia" },
      { id: "s_spot", type: "spotlight", title: "Highest cost per container", subtitle: "Where a container costs most to bring in", metric: per("amount", "containers"), items: [{ label: "Origin", dimension: "origin_country" }, { label: "Supplier", dimension: "supplier" }, { label: "Shipping line", dimension: "shipping_line" }, { label: "Destination port", dimension: "dest_port" }], minCount: 20, countMetric: count("containers") },
      table({ id: "s_table", title: "By supplier", groupBy: "supplier", rowLabel: "suppliers", columns: ["supplier", "origin_country", "commodity", "shipment_row", "containers", "goods_aed", "amt_freight", "amt_customs", "amt_dd", "amount"], sort: { field: "amount", dir: "desc" }, pageSize: 20, search: true }),
      table({ id: "s_origin", title: "By country of origin", groupBy: "origin_country", rowLabel: "countries", columns: ["origin_country", "origin_port", "shipment_row", "containers", "amt_freight", "amt_customs", "amt_dd", "amount"], sort: { field: "amount", dir: "desc" }, pageSize: 15 }),
      { id: "s_port", type: "bar", title: "By origin port", dimension: "origin_port", metric: sum("amount"), stackBy: "cost_group", filter: HAS_CHARGE, topN: 12, orientation: "horizontal", colorBy: "categorical" },
      { id: "s_commodity", type: "bar", title: "By commodity", dimension: "commodity", metric: sum("amount"), stackBy: "cost_group", filter: HAS_CHARGE, topN: 12, orientation: "horizontal", colorBy: "categorical" },
    ], grid: [
      { i: "s_map", x: 0, y: 0, w: 7, h: 11 }, { i: "s_spot", x: 7, y: 0, w: 5, h: 11 },
      { i: "s_table", x: 0, y: 11, w: 12, h: 12 }, { i: "s_origin", x: 0, y: 23, w: 12, h: 9 },
      { i: "s_port", x: 0, y: 32, w: 6, h: 9 }, { i: "s_commodity", x: 6, y: 32, w: 6, h: 9 },
    ],
  };
  const lines: Page = {
    id: "lines", title: "Shipping lines", widgets: [
      table({ id: "l_table", title: "By shipping line", subtitle: "Freight, clearance and demurrage per line", groupBy: "shipping_line", rowLabel: "lines", columns: ["shipping_line", "shipment_row", "containers", "amt_freight", "amt_customs", "amt_dd", "amount"], sort: { field: "amount", dir: "desc" }, pageSize: 15 }),
      { id: "l_bar", type: "bar", title: "Spend by shipping line", dimension: "shipping_line", metric: sum("amount"), stackBy: "cost_group", filter: HAS_CHARGE, orientation: "horizontal", colorBy: "categorical" },
      { id: "l_dest", type: "bar", title: "By destination port", dimension: "dest_port", metric: sum("amount"), stackBy: "cost_group", filter: HAS_CHARGE, orientation: "horizontal", colorBy: "categorical" },
      { id: "l_type", type: "bar", title: "By container type", dimension: "container_type", metric: sum("amount"), stackBy: "cost_group", filter: HAS_CHARGE, orientation: "horizontal", colorBy: "categorical" },
      { id: "l_wh", type: "bar", title: "By warehouse", dimension: "warehouse", metric: sum("amount"), stackBy: "cost_group", filter: HAS_CHARGE, orientation: "horizontal", colorBy: "categorical", includeNull: true },
    ], grid: [
      { i: "l_table", x: 0, y: 0, w: 12, h: 9 }, { i: "l_bar", x: 0, y: 9, w: 6, h: 9 }, { i: "l_dest", x: 6, y: 9, w: 6, h: 9 }, { i: "l_type", x: 0, y: 18, w: 6, h: 8 }, { i: "l_wh", x: 6, y: 18, w: 6, h: 8 },
    ],
  };
  const payments: Page = {
    id: "payments", title: "Payments", widgets: [
      { id: "p_pending", type: "kpi", title: "Pending", metric: sum("amount", { field: "status", op: "eq", value: "Pending" }), good: "down", onClick: { field: "status", op: "eq", value: "Pending" }, secondary: { metric: count("has_charge", { field: "status", op: "eq", value: "Pending" }), label: "charges" } },
      { id: "p_submitted", type: "kpi", title: "Submitted", metric: sum("amount", { field: "status", op: "eq", value: "Submitted" }), good: "none", onClick: { field: "status", op: "eq", value: "Submitted" }, secondary: { metric: count("has_charge", { field: "status", op: "eq", value: "Submitted" }), label: "charges" } },
      { id: "p_completed", type: "kpi", title: "Completed", metric: sum("amount", { field: "status", op: "eq", value: "Completed" }), good: "up", onClick: { field: "status", op: "eq", value: "Completed" }, secondary: { metric: count("has_charge", { field: "status", op: "eq", value: "Completed" }), label: "charges" } },
      { id: "p_none", type: "kpi", title: "No status recorded", metric: sum("amount", { and: [HAS_CHARGE, { field: "status", op: "eq", value: "Not recorded" }] }), good: "down", onClick: { and: [HAS_CHARGE, { field: "status", op: "eq", value: "Not recorded" }] }, secondary: { metric: count("has_charge", { field: "status", op: "eq", value: "Not recorded" }), label: "charges" } },
      { id: "p_via", type: "bar", title: "How charges were paid", dimension: "payment_via", metric: sum("amount"), stackBy: "status", filter: HAS_CHARGE, orientation: "horizontal", colorBy: "status", includeNull: true },
      { id: "p_to", type: "bar", title: "Who was paid", dimension: "paid_to", metric: sum("amount"), stackBy: "cost_group", filter: HAS_CHARGE, orientation: "horizontal", colorBy: "categorical", includeNull: true },
      table({ id: "p_pending_t", title: "Pending charges", subtitle: "Largest first", filter: { field: "status", op: "eq", value: "Pending" }, columns: CHARGE_COLUMNS, sort: { field: "amount", dir: "desc" }, pageSize: 20, statusField: "status" }),
      table({ id: "p_nostatus", title: "Charges with no status", filter: { and: [HAS_CHARGE, { field: "status", op: "eq", value: "Not recorded" }] }, columns: CHARGE_COLUMNS, sort: { field: "amount", dir: "desc" }, pageSize: 15, statusField: "status" }),
    ], grid: [
      { i: "p_pending", x: 0, y: 0, w: 3, h: 3 }, { i: "p_submitted", x: 3, y: 0, w: 3, h: 3 }, { i: "p_completed", x: 6, y: 0, w: 3, h: 3 }, { i: "p_none", x: 9, y: 0, w: 3, h: 3 },
      { i: "p_via", x: 0, y: 3, w: 6, h: 8 }, { i: "p_to", x: 6, y: 3, w: 6, h: 8 }, { i: "p_pending_t", x: 0, y: 11, w: 12, h: 11 }, { i: "p_nostatus", x: 0, y: 22, w: 12, h: 9 },
    ],
  };
  const reconciliation: Page = {
    id: "reconciliation", title: "Reconciliation", widgets: [
      { id: "recon", type: "auxTable", title: "Against the sheet", subtitle: "What the dashboard counts, and what it had to clean", sheet: "reconciliation", columns: ["check", "report", "sheet", "note"], rowLabel: "checks", pageSize: 30 },
    ], grid: [{ i: "recon", x: 0, y: 0, w: 12, h: 14 }],
  };
  const register: Page = {
    id: "register", title: "Register", widgets: [
      table({ id: "register", title: "All cost lines", columns: ["line", "month", "po", "supplier", "commodity", "origin_country", "origin_port", "dest_port", "warehouse", "shipping_line", "mode", "container_type", "containers", "arrival", "goods_currency", "goods", "goods_aed", "cost_code", "charge", "cost_group", "amount", "paid_to", "payment_via", "status", "invoice_date", "service_invoice", "srn"], sort: { field: "month_start", dir: "desc" }, search: true, pageSize: 50, statusField: "status" }),
    ], grid: [{ i: "register", x: 0, y: 0, w: 12, h: 18 }],
  };
  const quality: Page = { id: "quality", title: "Data quality", widgets: [{ id: "quality", type: "quality", title: "Data quality" }], grid: [{ i: "quality", x: 0, y: 0, w: 12, h: 16 }] };
  return {
    version: 1, dateField: "month_start",
    pages: [overview, ships, charges, monthly, suppliers, lines, payments, reconciliation, register, quality],
    filters: [
      { kind: "select", field: "month", label: "Month" }, { kind: "select", field: "year", label: "Year" }, { kind: "select", field: "supplier", label: "Supplier" }, { kind: "select", field: "origin_country", label: "Origin" },
      { kind: "select", field: "mode", label: "Mode" }, { kind: "select", field: "shipping_line", label: "Line" }, { kind: "select", field: "cost_group", label: "Cost group" }, { kind: "search", field: "shipment", label: "B/L" },
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Secondary sheets: the legend, and a reconciliation against the sheet

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function costsAux(wb: ParsedWorkbook): Record<string, AuxSheet> {
  const sheet = wb.sheets.find((s) => s.name === COSTS_SHEET);
  if (!sheet) return {};
  const rows = sheet.rows.map((r) => r.cells);
  const out: Record<string, AuxSheet> = {};
  const legendGrid = Object.entries(wb.grids ?? {}).find(([k]) => /abbrev|legend|codes?/i.test(k))?.[1];
  const legend = readLegend(legendGrid);
  const byCode = new Map<string, { n: number; amt: number }>();
  for (const r of rows) { const code = r["Cost code"]; if (typeof code === "string") { const e = byCode.get(code) ?? { n: 0, amt: 0 }; e.n++; e.amt += typeof r["Amount (AED)"] === "number" ? (r["Amount (AED)"] as number) : 0; byCode.set(code, e); } }
  const codes = new Set<string>([...legend.keys(), ...byCode.keys()]);
  const legendRows: Record<string, ColumnValue>[] = [...codes].map((code) => {
    const l = legend.get(code), e = byCode.get(code);
    const rates = l?.rates ?? {};
    const rate = (k: RegExp) => { const key = Object.keys(rates).find((x) => k.test(x)); return key ? rates[key] : null; };
    return { code, label: CODES[code]?.label ?? l?.label ?? code, group: groupFor(code), rate_ja: rate(/\bJA\b/i), rate_kp: rate(/\bKP\b/i), rate_kfk: rate(/KFK/i), rate_fuj: rate(/FUJ/i), lines: e?.n ?? 0, amount: e ? Math.round(e.amt * 100) / 100 : null, in_legend: l ? "Yes" : "No" };
  }).sort((a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0));
  out.legend = {
    id: "legend", label: "Cost code legend",
    columns: [
      { id: "code", label: "Code", type: "string" }, { id: "label", label: "Charge", type: "string" }, { id: "group", label: "Cost group", type: "string" }, { id: "rate_ja", label: "Std rate Jebel Ali", type: "number", format: "currency" }, { id: "rate_kp", label: "Std rate Khalifa Port", type: "number", format: "currency" },
      { id: "rate_kfk", label: "Std rate Khor Fakkan", type: "number", format: "currency" }, { id: "rate_fuj", label: "Std rate Fujairah", type: "number", format: "currency" }, { id: "lines", label: "Lines", type: "number", format: "integer" }, { id: "amount", label: "Spend (AED)", type: "number", format: "currency" }, { id: "in_legend", label: "In the legend", type: "string" },
    ],
    rows: legendRows,
  };
  // Reconciliation.
  const checks: Record<string, ColumnValue>[] = [];
  const add = (check: string, report: string, sheetValue: string | null, note: string) => checks.push({ check, report, sheet: sheetValue, note });
  const sumOf = (h: string, pred?: (r: Record<string, RawCell>) => boolean) => rows.filter((r) => !pred || pred(r)).reduce((a, r) => a + (typeof r[h] === "number" ? (r[h] as number) : 0), 0);
  const source = Object.keys(wb.grids ?? {}).find((k) => !/abbrev|legend/i.test(k) && k !== COSTS_SHEET);
  const grid = source ? wb.grids![source] : undefined;
  const charges = rows.filter((r) => r["Has charge"] === 1);
  const ships = new Set(rows.map((r) => r["Shipment"]));
  add("Cost lines", fmt(rows.length), grid ? fmt(grid.length - 1) : null, `${fmt(charges.length)} charges and ${fmt(rows.length - charges.length)} shipment lines with no charge yet, over ${fmt(ships.size)} shipments (B/Ls).`);
  if (grid) {
    const hdr = grid[0].map((v) => normKey(v));
    const ai = hdr.indexOf("invoice amount");
    const raw = ai >= 0 ? grid.slice(1).reduce((a, r) => a + (typeof r[ai] === "number" ? (r[ai] as number) : 0), 0) : null;
    add("Total charges (AED)", fmt(sumOf("Amount (AED)")), raw !== null ? fmt(raw) : null, raw !== null && Math.abs(raw - sumOf("Amount (AED)")) < 1 ? "Every amount in the sheet is on the dashboard." : "Differs: a line the dashboard reads differently (see Data quality).");
  }
  for (const g of GROUPS) add(`${g} (AED)`, fmt(sumOf("Amount (AED)", (r) => r["Cost group"] === g)), null, g === "Uncoded" ? "Charges with an amount but no cost code; shown as Uncoded until the owner codes them." : g === "Demurrage & detention" ? "Kept apart from customs & port: it is the avoidable money. Counted inside \"clearance\" for the freight / clearance split." : "");
  const months = [...new Set(rows.map((r) => r["Month"]).filter(Boolean))] as string[];
  const srcCount = new Map<string, number>(); for (const r of rows) { const s = String(r["Month source"] ?? "No date"); srcCount.set(s, (srcCount.get(s) ?? 0) + 1); }
  add("Reporting months", fmt(months.length), null, `${months.join(", ")}. Month source: ${[...srcCount.entries()].map(([k, v]) => `${k} ${fmt(v)}`).join(", ")}. The sheet has no reporting-month column; add one and the dashboard will use it.`);
  const goods = rows.filter((r) => typeof r["Cost of goods (AED)"] === "number");
  add("Cost of goods (AED)", fmt(sumOf("Cost of goods (AED)")), null, `${fmt(goods.length)} shipments carry a supplier invoice value (USD, EUR or AED; converted at AED 3.6725 per USD and 4.28 per EUR). Logistics spend is ${(sumOf("Amount (AED)") / Math.max(1, sumOf("Cost of goods (AED)")) * 100).toFixed(0)}% of goods value on the whole sheet, more where goods values are missing.`);
  const noCont = [...ships].filter((s) => !rows.some((r) => r["Shipment"] === s && typeof r["Containers"] === "number"));
  if (noCont.length) add("Shipments without a container count", fmt(noCont.length), null, `${noCont.slice(0, 8).join(", ")}${noCont.length > 8 ? "…" : ""}: cost per container leaves them out.`);
  const noStatus = charges.filter((r) => r["Status"] === "Not recorded");
  add("Charges with no payment status", fmt(noStatus.length), null, `AED ${fmt(noStatus.reduce((a, r) => a + Number(r["Amount (AED)"] ?? 0), 0))}; the Expense Submitted cell is blank on these lines.`);
  const corrected = rows.filter((r) => r["Corrections"]).length;
  add("Lines with a correction noted", fmt(corrected), null, corrected ? "Spellings folded (suppliers, lines, warehouses, container types), a country typed as a port and ports typed as countries, invoice dates read, inherited shipment details. Each is listed on the Data quality page." : "Nothing needed correcting.");
  out.reconciliation = {
    id: "reconciliation", label: "Reconciliation",
    columns: [{ id: "check", label: "Check", type: "string" }, { id: "report", label: "This report", type: "string" }, { id: "sheet", label: "In the sheet", type: "string" }, { id: "note", label: "Note", type: "string", wrap: true }],
    rows: checks,
  };
  return out;
}

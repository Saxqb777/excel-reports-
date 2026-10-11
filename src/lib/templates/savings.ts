import type { AuxColumn, AuxSheet, ColumnStats, ColumnValue, Field, FilterExpr, Fix, ParsedSheet, ParsedWorkbook, RawCell, RawRow, SchemaMap } from "@/lib/schema/types";
import { cleanText } from "@/lib/schema/types";
import { parseLooseDate } from "@/lib/excel/parse";
import { buildValueMap } from "@/lib/schema/infer";
import type { MetricSpec } from "@/lib/engine/metrics";
import type { Layout, Widget } from "@/lib/dashboard/types";

/**
 * Savings report: a workbook with one sheet per stream of logistics savings (sea port clearance, road border clearance,
 * spare parts, an earlier log), each listing jobs with the previous and current agent, old and new fees and the saving.
 *
 * The sheets have different columns, so the template merges them into one table, "Savings lines", before the usual
 * pipeline runs (prepareSavingsWorkbook). Columns are recognised by their headers, not by sheet name or position, so a
 * renamed or added stream sheet is picked up. While merging it:
 * - leaves out rows of the earlier log whose BL or invoice number is already on another sheet (the same truck counted
 *   twice), with the reason on the Data quality page;
 * - corrects dates whose day and month were swapped, using the sheet's own Month column as the truth;
 * - normalises agent, port and country names and states the change behind each saving.
 * It also produces a reconciliation of every sheet against the workbook's SUMMARY pivots and a before/after table of
 * fee lines (auxiliary sheets). Contract rate cards pasted as images cannot be read; a transcription can be kept on the
 * project (settings.referenceSheets) and is shown on the reconciliation page.
 */

export const SAVINGS_SHEET = "Savings lines";
const CURRENCY = "AED";

const H = {
  line: "Line", stream: "Stream", source: "Source sheet", sheetRow: "Sheet row", date: "Date", month: "Month", bu: "BU",
  direction: "Import / export", port: "Port or border", route: "Route or location", country: "Country",
  partner: "Supplier or customer", commodity: "Commodity", reference: "BL or invoice", unit: "Container or truck", boe: "BOE",
  prev: "Previous agent", cur: "Current agent", change: "Agent change", initiative: "Initiative", description: "Description",
  oldFee: "Old fee (AED)", newFee: "New fee (AED)", savings: "Savings (AED)", feeChange: "Fee change", units: "Trucks or containers",
  exclude: "Excluded because", notes: "Corrections",
} as const;
const HEADERS: string[] = Object.values(H);

export const STREAMS = { road: "Road border clearance", sea: "Sea port clearance", spare: "Spare parts clearance", inhouse: "In-house customs work" } as const;
const STREAM_ORDER: string[] = [STREAMS.road, STREAMS.sea, STREAMS.spare, STREAMS.inhouse];

type Kind = "sea" | "road" | "spare" | "log" | "other";
interface FeeCol { header: string; component: string }
interface SheetMap {
  sheet: ParsedSheet;
  kind: Kind;
  /** Name shown for the sheet (the earlier log is not shown by the name of the person who kept it). */
  label: string;
  prefix: string;
  cols: Partial<Record<"date" | "month" | "bu" | "direction" | "port" | "partner" | "reference" | "unit" | "boe" | "commodity" | "origin" | "prev" | "cur" | "project" | "description" | "savings", string>>;
  oldFees: FeeCol[];
  newFees: FeeCol[];
}

const hk = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function mapSheet(sheet: ParsedSheet): SheetMap | null {
  const hs = sheet.headers;
  const keys = hs.map(hk);
  const pick = (...tests: ((k: string) => boolean)[]) => { for (const t of tests) { const i = keys.findIndex(t); if (i >= 0) return hs[i]; } return undefined; };
  const savings = pick((k) => /^savings\b/.test(k));
  if (!savings) return null;
  const has = (k: string) => keys.includes(k);
  const kind: Kind = has("project name") && has("description") ? "log"
    : has("destination port") || has("boe inspection date") ? "sea"
    : has("truck no") || has("location") ? "road"
    : /spare/i.test(sheet.name) || has("new transportation") ? "spare" : "other";
  const cols: SheetMap["cols"] = {
    date: kind === "sea" ? pick((k) => k === "boe inspection date", (k) => k === "date", (k) => k === "eta") : pick((k) => k === "date", (k) => k === "boe inspection date", (k) => k === "eta"),
    month: pick((k) => k === "month"),
    bu: pick((k) => k === "bu"),
    direction: pick((k) => k.startsWith("import export")),
    port: pick((k) => k === "destination port", (k) => k.startsWith("port"), (k) => k === "location"),
    partner: pick((k) => k.startsWith("supplier name")),
    reference: pick((k) => k.startsWith("bl or invoice"), (k) => k === "invoice number"),
    unit: pick((k) => k.startsWith("container number"), (k) => k === "truck no"),
    boe: pick((k) => k === "boe"),
    commodity: pick((k) => k === "commodity"),
    origin: pick((k) => k === "origin country"),
    prev: pick((k) => /^previous ag/.test(k)),
    cur: pick((k) => /^current ag/.test(k)),
    project: pick((k) => k === "project name"),
    description: pick((k) => k === "description"),
    savings,
  };
  // Without months or dates in its rows a sheet is a scratch calculation (a rate check), not a log of savings.
  if (!cols.month && !cols.date) return null;
  const dated = sheet.rows.filter((r) => monthOf(cols.month ? r.cells[cols.month] ?? null : null) || toMs(cols.date ? r.cells[cols.date] ?? null : null) !== null).length;
  if (dated < Math.max(1, sheet.rows.length / 2)) return null;
  // Fee columns: "Old …" and "New …" by name; other fee-like columns count as old before the first "New" column and
  // as new after it ("HS Code Ammendment" appears in both halves of the spare parts sheet).
  const oldFees: FeeCol[] = [], newFees: FeeCol[] = [];
  let seenNew = false;
  keys.forEach((k, i) => {
    if (hs[i] === savings || k === "boe") return;
    const isNew = /^(new|ew)\b/.test(k) || /^new/.test(k);
    const isOld = /^old\b/.test(k);
    const feeLike = /\b(fee|fees|charge|charges|processing|amendment|ammendment|transportation)\b/.test(k);
    if (!isNew && !isOld && !feeLike) return;
    const col = { header: hs[i], component: component(k) };
    if (isNew) { seenNew = true; newFees.push(col); } else if (isOld || !seenNew) oldFees.push(col); else newFees.push(col);
  });
  const label = kind === "log" ? "Earlier log" : cleanText(sheet.name);
  const prefix = { sea: "SEA", road: "ROAD", spare: "SPARE", log: "LOG", other: label.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "LINE" }[kind];
  return { sheet, kind, label, prefix, cols, oldFees, newFees };
}

function component(k: string): string {
  if (/firs/.test(k)) return "FIRS release";
  if (/inspection/.test(k)) return "Inspection";
  if (/seal/.test(k)) return "Seal";
  if (/document/.test(k)) return "Document collection";
  if (/mofa/.test(k)) return "MOFA attestation";
  if (/\bde\b/.test(k)) return "Duty exemption";
  if (/hs code/.test(k)) return "HS code amendment";
  if (/transport/.test(k)) return "Transportation";
  if (/boe|processing/.test(k)) return "BOE processing";
  return "Agent fee";
}

// ---------- value helpers ----------

const num = (v: RawCell): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") { const t = v.replace(/[, ]/g, "").replace(/^aed/i, ""); if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t); }
  return null;
};
const text = (v: RawCell): string | null => {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  const t = cleanText(typeof v === "number" ? String(v) : v);
  return t || null;
};
const DAY = 86400000;
function toMs(v: RawCell): number | null {
  if (typeof v === "number") return v > 20000 && v < 80000 ? Math.round((v - 25569) * DAY) : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const t = Date.parse(s); return Number.isNaN(t) ? null : t; }
  return parseLooseDate(s);
}
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
/** Spacing around "&" and inside brackets, as typed in free-text labels ("DM& ADAFSA ( Service Fee)"). */
const tidy = (s: string | null) => (s ? s.replace(/\s*&\s*/g, " & ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").replace(/\s+/g, " ").trim() : s);
const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s(/&-])([a-z])/g, (_, p, c) => p + c.toUpperCase());

function monthOf(v: RawCell): { m: number; y: number | null } | null {
  if (v === null) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) { const d = new Date(v); return { m: d.getUTCMonth(), y: d.getUTCFullYear() }; }
  if (typeof v === "number" && v > 20000 && v < 80000) { const d = new Date(toMs(v)!); return { m: d.getUTCMonth(), y: d.getUTCFullYear() }; }
  const s = String(v).trim().toLowerCase();
  const i = MONTHS.indexOf(s.slice(0, 3));
  if (i < 0) return null;
  const y = /(\d{4})/.exec(s)?.[1];
  return { m: i, y: y ? +y : null };
}

const ACRONYMS = new Set(["oocl", "ars", "dhl", "dsv", "gsl", "inl", "dp", "dpw", "msc", "cma", "cgm"]);
function agentName(v: RawCell): string | null {
  const t = text(v);
  if (!t) return null;
  const x = t.toLowerCase().replace(/agnet/g, "agent").replace(/felex/g, "flex").replace(/sahel/g, "sahal").replace(/\s+/g, " ").trim();
  if (/^(self|in ?house|inhouse|own team|agthia)$/.test(x)) return "In-house";
  return x.split(" ").map((w) => (ACRONYMS.has(w) ? w.toUpperCase() : w === "&" ? "&" : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
}

function direction(v: RawCell): string | null {
  const k = hk(text(v) ?? "");
  if (!k) return null;
  if (k === "import") return "Import";
  if (k === "export") return "Export";
  if (k === "re export" || k === "reexport") return "Re-export";
  return titleCase(k);
}

const PORTS: [RegExp, string][] = [
  [/jebel ali|jafza/, "Jebel Ali"], [/khalifa/, "Khalifa Port"], [/khor ?fakkan/, "Khor Fakkan"], [/fujairah/, "Fujairah"],
  [/\bauh\b|abu ?dhabi/, "Abu Dhabi"], [/\bdxb\b|dubai/, "Dubai"], [/\bajm\b|ajman/, "Ajman"], [/sharjah|\bshj\b/, "Sharjah"], [/sila/, "Sila border"],
];
function portName(v: RawCell): string | null {
  const t = text(v);
  if (!t) return null;
  const k = hk(t);
  for (const [re, name] of PORTS) if (re.test(k)) return name;
  // A code with digits in the port column is a reference typed in the wrong cell, not a port.
  return /\d/.test(t) ? null : titleCase(t);
}

const COUNTRIES: [RegExp, string][] = [
  [/\bsaudi\w*|\bsau\b|\bksa\b/, "Saudi Arabia"], [/kuwait/, "Kuwait"], [/bahr\w*|bahrin/, "Bahrain"], [/jord\w*/, "Jordan"],
  [/eg[yi]\w*pt/, "Egypt"], [/turk(ey|iye)/, "Turkey"], [/\boman\b/, "Oman"], [/qatar/, "Qatar"], [/india/, "India"],
  [/pakist\w*|pakisthan/, "Pakistan"], [/belgium/, "Belgium"], [/norway/, "Norway"], [/australia/, "Australia"],
  [/thailand/, "Thailand"], [/serbia/, "Serbia"], [/spain/, "Spain"], [/viet ?nam/, "Vietnam"], [/china/, "China"],
  [/italy/, "Italy"], [/netherlands|holland/, "Netherlands"], [/france/, "France"], [/germany/, "Germany"],
  [/\busa\b|united states/, "United States"], [/\buk\b|united kingdom/, "United Kingdom"], [/lebanon/, "Lebanon"],
  [/iraq/, "Iraq"], [/yemen/, "Yemen"], [/syria/, "Syria"], [/sri lanka/, "Sri Lanka"], [/bangladesh/, "Bangladesh"],
  [/brazil/, "Brazil"], [/argentina/, "Argentina"], [/ukraine/, "Ukraine"], [/russia/, "Russia"], [/new zealand/, "New Zealand"],
  [/canada/, "Canada"], [/south africa/, "South Africa"], [/kenya/, "Kenya"], [/indonesia/, "Indonesia"], [/malaysia/, "Malaysia"],
  [/philippines/, "Philippines"], [/greece/, "Greece"], [/poland/, "Poland"], [/denmark/, "Denmark"], [/ireland/, "Ireland"],
];
const HOME = /\b(uae|abu ?dhabi|abudabi|dubai|sharjah|ajman|al ain|emirates)\b/;
function countryOf(v: RawCell): string | null {
  const t = text(v);
  if (!t) return null;
  const k = hk(t);
  for (const [re, name] of COUNTRIES) if (re.test(k)) return name;
  const first = hk(t.split(/\s*-\s*/)[0]);
  return first && !HOME.test(first) ? titleCase(first) : null;
}

const refKey = (v: RawCell): string | null => {
  const t = text(v);
  if (!t) return null;
  const k = t.toUpperCase().replace(/\.0+$/, "").replace(/[^A-Z0-9]/g, "");
  return k.length >= 4 ? k : null;
};
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// ---------- merge ----------

interface SheetResult { map: SheetMap; rows: number; sheetSavings: number; counted: number; countedSavings: number; dupRows: number; dupSavings: number; dupOn: Map<string, number>; mismatchRows: number; mismatchSum: number; dateFixes: number }
interface MergeInfo { results: SheetResult[]; fees: Map<string, Map<string, { old: number; new: number; lines: number }>>; summary: { title: string; total: number }[] }
const merged = new WeakMap<ParsedSheet, MergeInfo>();

export function savingsSheets(wb: ParsedWorkbook): SheetMap[] {
  return wb.sheets.filter((s) => s.name !== SAVINGS_SHEET).map(mapSheet).filter((m): m is SheetMap => m !== null);
}

/** Adds the merged "Savings lines" sheet to a workbook that has savings sheets, and makes it the primary sheet. */
export function prepareSavingsWorkbook(wb: ParsedWorkbook): ParsedWorkbook {
  if (wb.sheets.some((s) => s.name === SAVINGS_SHEET)) return wb;
  const maps = savingsSheets(wb);
  if (maps.length === 0) return wb;
  // The most common year across the dates, for month labels on rows without a date.
  const years = new Map<number, number>();
  for (const m of maps) for (const r of m.sheet.rows) { const t = m.cols.date ? toMs(r.cells[m.cols.date] ?? null) : null; if (t) { const y = new Date(t).getUTCFullYear(); years.set(y, (years.get(y) ?? 0) + 1); } }
  const defaultYear = [...years.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? new Date().getUTCFullYear();

  // References on the maintained sheets, so the earlier log does not count a truck or container twice.
  const seen = new Map<string, string>();
  for (const m of maps) {
    if (m.kind === "log") continue;
    for (const r of m.sheet.rows) for (const h of [m.cols.reference, m.cols.unit]) {
      const k = h ? refKey(r.cells[h] ?? null) : null;
      if (k && !seen.has(k)) seen.set(k, `${m.label} row ${r.row}`);
    }
  }

  // Road clearances are charged per truck, and one row can clear several trucks (225, 450, 675… AED): the sheet's most
  // common old fee is the price of one truck, so trucks per row = old fee ÷ that fee.
  const perTruck = new Map<SheetMap, number>();
  for (const m of maps) {
    if (m.kind !== "road") continue;
    const counts = new Map<number, number>();
    for (const r of m.sheet.rows) { const o = m.oldFees.reduce((a, f) => a + (num(r.cells[f.header] ?? null) ?? 0), 0); if (o > 0) counts.set(o, (counts.get(o) ?? 0) + 1); }
    const mode = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (mode) perTruck.set(m, mode);
  }
  const rows: RawRow[] = [];
  const results: SheetResult[] = [];
  const fees: MergeInfo["fees"] = new Map();
  let n = 0;
  for (const m of maps) {
    const res: SheetResult = { map: m, rows: 0, sheetSavings: 0, counted: 0, countedSavings: 0, dupRows: 0, dupSavings: 0, dupOn: new Map(), mismatchRows: 0, mismatchSum: 0, dateFixes: 0 };
    const dates = fixDates(m);
    m.sheet.rows.forEach((r, ri) => {
      const c = (h?: string): RawCell => (h ? r.cells[h] ?? null : null);
      const oldParts = m.oldFees.map((f) => ({ f, v: num(c(f.header)) }));
      const newParts = m.newFees.map((f) => ({ f, v: num(c(f.header)) }));
      const hasFees = oldParts.some((p) => p.v !== null) || newParts.some((p) => p.v !== null);
      const oldFee = hasFees ? oldParts.reduce((a, p) => a + (p.v ?? 0), 0) : null;
      const newFee = hasFees ? newParts.reduce((a, p) => a + (p.v ?? 0), 0) : null;
      const stated = num(c(m.cols.savings));
      if (stated === null && !hasFees) return;
      const savings = stated ?? (oldFee ?? 0) - (newFee ?? 0);
      res.rows++;
      res.sheetSavings += savings;
      if (stated !== null && hasFees && Math.abs((oldFee ?? 0) - (newFee ?? 0) - stated) > 0.5) { res.mismatchRows++; res.mismatchSum += (oldFee ?? 0) - (newFee ?? 0) - stated; }

      const { date, notes } = dates[ri];
      const mo = monthOf(c(m.cols.month));
      const year = mo?.y ?? (date !== null ? new Date(date).getUTCFullYear() : defaultYear);
      const monthIdx = mo?.m ?? (date !== null ? new Date(date).getUTCMonth() : null);
      const month = monthIdx === null ? null : Date.UTC(year, monthIdx, 1);

      const prev = agentName(c(m.cols.prev)), cur = agentName(c(m.cols.cur));
      const description = text(c(m.cols.description));
      const project = tidy(text(c(m.cols.project)));
      const sila = /sila/i.test(description ?? "") || /sila/i.test(project ?? "");
      const agentFee = /agent fee/i.test(project ?? "");
      const stream = m.kind === "road" ? STREAMS.road : m.kind === "sea" ? STREAMS.sea : m.kind === "spare" ? STREAMS.spare
        : m.kind === "log" ? (agentFee || sila ? STREAMS.road : STREAMS.inhouse) : titleCase(m.label);
      const initiative = m.kind === "road" || (m.kind === "log" && (agentFee || sila)) ? (sila ? "Sila border: clearance agent changed" : "Border clearance agent changed")
        : m.kind === "sea" ? (cur === "In-house" ? "Port clearance taken in-house" : cur ? `Port clearance moved to ${cur}` : "Port clearance at new rates")
        : m.kind === "spare" ? "Spare parts clearance at new rates"
        : project ?? description ?? `${m.label} savings`;
      const port = m.kind === "road" ? (sila || /sila/i.test(String(c(m.cols.port) ?? "")) ? "Sila border" : "Land border") : portName(c(m.cols.port));
      const route = m.kind === "road" || m.kind === "spare" ? text(c(m.cols.port)) : null;
      const country = m.kind === "sea" ? countryOf(c(m.cols.origin)) : m.kind === "road" ? countryOf(c(m.cols.port)) : null;
      const change = prev && cur ? `${prev} → ${cur}` : prev ? `${prev} → new rates` : cur ? `→ ${cur}` : null;

      // The earlier log repeats trucks and containers already listed on the maintained sheets.
      let exclude: string | null = null;
      if (m.kind === "log") {
        for (const h of [m.cols.reference, m.cols.unit]) {
          const k = h ? refKey(c(h)) : null;
          const on = k ? seen.get(k) : undefined;
          if (on) { exclude = `Already counted on ${on} (same reference ${text(c(h)) ?? k})`; break; }
        }
      }
      if (exclude) {
        res.dupRows++; res.dupSavings += savings;
        const sheetName = exclude.replace(/^Already counted on (.+?) row .*/, "$1");
        res.dupOn.set(sheetName, (res.dupOn.get(sheetName) ?? 0) + 1);
      } else {
        res.counted++; res.countedSavings += savings; res.dateFixes += notes.length;
        const byComp = fees.get(stream) ?? new Map();
        fees.set(stream, byComp);
        const comps = new Set([...oldParts, ...newParts].map((p) => p.f.component));
        for (const comp of comps) {
          const o = oldParts.filter((p) => p.f.component === comp).reduce((a, p) => a + (p.v ?? 0), 0);
          const nw = newParts.filter((p) => p.f.component === comp).reduce((a, p) => a + (p.v ?? 0), 0);
          if (o === 0 && nw === 0) continue;
          const e = byComp.get(comp) ?? { old: 0, new: 0, lines: 0 };
          e.old += o; e.new += nw; e.lines++;
          byComp.set(comp, e);
        }
      }

      const cells: Record<string, RawCell> = {
        [H.line]: `${m.prefix}-${r.row}`, [H.stream]: stream, [H.source]: m.label, [H.sheetRow]: String(r.row),
        [H.date]: date === null ? null : new Date(date).toISOString(), [H.month]: month === null ? null : new Date(month).toISOString(),
        [H.bu]: text(c(m.cols.bu)), [H.direction]: direction(c(m.cols.direction)), [H.port]: port, [H.route]: route, [H.country]: country,
        [H.partner]: text(c(m.cols.partner)), [H.commodity]: text(c(m.cols.commodity)), [H.reference]: text(c(m.cols.reference)),
        [H.unit]: text(c(m.cols.unit)), [H.boe]: text(c(m.cols.boe)), [H.prev]: prev, [H.cur]: cur, [H.change]: change, [H.initiative]: initiative,
        [H.description]: description, [H.oldFee]: oldFee, [H.newFee]: newFee, [H.savings]: savings,
        [H.feeChange]: oldFee !== null && newFee !== null ? `${fmt(oldFee)} → ${fmt(newFee)}` : null,
        [H.units]: perTruck.has(m) && oldFee ? Math.max(1, Math.round(oldFee / perTruck.get(m)!)) : 1,
        [H.exclude]: exclude, [H.notes]: notes.length ? JSON.stringify(notes) : null,
      };
      rows.push({ row: ++n, cells });
    });
    results.push(res);
  }

  const sheet: ParsedSheet = { name: SAVINGS_SHEET, headerRow: 1, headers: HEADERS, rows, stats: statsFor(HEADERS, rows), validations: {}, totalRowsInSheet: rows.length + 1 };
  merged.set(sheet, { results, fees, summary: summaryTotals(wb) });
  return { ...wb, sheets: [sheet, ...wb.sheets], primary: 0 };
}

/**
 * Dates of a sheet, corrected in two passes, each correction noted for the Data quality page:
 * 1. day and month swapped (Excel read "3/10" as 10 March) when the swap matches the row's Month column;
 * 2. a run of rows whose year differs from the rows on either side (typed 2025, or 2027, 2028… from dragging a date
 *    down) takes the neighbours' year when that puts the dates between the neighbours.
 */
function fixDates(m: SheetMap): { date: number | null; notes: Omit<Fix, "row">[] }[] {
  const out = m.sheet.rows.map((r) => {
    const notes: Omit<Fix, "row">[] = [];
    const mo = monthOf(m.cols.month ? r.cells[m.cols.month] ?? null : null);
    let date = toMs(m.cols.date ? r.cells[m.cols.date] ?? null : null);
    if (date !== null && mo) {
      const d = new Date(date);
      if (d.getUTCMonth() !== mo.m && d.getUTCDate() - 1 === mo.m && d.getUTCDate() <= 12) {
        const swapped = Date.UTC(d.getUTCFullYear(), d.getUTCDate() - 1, d.getUTCMonth() + 1);
        if (new Date(swapped).getUTCDate() === d.getUTCMonth() + 1) {
          notes.push({ field: "Date", from: iso(date), to: iso(swapped), reason: `Day and month were swapped; the Month column says ${MONTH_NAMES[mo.m]}` });
          date = swapped;
        }
      }
    }
    return { date, notes };
  });
  const yearOf = (i: number) => { const t = out[i].date; return t === null ? null : new Date(t).getUTCFullYear(); };
  const prevDated = (i: number) => { for (let j = i - 1; j >= 0; j--) if (out[j].date !== null) return j; return -1; };
  for (let i = 0; i < out.length; i++) {
    const y = yearOf(i);
    if (y === null) continue;
    const p = prevDated(i);
    if (p < 0 || yearOf(p) === y) continue;
    const want = yearOf(p)!;
    // The run of dated rows whose year is not the previous row's year.
    let end = i;
    for (let j = i + 1; j < out.length; j++) { if (out[j].date === null) continue; if (yearOf(j) === want) break; end = j; }
    let next = -1;
    for (let j = end + 1; j < out.length; j++) if (out[j].date !== null) { next = j; break; }
    if (next < 0 || yearOf(next) !== want || end - i > 50) { i = end; continue; }
    const lo = out[p].date! - 45 * DAY, hi = out[next].date! + 45 * DAY;
    for (let j = i; j <= end; j++) {
      const t = out[j].date;
      if (t === null) continue;
      const d = new Date(t);
      const moved = Date.UTC(want, d.getUTCMonth(), d.getUTCDate());
      if (moved < lo || moved > hi) continue;
      out[j].notes.push({ field: "Date", from: iso(t), to: iso(moved), reason: `Year typed as ${d.getUTCFullYear()}; the rows around it are ${want}` });
      out[j].date = moved;
    }
    i = end;
  }
  return out;
}

function statsFor(headers: string[], rows: RawRow[]): ColumnStats[] {
  return headers.map((header, index) => {
    const st: ColumnStats = { header, index, nonEmpty: 0, numbers: 0, dates: 0, booleans: 0, strings: 0, distinct: 0, avgLength: 0, samples: [] };
    const distinct = new Set<string>();
    let len = 0;
    for (const r of rows) {
      const v = r.cells[header];
      if (v === null || v === undefined) continue;
      st.nonEmpty++;
      if (typeof v === "number") st.numbers++;
      else if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) st.dates++;
      else st.strings++;
      distinct.add(String(v));
      len += String(v).length;
      if (st.samples.length < 8 && !st.samples.includes(String(v))) st.samples.push(String(v));
    }
    st.distinct = distinct.size;
    st.avgLength = st.nonEmpty ? len / st.nonEmpty : 0;
    return st;
  });
}

/** Grand totals of the pivot tables on a summary sheet, with the title above each pivot's "Row Labels" cell. */
function summaryTotals(wb: ParsedWorkbook): { title: string; total: number }[] {
  const out: { title: string; total: number }[] = [];
  for (const grid of Object.values(wb.grids ?? {})) {
    for (let r = 0; r < grid.length; r++) for (let c = 0; c < (grid[r]?.length ?? 0); c++) {
      if (!/^grand total$/i.test(String(grid[r][c] ?? "").trim())) continue;
      const total = grid[r].slice(c + 1).find((v) => typeof v === "number") as number | undefined;
      if (total === undefined) continue;
      let title: string | null = null;
      for (let up = r - 1; up >= 0; up--) {
        if (/^row labels$/i.test(String(grid[up]?.[c] ?? "").trim())) { const t = grid[up - 1]?.[c]; title = typeof t === "string" ? t : null; break; }
      }
      if (title) out.push({ title, total });
    }
  }
  return out;
}

const STOP = new Set(["old", "report", "summary", "sum", "savings", "aed", "the", "of", "and", "new"]);
const tokens = (s: string) => hk(s).split(" ").filter((t) => t.length >= 3 && !STOP.has(t));
const near = (a: string, b: string) => a === b || (Math.abs(a.length - b.length) <= 1 && (a.includes(b) || b.includes(a) || [...a].filter((ch, i) => b[i] !== ch).length <= 1));
function summaryFor(info: MergeInfo, m: SheetMap): number | null {
  const own = tokens(m.sheet.name);
  const hit = info.summary.find((s) => tokens(s.title).some((t) => own.some((o) => near(o, t))));
  return hit ? hit.total : null;
}

// ---------- secondary sheets ----------

const money = (id: string, label: string): AuxColumn => ({ id, label, type: "number", format: "currency" });
const int = (id: string, label: string): AuxColumn => ({ id, label, type: "number", format: "integer" });

export function savingsAux(wb: ParsedWorkbook): Record<string, AuxSheet> {
  let sheet = wb.sheets.find((s) => s.name === SAVINGS_SHEET);
  if (!sheet || !merged.has(sheet)) sheet = prepareSavingsWorkbook({ ...wb, sheets: wb.sheets.filter((s) => s.name !== SAVINGS_SHEET) }).sheets[0];
  const info = merged.get(sheet);
  if (!info) return {};
  const recon: Record<string, ColumnValue>[] = [];
  const tot = { rows: 0, sheet: 0, summary: 0, hasSummary: false, dup: 0, dupSav: 0, counted: 0, countedSav: 0 };
  for (const r of info.results) {
    const summary = summaryFor(info, r.map);
    const notes: string[] = [];
    if (summary !== null && Math.abs(summary - r.sheetSavings) > 0.5) notes.push(summary < r.sheetSavings ? `The SUMMARY pivot shows ${fmt(summary)}: it was not refreshed after ${fmt(r.sheetSavings - summary)} AED of rows were added.` : `The SUMMARY pivot shows ${fmt(summary)}, ${fmt(summary - r.sheetSavings)} AED more than the sheet now holds.`);
    if (r.dupRows) notes.push(`${fmt(r.dupRows)} rows repeat trucks or containers already on ${[...r.dupOn.entries()].map(([s, k]) => `${s} (${fmt(k)})`).join(" and ")}; left out so nothing is counted twice.`);
    if (r.mismatchRows) notes.push(`On ${fmt(r.mismatchRows)} rows the stated saving is ${fmt(Math.abs(r.mismatchSum))} AED ${r.mismatchSum > 0 ? "lower" : "higher"} in total than old minus new fees; the stated savings are used.`);
    if (r.dateFixes) notes.push(`${fmt(r.dateFixes)} dates were corrected (day and month swapped, checked against the Month column, or a mistyped year); each is listed on the Data quality page.`);
    recon.push({ sheet: r.map.label, rows: r.rows, sheet_savings: r.sheetSavings, summary, duplicates: r.dupRows || null, duplicate_savings: r.dupSavings || null, counted: r.counted, counted_savings: r.countedSavings, note: notes.join(" ") || "Ties out." });
    tot.rows += r.rows; tot.sheet += r.sheetSavings; tot.dup += r.dupRows; tot.dupSav += r.dupSavings; tot.counted += r.counted; tot.countedSav += r.countedSavings;
    if (summary !== null) { tot.summary += summary; tot.hasSummary = true; }
  }
  recon.push({ sheet: "All sheets", rows: tot.rows, sheet_savings: tot.sheet, summary: tot.hasSummary ? tot.summary : null, duplicates: tot.dup || null, duplicate_savings: tot.dupSav || null, counted: tot.counted, counted_savings: tot.countedSav, note: tot.hasSummary ? `Adding up the SUMMARY pivots gives ${fmt(tot.summary)}; the dashboard counts ${fmt(tot.countedSav)}.` : "" });

  const feeRows = (streams?: string[]) => {
    const out: Record<string, ColumnValue>[] = [];
    for (const s of STREAM_ORDER.concat([...info.fees.keys()].filter((k) => !STREAM_ORDER.includes(k)))) {
      if (streams && !streams.includes(s)) continue;
      const byComp = info.fees.get(s);
      if (!byComp) continue;
      const comps = [...byComp.entries()].sort((a, b) => (b[1].old - b[1].new) - (a[1].old - a[1].new));
      for (const [comp, e] of comps) out.push({ stream: s, component: comp, before: e.old, after: e.new, difference: e.old - e.new, cut: e.old ? (e.old - e.new) / e.old : null, lines: e.lines });
    }
    return out;
  };
  const feeColumns: AuxColumn[] = [
    { id: "stream", label: "Stream", type: "string" }, { id: "component", label: "Fee line", type: "string" },
    money("before", "Before (AED)"), money("after", "After (AED)"), money("difference", "Difference (AED)"),
    { id: "cut", label: "Cut", type: "number", format: "percent" }, int("lines", "Lines"),
  ];
  return {
    reconciliation: {
      id: "reconciliation", label: "How the numbers tie to the workbook",
      columns: [
        { id: "sheet", label: "Sheet", type: "string" }, int("rows", "Rows"), money("sheet_savings", "Savings on the sheet (AED)"),
        money("summary", "SUMMARY pivot (AED)"), int("duplicates", "Repeated rows"), money("duplicate_savings", "Repeated (AED)"),
        int("counted", "Rows counted"), money("counted_savings", "Counted (AED)"), { id: "note", label: "Note", type: "string", wrap: true },
      ],
      rows: recon,
    },
    fee_lines: { id: "fee_lines", label: "Fee lines before and after", columns: feeColumns, rows: feeRows() },
    fee_lines_sea: { id: "fee_lines_sea", label: "Sea fee lines", columns: feeColumns.filter((c) => c.id !== "stream"), rows: feeRows([STREAMS.sea]) },
    fee_lines_other: { id: "fee_lines_other", label: "Spare parts and in-house fee lines", columns: feeColumns, rows: feeRows([STREAMS.spare, STREAMS.inhouse]) },
  };
}

// ---------- schema ----------

export function matchesSavings(headers: string[]): boolean {
  return [H.stream, H.savings, H.change, H.line].every((h) => headers.includes(h));
}

type Spec = Omit<Field, "source" | "label"> & { label?: string };
const SPEC: Record<string, Spec> = {
  [H.line]: { id: "line", type: "string", role: "id" },
  [H.stream]: { id: "stream", type: "string", role: "dimension", order: STREAM_ORDER },
  [H.source]: { id: "source_sheet", type: "string", role: "dimension", hidden: true },
  [H.sheetRow]: { id: "sheet_row", type: "string", role: "text", hidden: true },
  [H.date]: { id: "date", type: "date", role: "date", format: "date" },
  [H.month]: { id: "month", type: "date", role: "date", format: "date", hidden: true },
  [H.bu]: { id: "bu", label: "Business unit", type: "string", role: "dimension", hidden: true },
  [H.direction]: { id: "direction", label: "Import or export", type: "string", role: "dimension", order: ["Import", "Export", "Re-export"] },
  [H.port]: { id: "port", type: "string", role: "dimension" },
  [H.route]: { id: "route", type: "string", role: "text" },
  [H.country]: { id: "country", type: "string", role: "dimension" },
  [H.partner]: { id: "partner", type: "string", role: "dimension" },
  [H.commodity]: { id: "commodity", type: "string", role: "dimension" },
  [H.reference]: { id: "reference", type: "string", role: "text" },
  [H.unit]: { id: "unit_ref", type: "string", role: "text" },
  [H.boe]: { id: "boe", label: "BOE (declaration)", type: "string", role: "text" },
  [H.prev]: { id: "prev_agent", type: "string", role: "dimension" },
  [H.cur]: { id: "cur_agent", type: "string", role: "dimension" },
  [H.change]: { id: "agent_change", label: "Change", type: "string", role: "dimension" },
  [H.initiative]: { id: "initiative", label: "What changed", type: "string", role: "dimension" },
  [H.description]: { id: "description", type: "string", role: "text", hidden: true },
  [H.oldFee]: { id: "old_fee", type: "number", role: "measure", semantic: "amount", format: "currency", currency: CURRENCY },
  [H.newFee]: { id: "new_fee", type: "number", role: "measure", semantic: "amount", format: "currency", currency: CURRENCY },
  [H.savings]: { id: "savings", type: "number", role: "measure", semantic: "amount", format: "currency", currency: CURRENCY },
  [H.feeChange]: { id: "fee_change", label: "Fee before → after (AED)", type: "string", role: "dimension" },
  [H.units]: { id: "units", label: "Trucks or containers", type: "number", role: "measure", format: "integer" },
  [H.exclude]: { id: "exclude_reason", type: "string", role: "text", hidden: true },
  [H.notes]: { id: "notes", type: "string", role: "text", hidden: true },
};

export function savingsSchema(inferred: SchemaMap, sheet?: ParsedSheet): SchemaMap {
  const fields: Field[] = HEADERS.map((h) => {
    const { label, ...spec } = SPEC[h];
    const f: Field = { ...spec, label: label ?? h, source: h };
    if (sheet && (f.id === "partner" || f.id === "commodity")) {
      const vm = buildValueMap(sheet.rows.map((r) => r.cells[h]));
      if (vm) f.valueMap = vm;
    }
    return f;
  });
  fields.push({ id: "month_label", label: "Month", source: null, type: "string", role: "dimension", derived: { kind: "monthLabel", from: "month" } });
  return { ...inferred, sheet: SAVINGS_SHEET, fields, idField: "line", primaryDate: "date", excludeField: "exclude_reason", noteField: "notes" };
}

// ---------- layout ----------

const ROAD: FilterExpr = { field: "stream", op: "eq", value: STREAMS.road };
const SEA: FilterExpr = { field: "stream", op: "eq", value: STREAMS.sea };
const OTHER: FilterExpr = { field: "stream", op: "in", value: [STREAMS.spare, STREAMS.inhouse] };
const sav = (filter?: FilterExpr): MetricSpec => ({ agg: "sum", field: "savings", format: "currency", currency: CURRENCY, ...(filter ? { filter } : {}) });
const fee = (field: "old_fee" | "new_fee", filter?: FilterExpr): MetricSpec => ({ agg: "sum", field, format: "currency", currency: CURRENCY, ...(filter ? { filter } : {}) });
const avg = (field: string, filter?: FilterExpr): MetricSpec => ({ agg: "avg", field, format: "currency", currency: CURRENCY, ...(filter ? { filter } : {}) });
const cnt = (filter?: FilterExpr): MetricSpec => ({ agg: "count", format: "integer", ...(filter ? { filter } : {}) });
const cut = (filter?: FilterExpr): MetricSpec => ({ agg: "ratio", field: "savings", over: "old_fee", format: "percent", ...(filter ? { filter } : {}) });
const units = (filter?: FilterExpr): MetricSpec => ({ agg: "sum", field: "units", format: "integer", ...(filter ? { filter } : {}) });
const perUnit = (field: "old_fee" | "new_fee", filter?: FilterExpr): MetricSpec => ({ agg: "ratio", field, over: "units", format: "currency", currency: CURRENCY, ...(filter ? { filter } : {}) });
const and = (...f: FilterExpr[]): FilterExpr => ({ and: f });

type Grid = { i: string; x: number; y: number; w: number; h: number; minH?: number }[];
const page = (id: string, title: string, widgets: Widget[], grid: Grid) => ({ id, title, widgets, grid });

export function savingsLayout(): Layout {
  const regCols = (extra: string[]) => ["line", "date", ...extra, "old_fee", "new_fee", "savings"];
  const overview = page("overview", "Overview", [
    { id: "insights", type: "insights", title: "What changed since the last update" },
    { id: "kpi_total", type: "kpi", title: "Total savings", metric: sav(), good: "up", secondary: { metric: cnt(), label: "clearances" } },
    { id: "kpi_cut", type: "kpi", title: "Fees cut by", metric: cut(), good: "up", secondary: { metric: fee("old_fee"), label: "before" } },
    { id: "kpi_road", type: "kpi", title: "Road border clearance", metric: sav(ROAD), good: "up", onClick: ROAD, secondary: { metric: units(ROAD), label: "trucks" } },
    { id: "kpi_sea", type: "kpi", title: "Sea port clearance", metric: sav(SEA), good: "up", onClick: SEA, secondary: { metric: cnt(SEA), label: "containers" } },
    { id: "kpi_other", type: "kpi", title: "Spare parts and in-house", metric: sav(OTHER), good: "up", onClick: OTHER, secondary: { metric: cnt(OTHER), label: "jobs" } },
    { id: "kpi_avg", type: "kpi", title: "Average saving", metric: avg("savings"), good: "up", secondary: { metric: { agg: "max", field: "savings", format: "currency", currency: CURRENCY }, label: "largest single" } },
    { id: "monthly", type: "bar", title: "Savings by month", subtitle: "AED by stream; click a month to filter", dimension: "month_label", metric: sav(), stackBy: "stream", sort: "date", colorBy: "categorical", orientation: "horizontal" },
    { id: "streams", type: "bar", title: "Where the savings come from", subtitle: "AED by stream", dimension: "stream", metric: sav(), sort: "value", colorBy: "single", orientation: "horizontal" },
    { id: "changes", type: "bar", title: "Agent changes behind the savings", subtitle: "AED by previous → current agent", dimension: "agent_change", metric: sav(), colorBy: "single", orientation: "horizontal", topN: 6 },
    { id: "before_after", type: "line", title: "Cost of the same work, before and after", subtitle: "AED per month: old fees against new fees", dateField: "month", unit: "month", series: [{ label: "Old fees", metric: fee("old_fee"), kind: "bar" }, { label: "New fees", metric: fee("new_fee"), kind: "bar" }] },
    { id: "initiatives", type: "bar", title: "What changed", subtitle: "AED by initiative", dimension: "initiative", metric: sav(), colorBy: "single", orientation: "horizontal", topN: 8 },
  ], [
    { i: "insights", x: 0, y: 0, w: 12, h: 2, minH: 2 },
    { i: "kpi_total", x: 0, y: 2, w: 2, h: 3 }, { i: "kpi_cut", x: 2, y: 2, w: 2, h: 3 }, { i: "kpi_road", x: 4, y: 2, w: 2, h: 3 },
    { i: "kpi_sea", x: 6, y: 2, w: 2, h: 3 }, { i: "kpi_other", x: 8, y: 2, w: 2, h: 3 }, { i: "kpi_avg", x: 10, y: 2, w: 2, h: 3 },
    { i: "monthly", x: 0, y: 5, w: 7, h: 11 }, { i: "streams", x: 7, y: 5, w: 5, h: 5 }, { i: "changes", x: 7, y: 10, w: 5, h: 6 },
    { i: "before_after", x: 0, y: 16, w: 7, h: 8 }, { i: "initiatives", x: 7, y: 16, w: 5, h: 8 },
  ]);

  const road = page("road", "Road", [
    { id: "road_sav", type: "kpi", title: "Savings at the Sila border", metric: sav(ROAD), good: "up", secondary: { metric: cnt(ROAD), label: "clearances" } },
    { id: "road_trucks", type: "kpi", title: "Trucks cleared", metric: units(ROAD), good: "none", secondary: { metric: cut(ROAD), label: "fees cut" } },
    { id: "road_fee", type: "kpi", title: "Fee per truck, before", metric: perUnit("old_fee", ROAD), good: "none", secondary: { metric: perUnit("new_fee", ROAD), label: "now" } },
    { id: "road_imp", type: "kpi", title: "Import trucks", metric: units(and(ROAD, { field: "direction", op: "eq", value: "Import" })), good: "none", onClick: { field: "direction", op: "eq", value: "Import" }, secondary: { metric: units(and(ROAD, { field: "direction", op: "in", value: ["Export", "Re-export"] })), label: "export trucks" } },
    { id: "road_month", type: "bar", title: "Savings by month", subtitle: "AED, imports and exports", dimension: "month_label", metric: sav(ROAD), filter: ROAD, stackBy: "direction", sort: "date", colorBy: "categorical", orientation: "horizontal" },
    { id: "road_country", type: "bar", title: "Countries", subtitle: "AED by trade partner country", dimension: "country", metric: sav(ROAD), filter: ROAD, colorBy: "single", orientation: "horizontal", topN: 8 },
    { id: "road_partner", type: "bar", title: "Suppliers and customers", subtitle: "AED by company", dimension: "partner", metric: sav(ROAD), filter: ROAD, colorBy: "single", orientation: "horizontal", topN: 10 },
    { id: "road_direction", type: "bar", title: "Imports and exports", subtitle: "AED by direction", dimension: "direction", metric: sav(ROAD), filter: ROAD, colorBy: "single", orientation: "horizontal" },
    { type: "table", id: "road_lines", title: "Road clearances", subtitle: "Every truck counted", columns: regCols(["direction", "route", "country", "partner", "reference", "unit_ref", "agent_change"]), filter: ROAD, sort: { field: "date", dir: "desc" }, search: true, pageSize: 25 },
  ], [
    { i: "road_sav", x: 0, y: 0, w: 3, h: 3 }, { i: "road_trucks", x: 3, y: 0, w: 3, h: 3 }, { i: "road_fee", x: 6, y: 0, w: 3, h: 3 }, { i: "road_imp", x: 9, y: 0, w: 3, h: 3 },
    { i: "road_month", x: 0, y: 3, w: 7, h: 11 }, { i: "road_country", x: 7, y: 3, w: 5, h: 11 },
    { i: "road_partner", x: 0, y: 14, w: 7, h: 9 }, { i: "road_direction", x: 7, y: 14, w: 5, h: 9 },
    { i: "road_lines", x: 0, y: 23, w: 12, h: 12 },
  ]);

  const sea = page("sea", "Sea", [
    { id: "sea_sav", type: "kpi", title: "Savings", metric: sav(SEA), good: "up", secondary: { metric: cnt(SEA), label: "containers" } },
    { id: "sea_boe", type: "kpi", title: "Declarations cleared", metric: { agg: "distinct", field: "boe", format: "integer", filter: SEA }, good: "none", secondary: { metric: { agg: "distinct", field: "partner", format: "integer", filter: SEA }, label: "suppliers" } },
    { id: "sea_cut", type: "kpi", title: "Fees cut by", metric: cut(SEA), good: "up", secondary: { metric: fee("old_fee", SEA), label: "before" } },
    { id: "sea_avg", type: "kpi", title: "Saving per container", metric: avg("savings", SEA), good: "up", secondary: { metric: { agg: "max", field: "savings", format: "currency", currency: CURRENCY, filter: SEA }, label: "largest" } },
    { id: "sea_month", type: "bar", title: "Savings by month", subtitle: "AED by port", dimension: "month_label", metric: sav(SEA), filter: SEA, stackBy: "port", sort: "date", colorBy: "categorical", orientation: "horizontal" },
    { id: "sea_port", type: "bar", title: "Ports", subtitle: "AED by port of entry", dimension: "port", metric: sav(SEA), filter: SEA, colorBy: "single", orientation: "horizontal" },
    { id: "sea_change", type: "bar", title: "Who clears now", subtitle: "AED by previous → current agent", dimension: "agent_change", metric: sav(SEA), filter: SEA, colorBy: "single", orientation: "horizontal" },
    { id: "sea_supplier", type: "bar", title: "Suppliers", subtitle: "AED by supplier", dimension: "partner", metric: sav(SEA), filter: SEA, colorBy: "single", orientation: "horizontal", topN: 8 },
    { id: "sea_origin", type: "bar", title: "Origin countries", subtitle: "AED by country of origin", dimension: "country", metric: sav(SEA), filter: SEA, colorBy: "single", orientation: "horizontal", topN: 8 },
    { id: "sea_commodity", type: "bar", title: "Commodities", subtitle: "AED by commodity", dimension: "commodity", metric: sav(SEA), filter: SEA, colorBy: "single", orientation: "horizontal", topN: 8 },
    { id: "sea_fees", type: "auxTable", title: "Fee lines, before and after", subtitle: "Per fee charged on sea clearances (AED)", sheet: "fee_lines_sea", sort: { field: "difference", dir: "desc" }, rowLabel: "fee lines", pageSize: 20 },
    { type: "table", id: "sea_lines", title: "Sea clearances", subtitle: "Every container counted", columns: regCols(["port", "partner", "commodity", "country", "boe", "unit_ref", "agent_change"]), filter: SEA, sort: { field: "date", dir: "desc" }, search: true, pageSize: 25 },
  ], [
    { i: "sea_sav", x: 0, y: 0, w: 3, h: 3 }, { i: "sea_boe", x: 3, y: 0, w: 3, h: 3 }, { i: "sea_cut", x: 6, y: 0, w: 3, h: 3 }, { i: "sea_avg", x: 9, y: 0, w: 3, h: 3 },
    { i: "sea_month", x: 0, y: 3, w: 7, h: 9 }, { i: "sea_port", x: 7, y: 3, w: 5, h: 4 }, { i: "sea_change", x: 7, y: 7, w: 5, h: 5 },
    { i: "sea_supplier", x: 0, y: 12, w: 4, h: 8 }, { i: "sea_origin", x: 4, y: 12, w: 4, h: 8 }, { i: "sea_commodity", x: 8, y: 12, w: 4, h: 8 },
    { i: "sea_fees", x: 0, y: 20, w: 12, h: 7 },
    { i: "sea_lines", x: 0, y: 27, w: 12, h: 12 },
  ]);

  const other = page("other", "Spares & in-house", [
    { id: "oth_sav", type: "kpi", title: "Savings", metric: sav(OTHER), good: "up", secondary: { metric: cnt(OTHER), label: "jobs" } },
    { id: "oth_spare", type: "kpi", title: "Spare parts clearance", metric: sav({ field: "stream", op: "eq", value: STREAMS.spare }), good: "up", onClick: { field: "stream", op: "eq", value: STREAMS.spare }, secondary: { metric: cnt({ field: "stream", op: "eq", value: STREAMS.spare }), label: "shipments" } },
    { id: "oth_inhouse", type: "kpi", title: "In-house customs work", metric: sav({ field: "stream", op: "eq", value: STREAMS.inhouse }), good: "up", onClick: { field: "stream", op: "eq", value: STREAMS.inhouse }, secondary: { metric: cnt({ field: "stream", op: "eq", value: STREAMS.inhouse }), label: "jobs" } },
    { id: "oth_cut", type: "kpi", title: "Fees cut by", metric: cut(OTHER), good: "up", secondary: { metric: fee("old_fee", OTHER), label: "before" } },
    { id: "oth_initiative", type: "bar", title: "What changed", subtitle: "AED by initiative", dimension: "initiative", metric: sav(OTHER), filter: OTHER, colorBy: "single", orientation: "horizontal", topN: 10 },
    { id: "oth_month", type: "bar", title: "Savings by month", subtitle: "AED by stream", dimension: "month_label", metric: sav(OTHER), filter: OTHER, stackBy: "stream", sort: "date", colorBy: "categorical", orientation: "horizontal" },
    { id: "oth_fees", type: "auxTable", title: "Fee lines, before and after", subtitle: "Per fee charged (AED)", sheet: "fee_lines_other", sort: { field: "difference", dir: "desc" }, rowLabel: "fee lines", pageSize: 20 },
    { type: "table", id: "oth_lines", title: "Jobs", subtitle: "Every spare parts shipment and in-house job counted", columns: regCols(["stream", "initiative", "port", "route", "reference", "agent_change", "description"]), filter: OTHER, sort: { field: "date", dir: "desc" }, search: true, pageSize: 25 },
  ], [
    { i: "oth_sav", x: 0, y: 0, w: 3, h: 3 }, { i: "oth_spare", x: 3, y: 0, w: 3, h: 3 }, { i: "oth_inhouse", x: 6, y: 0, w: 3, h: 3 }, { i: "oth_cut", x: 9, y: 0, w: 3, h: 3 },
    { i: "oth_initiative", x: 0, y: 3, w: 6, h: 8 }, { i: "oth_month", x: 6, y: 3, w: 6, h: 8 },
    { i: "oth_fees", x: 0, y: 11, w: 12, h: 7 },
    { i: "oth_lines", x: 0, y: 18, w: 12, h: 12 },
  ]);

  const tie = page("tie", "Reconciliation", [
    { id: "recon", type: "auxTable", title: "Every sheet against the dashboard", subtitle: "What each sheet holds, what the SUMMARY pivots say, and what is counted here", sheet: "reconciliation", rowLabel: "sheets", pageSize: 20 },
    { id: "fees_all", type: "auxTable", title: "Fee lines, before and after", subtitle: "Every fee charged, by stream (AED); the difference can exceed the stated savings where a sheet leaves a fee out of its savings", sheet: "fee_lines", rowLabel: "fee lines", pageSize: 30 },
    { id: "rates", type: "auxTable", title: "Contract rate cards", subtitle: "Clearance and transport rates on the previous agents' contracts, transcribed from the contract pages pasted in the workbook", sheet: "contract_rates", rowLabel: "rates", pageSize: 60 },
  ], [
    { i: "recon", x: 0, y: 0, w: 12, h: 13 },
    { i: "fees_all", x: 0, y: 13, w: 12, h: 10 },
    { i: "rates", x: 0, y: 23, w: 12, h: 14 },
  ]);

  const register = page("register", "Register", [
    { type: "table", id: "register", title: "All savings lines", subtitle: "One line per truck, container or job; the Line column points back to the sheet and row", columns: ["line", "stream", "date", "initiative", "port", "country", "partner", "reference", "unit_ref", "agent_change", "old_fee", "new_fee", "savings"], sort: { field: "date", dir: "desc" }, search: true, pageSize: 60 },
  ], [{ i: "register", x: 0, y: 0, w: 12, h: 18 }]);

  const quality = page("quality", "Data quality", [{ id: "quality", type: "quality", title: "Data quality" }], [{ i: "quality", x: 0, y: 0, w: 12, h: 16 }]);

  return {
    version: 1,
    dateField: "date",
    filters: [
      { kind: "daterange", field: "date", label: "Date" },
      { kind: "select", field: "stream", label: "Stream" },
      { kind: "select", field: "initiative", label: "What changed" },
      { kind: "select", field: "agent_change", label: "Change" },
      { kind: "select", field: "port", label: "Port or border" },
      { kind: "select", field: "country", label: "Country" },
      { kind: "search", field: "reference", label: "Search" },
    ],
    pages: [overview, road, sea, other, tie, register, quality],
  } as Layout;
}

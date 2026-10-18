import type { AuxSheet, ColumnValue, Field, FilterExpr, ParsedSheet, ParsedWorkbook, RawCell, SchemaMap } from "@/lib/schema/types";
import { cleanText, normKey } from "@/lib/schema/types";
import { toNumber } from "@/lib/schema/normalize";
import type { Layout, Page, Widget } from "@/lib/dashboard/types";
import type { MetricSpec } from "@/lib/engine/metrics";

/**
 * Export freight tracker: one row per container shipped (customer, booking, BL, vessel, carrier, trucker, clearing
 * agent, ports, loading/sailing/arrival dates, status) with the freight paid per container, split into carrier,
 * transport, clearance, documentation and additional charges, the cost given to the sales team for pricing, and the
 * margin between the two. Matched by headers (the Al Foah "Import-Export 2026" workbook, Export sheet). The workbook's
 * small pivot sheets are read only to reconcile against; every figure comes from the container rows.
 *
 * The sheet has a two-row header: "Carrier", "Transport", "Clearance" appear once as the vendor and again under the
 * groups Invoice Number, PO Number, Invoice Amount and Payment Status. The parser numbers the repeats in order
 * ("Carrier (2)" … "Carrier (5)"), so the spec below maps each repeat to its group.
 */

const CURRENCY = "AED";

/** Country spellings seen in the Al Foah sheets, folded to one name (shared with the shipment tracker). */
export const COUNTRIES: Record<string, string> = {
  uae: "UAE", "united arab emirates": "UAE", ksa: "Saudi Arabia", "saudi arabia": "Saudi Arabia", "england -uk": "United Kingdom", "england - uk": "United Kingdom", england: "United Kingdom", uk: "United Kingdom",
  "united kingdom": "United Kingdom", crotia: "Croatia", croatia: "Croatia", swedan: "Sweden", sweden: "Sweden", brazil: "Brazil", india: "India", mexico: "Mexico", bolivia: "Bolivia", turkey: "Turkey",
  usa: "USA", "united states": "USA", oman: "Oman", australia: "Australia", tanzania: "Tanzania", somalia: "Somalia", kenya: "Kenya", germany: "Germany",
  fiji: "Fiji", indonesia: "Indonesia", norway: "Norway", "south korea": "South Korea",
};
export const CONTAINER_TYPES: Record<string, string> = { "40 hc": "40HC", "40hc": "40HC", "40 hr": "40HR (reefer)", "40hr": "40HR (reefer)", "20 std": "20STD", "20std": "20STD", "40 curtain": "40 curtain side" };
export const MODES: Record<string, string> = { sea: "Sea", land: "Land", air: "Air", road: "Land", "muliti model": "Multimodal", "multi model": "Multimodal", "multimodal": "Multimodal" };
const EXIT: Record<string, string> = { y: "Received", yes: "Received", n: "Not yet", no: "Not yet", "n/a": "Not needed", na: "Not needed" };

type Patch = Partial<Field> & { id: string };
type Spec = { match: (k: string) => boolean; patch: Patch };
const is = (...names: string[]) => (k: string) => names.includes(k);
const money = (id: string, label: string, hidden = false): Patch => ({ id, label, type: "number", role: "measure", semantic: "amount", format: "currency", currency: CURRENCY, ...(hidden ? { hidden } : {}) });
const text = (id: string, label: string): Patch => ({ id, label, type: "string", role: "text", hidden: true });
/** The four vendor columns repeated under each header group, in the order the parser numbers them. */
const VENDORS = [{ key: "carrier", label: "Carrier" }, { key: "transport", label: "Transport" }, { key: "clearance", label: "Clearance" }, { key: "additional charge", label: "Additional charge", id: "additional" }];
const SPECS: Spec[] = [
  // Who sold it: staff names, never shown.
  { match: is("sales person", "salesperson", "sales"), patch: { id: "sales_person", role: "ignore" } },
  { match: is("s.no", "s no", "sl no", "#"), patch: { id: "s_no", role: "ignore" } },
  { match: is("customer code"), patch: text("customer_code", "Customer code") },
  { match: is("customer name", "customer"), patch: { id: "customer", label: "Customer", type: "string", role: "dimension", semantic: "customer" } },
  { match: is("booking number", "booking no"), patch: text("booking", "Booking") },
  { match: is("incoterms", "incoterm", "inco terms"), patch: { id: "incoterms", label: "Incoterms", type: "string", role: "dimension", valueMap: { cnf: "CNF", cfr: "CNF", "c&f": "CNF", fob: "FOB", cif: "CIF", exw: "EXW", ddp: "DDP" } } },
  { match: is("bl number", "b/l number", "bl no"), patch: { id: "bl_number", label: "B/L", type: "string", role: "text" } },
  { match: is("container number", "container no"), patch: { id: "container", label: "Container", type: "string", role: "id" } },
  { match: is("vessel name", "vessel"), patch: { id: "vessel", label: "Vessel", type: "string", role: "text" } },
  { match: is("carrier", "shipping line"), patch: { id: "carrier", label: "Shipping line", type: "string", role: "dimension" } },
  { match: is("transport", "transporter"), patch: { id: "transporter", label: "Trucking", type: "string", role: "dimension" } },
  { match: is("clearance", "clearing agent"), patch: { id: "clearing_agent", label: "Clearing agent", type: "string", role: "dimension" } },
  { match: is("product name", "product"), patch: { id: "product", label: "Product", type: "string", role: "text" } },
  { match: is("pol country"), patch: { id: "origin_country", label: "Origin country", type: "string", role: "dimension", semantic: "origin", valueMap: COUNTRIES, hidden: true } },
  { match: is("pol", "port of loading"), patch: { id: "pol", label: "Port of loading", type: "string", role: "dimension", semantic: "origin" } },
  { match: is("fpol"), patch: { id: "fpol", label: "First port of loading", type: "string", role: "dimension", hidden: true } },
  { match: is("pod country", "destination country"), patch: { id: "country", label: "Destination country", type: "string", role: "dimension", semantic: "destination", valueMap: COUNTRIES } },
  { match: is("pod", "port of discharge"), patch: { id: "pod", label: "Port of discharge", type: "string", role: "dimension", semantic: "destination" } },
  { match: is("loading location"), patch: { id: "loading_location", label: "Loading location", type: "string", role: "dimension", hidden: true } },
  { match: is("loading date"), patch: { id: "loading_date", label: "Loaded", type: "date", role: "date", format: "date" } },
  { match: is("cut off", "cut-off", "cutoff"), patch: { id: "cut_off", label: "Cut-off", type: "date", role: "date", format: "date", hidden: true } },
  { match: is("ets", "etd"), patch: { id: "ets", label: "Sailed (ETS)", type: "date", role: "date", format: "date" } },
  { match: is("eta"), patch: { id: "eta", label: "Planned ETA", type: "date", role: "date", format: "date" } },
  { match: is("revised eta"), patch: { id: "revised_eta", label: "Revised ETA", type: "date", role: "date", format: "date" } },
  { match: is("planned tt"), patch: { id: "planned_tt", label: "Planned transit (sheet)", type: "number", role: "measure", format: "days", hidden: true } },
  { match: is("revised tt"), patch: { id: "revised_tt", label: "Revised transit (sheet)", type: "number", role: "measure", format: "days", hidden: true } },
  { match: is("delay days"), patch: { id: "delay_sheet", label: "Delay (sheet)", type: "number", role: "measure", format: "days", hidden: true } },
  { match: is("ft pol"), patch: { id: "free_time_pol", label: "Free time at loading", type: "string", role: "dimension", hidden: true } },
  { match: is("ft pod"), patch: { id: "free_time_pod", label: "Free time at destination", type: "string", role: "dimension", hidden: true } },
  { match: is("swb/obl", "swb / obl"), patch: { id: "bl_type", label: "B/L type", type: "string", role: "dimension", hidden: true } },
  { match: is("mode of tpt", "mode of transport", "mode"), patch: { id: "mode", label: "Mode", type: "string", role: "dimension", semantic: "mode", valueMap: MODES } },
  { match: is("container type"), patch: { id: "container_type", label: "Container type", type: "string", role: "dimension", valueMap: CONTAINER_TYPES } },
  { match: is("total container", "total containers"), patch: { id: "container_count", label: "Containers", type: "number", role: "measure", format: "integer", hidden: true } },
  { match: is("total package", "total packages"), patch: { id: "packages", label: "Packages", type: "number", role: "measure", format: "integer", hidden: true } },
  { match: is("ton/kg"), patch: { id: "weight_unit", role: "ignore" } },
  { match: is("total weight"), patch: { id: "weight", label: "Weight (t)", type: "number", role: "measure", semantic: "quantity", format: "decimal" } },
  // In each invoice's own currency (USD, AED or EUR depending on the customer): shown per container, never added up.
  { match: is("shipment value"), patch: { id: "shipment_value", label: "Invoice value (invoice currency)", type: "number", role: "measure", format: "decimal", aggregate: "max", hidden: true } },
  { match: is("invoice number"), patch: { id: "invoice", label: "Invoice no.", type: "string", role: "text" } },
  { match: is("invoice date"), patch: { id: "invoice_date", label: "Invoice date", type: "date", role: "date", format: "date", hidden: true } },
  { match: is("shipment status", "status"), patch: { id: "status", label: "Status as typed", type: "string", role: "dimension", hidden: true } },
  ...VENDORS.flatMap((v, i): Spec[] => {
    const id = v.id ?? v.key;
    // The first "Additional Charge" already sits under Invoice Number (there is no vendor column for it).
    const n = (k: number) => (i === 3 ? k - 1 : k);
    const h = (k: number) => (n(k) === 1 ? v.key : `${v.key} (${n(k)})`);
    return [
      { match: is(h(2)), patch: text(`${id}_invoice`, `${v.label} invoice no.`) },
      { match: is(h(3)), patch: text(`${id}_po`, `${v.label} PO`) },
      { match: is(h(4)), patch: money(`${id === "carrier" ? "ocean_freight" : id === "transport" ? "trucking" : id}_cost`, `${id === "carrier" ? "Ocean freight" : id === "transport" ? "Trucking" : v.label} (AED)`, true) },
      { match: is(h(5)), patch: text(`${id}_paid`, `${v.label} payment`) },
    ];
  }),
  { match: is("documentation charge", "documentation charges"), patch: money("documentation_cost", "Documentation (AED)", true) },
  { match: is("declaration number", "declaration no"), patch: text("declaration", "Export declaration") },
  { match: is("exit certificate"), patch: { id: "exit_certificate", label: "Exit certificate", type: "string", role: "dimension", valueMap: EXIT, order: ["Received", "Not yet", "Not needed"] } },
  { match: is("shipment cost"), patch: money("freight_cost", "Freight cost (AED)") },
  { match: is("cost given to sales team", "cost given to sales"), patch: money("sales_price", "Given to sales (AED)") },
  { match: is("margin"), patch: money("margin", "Margin (AED)") },
  { match: is("remarks", "remark"), patch: { id: "remarks", label: "Remarks", type: "string", role: "text" } },
];
const specFor = (header: string): Spec | undefined => { const k = normKey(header); return SPECS.find((s) => s.match(k)); };

export function matchesFreight(headers: string[]): boolean {
  const ids = new Set(headers.map((h) => specFor(h)?.patch.id));
  return ["container", "freight_cost", "sales_price", "margin"].every((id) => ids.has(id));
}

const STAGES = ["In transit", "Delivered", "Returned", "Other"];
const stage = (value: string): FilterExpr => ({ field: "stage", op: "eq", value });
const IN_TRANSIT = stage("In transit"), DELIVERED = stage("Delivered");
const PAST_ETA: FilterExpr = { and: [IN_TRANSIT, { field: "days_to_arrival", op: "lt", value: 0 }] };
const DUE_7: FilterExpr = { and: [IN_TRANSIT, { field: "days_to_arrival", op: "between", value: [0, 7] }] };
const LATE: FilterExpr = { field: "delay_days", op: "gt", value: 0 };
const COSTED: FilterExpr = { field: "freight_cost", op: "gt", value: 0 };
const CNF: FilterExpr = { and: [{ field: "incoterms", op: "eq", value: "CNF" }, COSTED] };

export function freightSchema(inferred: SchemaMap): SchemaMap {
  const fields: Field[] = [];
  const taken = new Set<string>();
  for (const f of inferred.fields) {
    if (f.derived) continue;
    const spec = f.source ? specFor(f.source) : undefined;
    if (!spec || taken.has(spec.patch.id)) { fields.push({ ...f, role: /^column /i.test(f.source ?? "") ? "ignore" : f.role === "id" ? "text" : f.role, hidden: true }); continue; }
    taken.add(spec.patch.id);
    const { id, ...patch } = spec.patch;
    const valueMap = patch.valueMap || f.valueMap ? { ...(f.valueMap ?? {}), ...(patch.valueMap ?? {}) } : undefined;
    fields.push({ id, label: f.label, source: f.source, type: f.type, role: f.role, ...patch, ...(valueMap ? { valueMap } : {}), ...(f.aliases ? { aliases: f.aliases } : {}) });
  }
  const has = (id: string) => fields.some((f) => f.id === id);
  const contains = (...words: string[]): FilterExpr => ({ or: words.map((w): FilterExpr => ({ field: "status", op: "contains", value: w })) });
  fields.push({ id: "stage", label: "Status", source: null, type: "string", role: "dimension", semantic: "status", order: STAGES,
    derived: { kind: "case", cases: [
      { when: contains("deliver", "arrived", "completed"), value: "Delivered" },
      { when: contains("transit", "sailed", "on the way", "on board"), value: "In transit" },
      { when: contains("return"), value: "Returned" },
      { when: { field: "status", op: "notNull" }, value: "Other" },
    ], fallback: null } });
  if (has("eta") && has("revised_eta")) fields.push(
    { id: "delay_days", label: "Days late", source: null, type: "number", role: "measure", format: "days", aggregate: "max", derived: { kind: "diffDays", from: "eta", to: "revised_eta" } },
    { id: "delay_band", label: "Arrival", source: null, type: "string", role: "dimension", order: ["On time", "1–7 days late", "8–14 days late", "15+ days late"],
      derived: { kind: "bucket", from: "delay_days", edges: [1, 8, 15], labels: ["On time", "1–7 days late", "8–14 days late", "15+ days late"] } },
  );
  if (has("revised_eta")) fields.push({ id: "days_to_arrival", label: "Days to arrival", source: null, type: "number", role: "measure", format: "days", aggregate: "min", derived: { kind: "daysUntil", from: "revised_eta" } });
  if (has("ets") && has("revised_eta")) fields.push({ id: "transit_days", label: "Transit (days)", source: null, type: "number", role: "measure", format: "days", aggregate: "max", derived: { kind: "diffDays", from: "ets", to: "revised_eta" } });
  if (has("loading_date")) fields.push({ id: "month", label: "Month loaded", source: null, type: "string", role: "dimension", semantic: "period", derived: { kind: "monthLabel", from: "loading_date" } });
  fields.push({ id: "margin_result", label: "Margin", source: null, type: "string", role: "dimension", order: ["Positive margin", "Break-even", "Negative margin", "No cost recorded"],
    derived: { kind: "case", cases: [
      { when: { or: [{ field: "freight_cost", op: "isNull" }, { field: "freight_cost", op: "eq", value: 0 }] }, value: "No cost recorded" },
      { when: { field: "margin", op: "gt", value: 1 }, value: "Positive margin" },
      { when: { field: "margin", op: "lt", value: -1 }, value: "Negative margin" },
    ], fallback: "Break-even" } });
  if (has("declaration")) fields.push({ id: "declaration_status", label: "Export declaration", source: null, type: "string", role: "dimension", order: ["Received", "Not received"],
    derived: { kind: "case", cases: [{ when: { field: "declaration", op: "contains", value: "not" }, value: "Not received" }, { when: { field: "declaration", op: "notNull" }, value: "Received" }], fallback: "Not received" } });
  return { ...inferred, fields, idField: has("container") ? "container" : inferred.idField, requireField: has("container") ? "container" : undefined, primaryDate: has("loading_date") ? "loading_date" : inferred.primaryDate, dateChain: ["loading_date", "cut_off", "ets", "eta"].filter(has) };
}

// ---------- reconciliation against the workbook's own summaries ----------

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const aed = (n: number) => `AED ${fmt(n)}`;
const country = (v: unknown) => { const k = normKey(v); return COUNTRIES[k] ?? cleanText(v ?? ""); };

interface Table { header: string[]; rows: RawCell[][]; total: RawCell[] | null; title: string | null }

/** Small tables on the summary sheets: a header row starting "Row Labels" or "Country", rows down to "Grand Total". */
function tablesIn(grid: RawCell[][]): Table[] {
  const out: Table[] = [];
  let title: string | null = null;
  for (let r = 0; r < grid.length; r++) {
    const first = normKey(grid[r][0]);
    if (!first) continue;
    if (!/^(row labels|count?ry|country)$/.test(first)) { if (grid[r].filter((v) => v !== null && v !== "").length === 1) title = cleanText(grid[r][0]); continue; }
    const t: Table = { header: grid[r].map((v) => normKey(v)), rows: [], total: null, title };
    for (r = r + 1; r < grid.length; r++) {
      const k = normKey(grid[r][0]);
      if (!k) break;
      if (k === "grand total") { t.total = grid[r]; break; }
      t.rows.push(grid[r]);
    }
    out.push(t);
    title = null;
  }
  return out;
}
const col = (t: Table, ...names: RegExp[]) => t.header.findIndex((h) => names.some((n) => n.test(h)));

export function freightAux(wb: ParsedWorkbook): Record<string, AuxSheet> {
  const sheet = wb.sheets.find((s) => matchesFreight(s.headers));
  if (!sheet) return {};
  const h = (id: string) => sheet.headers.find((x) => specFor(x)?.patch.id === id);
  const H = { booking: h("booking"), mode: h("mode"), container: h("container"), cost: h("freight_cost"), price: h("sales_price"), margin: h("margin"), country: h("country"), pod: h("pod"), status: h("status"), sno: h("s_no"), paid: ["carrier_paid", "transport_paid", "clearance_paid", "additional_paid"].map(h).filter(Boolean) as string[], parts: ["ocean_freight_cost", "trucking_cost", "clearance_cost", "documentation_cost", "additional_cost"].map(h).filter(Boolean) as string[] };
  const num = (r: ParsedSheet["rows"][number], k?: string) => (k ? toNumber(r.cells[k] ?? null) ?? 0 : 0);
  const boxes = sheet.rows.filter((r) => H.container && cleanText(r.cells[H.container] ?? ""));
  const noBox = sheet.rows.filter((r) => !(H.container && cleanText(r.cells[H.container] ?? "")));
  const planned = noBox.filter((r) => H.country && cleanText(r.cells[H.country] ?? ""));
  const unboxed = noBox.filter((r) => !planned.includes(r) && H.booking && cleanText(r.cells[H.booking] ?? ""));
  const sum = (k?: string) => boxes.reduce((a, r) => a + num(r, k), 0);
  const cost = sum(H.cost), price = sum(H.price), margin = sum(H.margin);
  const out: Record<string, ColumnValue>[] = [];
  const add = (check: string, report: string, workbook: string | null, note: string) => out.push({ check, report, workbook, note });

  add("Containers", fmt(boxes.length), null, planned.length
    ? `${fmt(planned.length)} more row${planned.length === 1 ? " is a planned shipment" : "s are planned shipments"} without a container number yet (${planned.map((r) => cleanText(r.cells[H.pod!] ?? r.cells[H.country!] ?? "")).join(", ")}); ${planned.length === 1 ? "it is" : "they are"} counted once a container is added.`
    : "Every row with a container number is counted.");
  for (const r of unboxed) add("Shipment without a container", `Row ${r.row}`, null, `${H.mode && cleanText(r.cells[H.mode] ?? "") ? `${MODES[normKey(r.cells[H.mode])] ?? cleanText(r.cells[H.mode])} shipment` : "A shipment"} under booking ${cleanText(r.cells[H.booking!])} with no container number${H.country && !cleanText(r.cells[H.country] ?? "") ? ", destination" : ""}${!num(r, H.cost) ? " or cost" : ""} yet; left out until it is filled in.`);

  // The sheet's own total under the Margin column (a lone number on an otherwise empty row).
  const totalRow = sheet.rows.find((r) => !(H.container && r.cells[H.container]) && H.margin && typeof r.cells[H.margin] === "number" && Object.values(r.cells).filter((v) => v !== null && v !== "" && v !== 0).length === 1);
  if (totalRow) { const t = num(totalRow, H.margin); add("Margin total on the sheet", aed(margin), aed(t), Math.abs(t - margin) < 1 ? "Matches the total typed under the Margin column." : `Differs by ${aed(margin - t)}: the total under the Margin column is not up to date.`); }

  // Formula checks: freight cost = its parts, margin = price given to sales − freight cost.
  const partsOff = boxes.filter((r) => H.parts.length && Math.abs(num(r, H.cost) - H.parts.reduce((a, k) => a + num(r, k), 0)) > 1).length;
  const marginOff = boxes.filter((r) => r.cells[H.margin!] !== null && r.cells[H.margin!] !== undefined && Math.abs(num(r, H.margin) - (num(r, H.price) - num(r, H.cost))) > 1).length;
  add("Cost and margin formulas", partsOff || marginOff ? `${fmt(partsOff + marginOff)} rows off` : "All rows", null,
    partsOff || marginOff ? `${partsOff ? `On ${fmt(partsOff)} rows the freight cost is not the sum of its lines. ` : ""}${marginOff ? `On ${fmt(marginOff)} rows the margin is not price given to sales minus freight cost.` : ""}`
      : "Freight cost is ocean freight + trucking + clearance + documentation + additional charges, and margin is the price given to sales minus freight cost, on every row.");

  // Rows that drag the margin down most.
  const worst = boxes.filter((r) => num(r, H.margin) < 0).sort((a, b) => num(a, H.margin) - num(b, H.margin));
  if (worst.length) {
    const w = worst[0];
    add("Largest negative margin", aed(num(w, H.margin)), null, `Container ${cleanText(w.cells[H.container!])} to ${country(w.cells[H.country!])}: freight cost ${aed(num(w, H.cost))} against ${aed(num(w, H.price))} given to sales. Worth checking the figure given to sales. Without this container the margin would be ${aed(margin - num(w, H.margin))}. ${fmt(worst.length)} container${worst.length === 1 ? " has" : "s have"} a negative margin in all (${aed(worst.reduce((a, r) => a + num(r, H.margin), 0))}).`);
  }

  const byCountry = new Map<string, { n: number; margin: number }>();
  for (const r of boxes) { const c = country(r.cells[H.country!]); const e = byCountry.get(c) ?? { n: 0, margin: 0 }; e.n++; e.margin += num(r, H.margin); byCountry.set(c, e); }

  let lastVerdict = "";
  for (const [name, grid] of Object.entries(wb.grids ?? {})) {
    if (name === sheet.name) continue;
    for (const t of tablesIn(grid)) {
      const iMargin = col(t, /mari?gin/), iCount = col(t, /count of container|container executed/), iCost = col(t, /sum of shipment cost/), iPrice = col(t, /given to sales/), iBu = col(t, /^bu$/);
      if (iMargin === -1) continue;
      const tot = t.total ? toNumber(t.total[iMargin]) ?? 0 : t.rows.reduce((a, r) => a + (toNumber(r[iMargin]) ?? 0), 0);
      const totN = iCount === -1 ? null : t.total ? toNumber(t.total[iCount]) : null;
      if (iCost !== -1) {
        // A pivot by person: compared in total only, names are not repeated here.
        const c = t.total ? toNumber(t.total[iCost]) ?? 0 : 0, p = iPrice !== -1 && t.total ? toNumber(t.total[iPrice]) ?? 0 : 0;
        const same = Math.abs(c - cost) < 1 && Math.abs(tot - margin) < 1;
        add(`“${name}” pivot (by sales person)`, `Cost ${aed(cost)} · given ${aed(price)} · margin ${aed(margin)}`, `Cost ${aed(c)} · given ${aed(p)} · margin ${aed(tot)}`, same ? "Matches." : "Not refreshed since the container rows changed; its totals are lower than the sheet. The dashboard does not show figures per sales person.");
        continue;
      }
      const label = t.header[0] === "row labels" ? `“${name}” pivot (by country)` : `“${name}” table${t.title ? ` · ${t.title}` : ""}`;
      if (t.header.some((x) => /under process/.test(x))) {
        add(`${label} · under process`, "Not counted", `${fmt(toNumber(t.total?.[col(t, /under process/)] ?? null) ?? 0)} containers · ${aed(tot)}`, "Expected margin on shipments not executed yet, at flat rates per container; an estimate, so it is not part of the figures.");
        continue;
      }
      const outside = iBu === -1 ? [] : t.rows.filter((r) => !byCountry.has(country(r[0])) && cleanText(r[iBu] ?? ""));
      const diffs: string[] = [];
      // A second table with the same country figures as a pivot already compared says so instead of repeating it.
      for (const r of t.rows) {
        const c = country(r[0]); const mine = byCountry.get(c);
        if (!mine) continue;
        const theirs = toNumber(r[iMargin]) ?? 0;
        if (Math.abs(theirs - mine.margin) > 1) diffs.push(`${c} ${fmt(mine.margin)} vs ${fmt(theirs)}`);
      }
      const missing = [...byCountry.keys()].filter((c) => !t.rows.some((r) => country(r[0]) === c));
      const outsideNote = outside.length ? ` It also includes ${outside.map((r) => `${fmt(toNumber(r[iCount]) ?? 0)} containers to ${country(r[0])} (${cleanText(r[iBu])}, ${aed(toNumber(r[iMargin]) ?? 0)})`).join(", ")}, which are not in this workbook.` : "";
      const verdict = diffs.length || missing.length ? `Not refreshed: ${[...diffs, ...missing.map((c) => `${c} (${fmt(byCountry.get(c)!.margin)}) is missing from it`)].join("; ")}.` : "Matches country by country.";
      add(label, `${fmt(boxes.length)} containers · ${aed(margin)}`, `${totN === null ? "" : `${fmt(totN)} containers · `}${aed(tot)}`,
        (verdict === lastVerdict ? "Its countries carry the same figures as the pivot above, so it is not up to date either." : verdict) + outsideNote);
      lastVerdict = verdict;
    }
  }

  add("Invoice value", "Per container only", null, "The Shipment Value column is in each invoice's own currency (USD, AED or EUR depending on the customer), so it is shown per container and never added up.");
  const paidFilled = boxes.filter((r) => H.paid.some((k) => cleanText(r.cells[k] ?? ""))).length;
  if (H.paid.length) add("Payment status", paidFilled ? `${fmt(paidFilled)} containers` : "Empty", null, paidFilled ? "Payment status is filled on some containers only." : "The Payment Status columns are empty, so payments are not tracked on the dashboard yet.");
  const odd = [...new Set(boxes.map((r) => cleanText(r.cells[H.status!] ?? "")).filter((s) => s && !/deliver|transit|return|arrived|sailed|completed|on the way|on board/i.test(s)))];
  if (odd.length) add("Status", odd.map((s) => `“${s}”`).join(", "), null, `Kept as typed and shown as Other; not a known status word (${odd.length === 1 ? "is it" : "are they"} a typo?).`);

  return {
    reconciliation: {
      id: "reconciliation", label: "How the figures tie to the workbook",
      columns: [
        { id: "check", label: "Figure", type: "string" }, { id: "report", label: "This report", type: "string" },
        { id: "workbook", label: "In the workbook", type: "string" }, { id: "note", label: "Note", type: "string", wrap: true },
      ],
      rows: out,
    },
  };
}

// ---------- layout ----------

const containers = (filter?: FilterExpr): MetricSpec => ({ agg: "count", format: "integer", ...(filter ? { filter } : {}) });
const sum = (field: string, filter?: FilterExpr): MetricSpec => ({ agg: "sum", field, format: "currency", currency: CURRENCY, ...(filter ? { filter } : {}) });
const avg = (field: string, filter?: FilterExpr, format: MetricSpec["format"] = "currency"): MetricSpec => ({ agg: "avg", field, format, ...(format === "currency" ? { currency: CURRENCY } : {}), ...(filter ? { filter } : {}) });

export function freightLayout(schema: SchemaMap): Layout {
  const has = (id: string) => schema.fields.some((f) => f.id === id);
  const cols = (ids: string[]) => ids.filter(has);
  const table = (w: Omit<Extract<Widget, { type: "table" }>, "type">): Widget => ({ type: "table", rowLabel: "containers", ...w, columns: cols(w.columns) });

  const overview: Page = { id: "overview", title: "Overview", widgets: [
    { id: "insights", type: "insights", title: "What changed since the last update" },
    { id: "kpi_containers", type: "kpi", title: "Containers shipped", metric: containers(), good: "up", secondary: { metric: containers(IN_TRANSIT), label: "still in transit" } },
    { id: "kpi_cost", type: "kpi", title: "Freight cost", metric: sum("freight_cost"), good: "down", secondary: { metric: avg("freight_cost", COSTED), label: "per container" } },
    { id: "kpi_price", type: "kpi", title: "Given to sales", metric: sum("sales_price"), good: "none", secondary: { metric: avg("sales_price", COSTED), label: "per container" } },
    { id: "kpi_margin", type: "kpi", title: "Freight margin", metric: sum("margin"), good: "up", secondary: { metric: { agg: "ratio", field: "margin", over: "sales_price", format: "percent", decimals: 1 }, label: "of the price given to sales" } },
    { id: "kpi_delivered", type: "kpi", title: "Delivered", metric: containers(DELIVERED), good: "up", onClick: DELIVERED, secondary: { metric: { agg: "rate", numerator: DELIVERED, format: "percent" }, label: "of all containers" } },
    { id: "kpi_late", type: "kpi", title: "Arriving late", metric: containers(LATE), good: "down", onClick: LATE, secondary: { metric: avg("delay_days", LATE, "days"), label: "late on average" } },
    { id: "margin_country", type: "bar", title: "Margin by destination", subtitle: "AED, price given to sales minus freight cost", dimension: "country", metric: sum("margin"), sort: "value", colorBy: "single", orientation: "horizontal", share: false },
    { id: "cost_month", type: "line", title: "Freight cost against the price given to sales", subtitle: "AED by month loaded", dateField: "loading_date", unit: "month",
      series: [{ label: "Freight cost", metric: sum("freight_cost"), kind: "bar" }, { label: "Given to sales", metric: sum("sales_price"), kind: "bar" }, { label: "Margin", metric: sum("margin"), kind: "line" }] },
    { id: "status", type: "bar", title: "Where the containers are", subtitle: "Containers by status, click to filter", dimension: "stage", metric: containers(), sort: "order", colorBy: "status", orientation: "horizontal" },
    { id: "customers", type: "bar", title: "Customers", subtitle: "Containers by customer and status", dimension: "customer", metric: containers(), stackBy: "stage", colorBy: "status", orientation: "horizontal", topN: 10 },
    table({ id: "weakest", title: "Weakest margins", subtitle: "The six containers furthest below the price given to sales", columns: ["container", "customer", "country", "freight_cost", "sales_price", "margin", "remarks"], sort: { field: "margin", dir: "asc" }, filter: COSTED, limit: 6, pageSize: 6 }),
  ], grid: [
    { i: "insights", x: 0, y: 0, w: 12, h: 2, minH: 2 },
    { i: "kpi_containers", x: 0, y: 2, w: 2, h: 3 }, { i: "kpi_cost", x: 2, y: 2, w: 2, h: 3 }, { i: "kpi_price", x: 4, y: 2, w: 2, h: 3 },
    { i: "kpi_margin", x: 6, y: 2, w: 2, h: 3 }, { i: "kpi_delivered", x: 8, y: 2, w: 2, h: 3 }, { i: "kpi_late", x: 10, y: 2, w: 2, h: 3 },
    { i: "margin_country", x: 0, y: 5, w: 4, h: 8 }, { i: "cost_month", x: 4, y: 5, w: 8, h: 8 },
    { i: "status", x: 0, y: 13, w: 4, h: 6 }, { i: "customers", x: 4, y: 13, w: 8, h: 6 },
    { i: "weakest", x: 0, y: 19, w: 12, h: 8 },
  ] };

  const transit: Page = { id: "transit", title: "Shipments", widgets: [
    { id: "kpi_transit", type: "kpi", title: "In transit", metric: containers(IN_TRANSIT), good: "none", onClick: IN_TRANSIT, secondary: { metric: containers(PAST_ETA), label: "past their ETA, status not updated" } },
    { id: "kpi_due", type: "kpi", title: "Arriving in the next 7 days", metric: containers(DUE_7), good: "none", onClick: DUE_7 },
    { id: "kpi_transit_days", type: "kpi", title: "Average transit", metric: avg("transit_days", undefined, "days"), good: "down", secondary: { metric: { agg: "max", field: "transit_days", format: "days" }, label: "longest" } },
    { id: "kpi_late2", type: "kpi", title: "Arriving late", metric: containers(LATE), good: "down", onClick: LATE, secondary: { metric: { agg: "max", field: "delay_days", format: "days" }, label: "most late" } },
    table({ id: "in_transit", title: "In transit", subtitle: "By revised arrival; a negative day count means the ETA has passed", columns: ["container", "customer", "country", "pod", "vessel", "carrier", "ets", "revised_eta", "days_to_arrival", "delay_days"], filter: IN_TRANSIT, sort: { field: "revised_eta", dir: "asc" }, emphasisField: "delay_days", pageSize: 30 }),
    { id: "delay_band", type: "bar", title: "On time or late", subtitle: "Revised ETA against the planned ETA", dimension: "delay_band", metric: containers(), sort: "order", colorBy: "status", orientation: "horizontal" },
    { id: "transit_pod", type: "bar", title: "Transit time by port", subtitle: "Average days from sailing to the revised ETA", dimension: "pod", metric: avg("transit_days", undefined, "days"), sort: "value", colorBy: "single", orientation: "horizontal", share: false },
    { id: "carriers", type: "bar", title: "Shipping lines", subtitle: "Containers by line and status", dimension: "carrier", metric: containers(), stackBy: "stage", colorBy: "status", orientation: "horizontal" },
    { id: "loading", type: "bar", title: "Containers loaded", subtitle: "By month loaded", dimension: "month", metric: containers(), stackBy: "stage", sort: "date", colorBy: "status", orientation: "vertical" },
  ], grid: [
    { i: "kpi_transit", x: 0, y: 0, w: 3, h: 3 }, { i: "kpi_due", x: 3, y: 0, w: 3, h: 3 }, { i: "kpi_transit_days", x: 6, y: 0, w: 3, h: 3 }, { i: "kpi_late2", x: 9, y: 0, w: 3, h: 3 },
    { i: "in_transit", x: 0, y: 3, w: 12, h: 10 },
    { i: "delay_band", x: 0, y: 13, w: 4, h: 6 }, { i: "transit_pod", x: 4, y: 13, w: 4, h: 6 }, { i: "carriers", x: 8, y: 13, w: 4, h: 6 },
    { i: "loading", x: 0, y: 19, w: 12, h: 7 },
  ] };

  const costs: Page = { id: "costs", title: "Costs and margin", widgets: [
    { id: "kpi_ocean", type: "kpi", title: "Ocean freight", metric: sum("ocean_freight_cost"), good: "down", secondary: { metric: { agg: "ratio", field: "ocean_freight_cost", over: "freight_cost", format: "percent" }, label: "of freight cost" } },
    { id: "kpi_trucking", type: "kpi", title: "Trucking", metric: sum("trucking_cost"), good: "down", secondary: { metric: { agg: "ratio", field: "trucking_cost", over: "freight_cost", format: "percent" }, label: "of freight cost" } },
    { id: "kpi_clearance", type: "kpi", title: "Clearance", metric: sum("clearance_cost"), good: "down", secondary: { metric: { agg: "ratio", field: "clearance_cost", over: "freight_cost", format: "percent" }, label: "of freight cost" } },
    { id: "kpi_docs", type: "kpi", title: "Documentation and other", metric: sum("documentation_cost"), good: "down", secondary: { metric: sum("additional_cost"), label: "additional charges" } },
    { id: "cost_country", type: "bar", title: "Freight per container by destination", subtitle: "Average AED per container, CNF shipments (freight paid by us)", dimension: "country", metric: avg("freight_cost", CNF), sort: "value", colorBy: "single", orientation: "horizontal", share: false },
    { id: "margin_customer", type: "bar", title: "Margin by customer", subtitle: "AED, price given to sales minus freight cost", dimension: "customer", metric: sum("margin"), sort: "value", colorBy: "single", orientation: "horizontal", topN: 12, share: false },
    { id: "cost_carrier", type: "bar", title: "Freight cost by shipping line", subtitle: "AED", dimension: "carrier", metric: sum("freight_cost"), colorBy: "single", orientation: "horizontal" },
    { id: "clearing", type: "bar", title: "Clearing agents", subtitle: "Containers by agent", dimension: "clearing_agent", metric: containers(), colorBy: "categorical", orientation: "horizontal" },
    { id: "margin_mix", type: "bar", title: "Margin per container", subtitle: "Containers above, at or below the price given to sales", dimension: "margin_result", metric: containers(), sort: "order", colorBy: "status", orientation: "horizontal" },
    table({ id: "cost_lines", title: "Cost lines per container", subtitle: "Weakest margin first; click a column to sort", columns: ["container", "customer", "country", "incoterms", "freight_cost", "sales_price", "margin", "ocean_freight_cost", "trucking_cost", "clearance_cost", "documentation_cost", "additional_cost", "remarks"], sort: { field: "margin", dir: "asc" }, search: true, pageSize: 60 }),
  ], grid: [
    { i: "kpi_ocean", x: 0, y: 0, w: 3, h: 3 }, { i: "kpi_trucking", x: 3, y: 0, w: 3, h: 3 }, { i: "kpi_clearance", x: 6, y: 0, w: 3, h: 3 }, { i: "kpi_docs", x: 9, y: 0, w: 3, h: 3 },
    { i: "cost_country", x: 0, y: 3, w: 6, h: 7 }, { i: "margin_customer", x: 6, y: 3, w: 6, h: 7 },
    { i: "cost_carrier", x: 0, y: 10, w: 4, h: 6 }, { i: "clearing", x: 4, y: 10, w: 4, h: 6 }, { i: "margin_mix", x: 8, y: 10, w: 4, h: 6 },
    { i: "cost_lines", x: 0, y: 16, w: 12, h: 14 },
  ] };

  const docs: Page = { id: "documents", title: "Documents", widgets: [
    { id: "kpi_exit", type: "kpi", title: "Exit certificates received", metric: containers({ field: "exit_certificate", op: "eq", value: "Received" }), good: "up", secondary: { metric: containers({ field: "exit_certificate", op: "eq", value: "Not yet" }), label: "not yet" } },
    { id: "kpi_decl", type: "kpi", title: "Export declarations received", metric: containers({ field: "declaration_status", op: "eq", value: "Received" }), good: "up", secondary: { metric: containers({ field: "declaration_status", op: "eq", value: "Not received" }), label: "not received" } },
    { id: "exit_status", type: "bar", title: "Exit certificate", subtitle: "Containers by certificate status and shipment status", dimension: "exit_certificate", metric: containers(), stackBy: "stage", sort: "order", colorBy: "status", orientation: "horizontal" },
    table({ id: "missing_exit", title: "Delivered without an exit certificate", subtitle: "Containers that have arrived and still have no certificate on the sheet", columns: ["container", "customer", "country", "invoice", "ets", "revised_eta", "declaration_status", "exit_certificate"], filter: { and: [DELIVERED, { field: "exit_certificate", op: "eq", value: "Not yet" }] }, sort: { field: "ets", dir: "asc" }, pageSize: 30 }),
  ], grid: [
    { i: "kpi_exit", x: 0, y: 0, w: 6, h: 3 }, { i: "kpi_decl", x: 6, y: 0, w: 6, h: 3 },
    { i: "exit_status", x: 0, y: 3, w: 5, h: 7 }, { i: "missing_exit", x: 5, y: 3, w: 7, h: 7 },
  ] };

  const reconciliation: Page = { id: "reconciliation", title: "Reconciliation", widgets: [
    { id: "recon", type: "auxTable", title: "How the figures tie to the workbook", subtitle: "Every figure is counted from the container rows; the summary sheets are only compared", sheet: "reconciliation", columns: ["check", "report", "workbook", "note"], rowLabel: "checks", pageSize: 40 },
  ], grid: [{ i: "recon", x: 0, y: 0, w: 12, h: 24 }] };
  const register: Page = { id: "register", title: "Register", widgets: [
    table({ id: "register", title: "All containers", subtitle: "One row per container", columns: ["container", "customer", "product", "incoterms", "pol", "country", "pod", "carrier", "vessel", "loading_date", "ets", "revised_eta", "stage", "freight_cost", "sales_price", "margin", "shipment_value", "invoice", "exit_certificate"], sort: { field: "loading_date", dir: "desc" }, statusField: "stage", search: true, pageSize: 60 }),
  ], grid: [{ i: "register", x: 0, y: 0, w: 12, h: 18 }] };
  const quality: Page = { id: "quality", title: "Data quality", widgets: [{ id: "quality", type: "quality", title: "Data quality" }], grid: [{ i: "quality", x: 0, y: 0, w: 12, h: 16 }] };

  const filters: Layout["filters"] = [
    { kind: "daterange", field: "loading_date", label: "Loaded" },
    { kind: "select", field: "stage", label: "Status" },
    { kind: "select", field: "country", label: "Destination" },
    { kind: "select", field: "customer", label: "Customer" },
    { kind: "select", field: "carrier", label: "Shipping line" },
    { kind: "select", field: "incoterms", label: "Incoterms" },
    { kind: "search", field: "container", label: "Search" },
  ].filter((f) => has(f.field)) as Layout["filters"];
  return { version: 1, dateField: "loading_date", filters, pages: [overview, transit, costs, docs, reconciliation, register, quality] };
}

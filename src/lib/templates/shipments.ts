import type { Field, FilterExpr, SchemaMap } from "@/lib/schema/types";
import { normKey } from "@/lib/schema/types";
import type { Layout, Page, Widget } from "@/lib/dashboard/types";
import { CONTAINER_TYPES, COUNTRIES, MODES } from "./freight";

/**
 * Curated layout for an export shipment tracker: one row per shipment (usually one container) with status, ports,
 * dates, carrier and value. Reads both layouts of the Al Foah CNF & FOB sheet: the tracker we restructured
 * ("Shipment ref", "Status", "Value (USD)"…) and the team's own report ("S.No", "Shipment Status", "Shipment Value",
 * "Planned TT"…, header on row 2). Each field lists every header it goes by, so a new version in either layout matches
 * without the "columns changed" prompt.
 *
 * The status is typed freely in the team's report ("In-Transit", "On the Way to KCT", "Booked with CMA - not loaded"),
 * so it is kept as typed and folded into a short list. Transit and delay days are worked out from the dates: the
 * report's own formulas give -46,000 when Revised ETA is empty.
 */

export const SHIPMENT_STATUSES = ["Planned", "Booked", "Under loading", "To port", "Loaded", "In transit", "In port", "Waiting clearance", "Delivered", "Returned", "Cancelled"];
export const STAGES = ["Not shipped yet", "On the water", "Delivered", "Returned / cancelled"];

/** Folding the typed status: first rule whose words appear wins, so "no booked" is Planned before "booked" is Booked, and "not loaded" is Booked before "loaded" is Loaded. */
const STATUS_RULES: { value: string; match: string[] }[] = [
  { value: "Delivered", match: ["delivered"] },
  { value: "Returned", match: ["returned"] },
  { value: "Cancelled", match: ["cancel", "ceased", "cheased"] },
  { value: "Waiting clearance", match: ["destination clearance", "waiting clearance"] },
  { value: "In port", match: ["in port", "at port", "discharged"] },
  { value: "In transit", match: ["in transit", "in-transit", "intransit", "sailing", "sailed", "on board", "onboard"] },
  { value: "Planned", match: ["not booked", "no booked", "rate", "discussing", "planned", "plan"] },
  { value: "Booked", match: ["not loaded", "booked", "empty", "gate out"] },
  { value: "To port", match: ["on the way", "kct", "to port", "gate in"] },
  { value: "Under loading", match: ["under loading", "loading"] },
  { value: "Loaded", match: ["loaded"] },
];

/** Port and vendor spellings in the team's report, folded to the names the tracker used. */
const PORTS: Record<string, string> = {
  nhavasheva: "Nhava Sheva", "nhava sheva": "Nhava Sheva", "jakarta port": "Jakarta", pranagua: "Paranagua", paranagua: "Paranagua", "progreso, mexico": "Puerto Progreso",
  "puerto progreso": "Puerto Progreso", "dar es salaam": "Dar es Salaam", mogadishu: "Mogadishu", mombasa: "Mombasa", fiji: "Fiji", "khor al fakkan": "Khorfakkan", khorfakkan: "Khorfakkan", "al saad": "Al Saad",
};
const VENDORS: Record<string, string> = { "oman trans": "Oman Trans", "al sahaara": "Al Sahaara", hapag: "Hapag-Lloyd", "hapag lloyd": "Hapag-Lloyd", "al gharbeya": "Al Gharbeya" };

type Spec = { headers: string[]; field: Omit<Field, "source" | "label"> & { label?: string } };
const dim = (id: string, extra: Partial<Field> = {}): Spec["field"] => ({ id, type: "string", role: "dimension", ...extra });
const text = (id: string, extra: Partial<Field> = {}): Spec["field"] => ({ id, type: "string", role: "text", ...extra });
const date = (id: string, extra: Partial<Field> = {}): Spec["field"] => ({ id, type: "date", role: "date", format: "date", ...extra });
const num = (id: string, extra: Partial<Field> = {}): Spec["field"] => ({ id, type: "number", role: "measure", format: "integer", ...extra });
/** Not read; optional, so a version without the column never asks about it. */
const ignore = (id: string): Spec["field"] => ({ id, type: "string", role: "ignore", optional: true });

/** Every column of either layout. The first header is the tracker's, the others are what the team's report calls it. */
const SPECS: Spec[] = [
  // The tracker's own reference (AF-0001…): replaced by the shipment key below, which both layouts can build.
  { headers: ["Shipment ref", "Shipment reference"], field: ignore("shipment_ref") },
  { headers: ["S.No", "S No", "Sl No", "Sr No"], field: ignore("serial_no") },
  { headers: ["Sales person", "Salesperson"], field: dim("sales_person", { label: "Sales person", semantic: "owner" }) },
  { headers: ["Customer code"], field: dim("customer_code", { semantic: "customer" }) },
  { headers: ["Customer name", "Customer"], field: dim("customer_name", { label: "Customer", semantic: "customer" }) },
  { headers: ["Incoterm", "Incoterms", "Inco terms"], field: dim("incoterm", { valueMap: { cnf: "CNF", cfr: "CNF", "c&f": "CNF", fob: "FOB", cif: "CIF", exw: "EXW" } }) },
  { headers: ["Booking number", "Booking no"], field: text("booking_number") },
  { headers: ["BL number", "B/L number", "BL no"], field: text("bl_number") },
  { headers: ["Container number", "Container no"], field: text("container_number") },
  { headers: ["Container type"], field: dim("container_type", { valueMap: CONTAINER_TYPES }) },
  { headers: ["Vessel", "Vessel name"], field: text("vessel") },
  { headers: ["Carrier", "Shipping line"], field: dim("carrier", { valueMap: VENDORS }) },
  { headers: ["Transporter", "Transport"], field: dim("transporter", { valueMap: VENDORS }) },
  { headers: ["Clearance agent", "Clearance", "Clearing agent"], field: dim("clearance_agent", { valueMap: VENDORS }) },
  { headers: ["SKU"], field: dim("sku") },
  { headers: ["Product", "Product name"], field: text("product") },
  { headers: ["POL country"], field: dim("pol_country", { semantic: "origin", valueMap: COUNTRIES }) },
  { headers: ["POL", "Port of loading"], field: dim("pol", { label: "Loading port", semantic: "origin", valueMap: PORTS }) },
  { headers: ["Final POL", "FPOL"], field: dim("final_pol", { semantic: "origin", valueMap: PORTS }) },
  { headers: ["POD country", "Destination country"], field: dim("pod_country", { label: "Destination country", semantic: "destination", valueMap: COUNTRIES }) },
  { headers: ["POD", "Port of discharge"], field: dim("pod", { label: "Destination port", semantic: "destination", valueMap: PORTS }) },
  { headers: ["Loading location"], field: dim("loading_location", { valueMap: PORTS }) },
  { headers: ["Loading date"], field: date("loading_date") },
  { headers: ["Cut-off date", "Cut off", "Cutoff"], field: date("cut_off_date", { label: "Cut-off date" }) },
  { headers: ["ETS", "ETD"], field: date("ets") },
  { headers: ["ETA"], field: date("eta") },
  { headers: ["Revised ETA"], field: date("revised_eta") },
  { headers: ["Status", "Shipment status"], field: text("status_text", { label: "Status as typed" }) },
  { headers: ["Remarks", "Remark"], field: text("remarks", { semantic: "remarks", optional: true }) },
  { headers: ["Document", "SWB/OBL", "SWB / OBL"], field: dim("document") },
  { headers: ["Mode", "Mode of TPT", "Mode of transport"], field: dim("mode", { semantic: "mode", valueMap: MODES }) },
  { headers: ["Free days at POL", "FT POL"], field: num("free_days_at_pol") },
  { headers: ["Free days at POD", "FT POD"], field: num("free_days_at_pod") },
  { headers: ["Containers", "Total container", "Total containers"], field: num("containers", { semantic: "quantity" }) },
  { headers: ["Packages", "Total package", "Total packages"], field: num("packages") },
  { headers: ["Ton/Kg"], field: ignore("weight_unit") },
  { headers: ["Weight (tons)", "Total weight"], field: num("weight_tons", { label: "Weight (tons)", format: "decimal", semantic: "quantity" }) },
  { headers: ["Value (USD)", "Shipment value"], field: num("value_usd", { label: "Value (USD)", semantic: "amount", format: "currency", currency: "USD" }) },
  { headers: ["Invoice number", "Invoice no"], field: text("invoice_number") },
  { headers: ["Invoice date"], field: date("invoice_date") },
  // The sheet's own day counts: worked out from the dates instead (below).
  { headers: ["Planned transit days", "Planned TT"], field: ignore("sheet_planned_transit") },
  { headers: ["Revised transit days", "Revised TT"], field: ignore("sheet_revised_transit") },
  { headers: ["Delay days"], field: ignore("sheet_delay_days") },
];
const specFor = (header: string) => { const k = normKey(header); return SPECS.find((s) => s.headers.some((h) => normKey(h) === k)); };

export function matchesShipments(headers: string[]): boolean {
  const ids = new Set(headers.map((h) => specFor(h)?.field.id));
  return ["status_text", "container_number", "eta", "pod_country", "loading_date", "carrier", "value_usd"].every((id) => ids.has(id));
}

const status = (...values: string[]): FilterExpr => (values.length === 1 ? { field: "status", op: "eq", value: values[0] } : { field: "status", op: "in", value: values });

export function shipmentsSchema(inferred: SchemaMap): SchemaMap {
  const fields: Field[] = [];
  const taken = new Set<string>();
  for (const f of inferred.fields) {
    if (f.derived) continue;
    const spec = f.source ? specFor(f.source) : undefined;
    if (!spec || taken.has(spec.field.id)) { fields.push({ ...f, role: f.role === "id" ? "text" : f.role, hidden: true }); continue; }
    taken.add(spec.field.id);
    const aliases = spec.headers.filter((h) => normKey(h) !== normKey(f.source!));
    // Labels stay the tracker's tidy names whichever layout the sheet uses.
    fields.push({ ...spec.field, label: spec.field.label ?? spec.headers[0], source: f.source, ...(aliases.length ? { aliases } : {}) });
  }
  // Columns only the other layout has: known, so a version in that layout matches too, and optional, so their absence never asks.
  for (const spec of SPECS) {
    if (taken.has(spec.field.id)) continue;
    const [source, ...aliases] = spec.headers;
    fields.push({ ...spec.field, label: spec.field.label ?? source, source, ...(aliases.length ? { aliases } : {}), optional: true });
  }

  fields.push(
    // Container number when it is one (four letters, seven digits), else the invoice or booking: survives rows being inserted.
    { id: "shipment", label: "Shipment", source: null, type: "string", role: "id", derived: { kind: "rowKey", candidates: [
      { field: "container_number", pattern: "^[A-Z]{4}\\d{7}$" }, { field: "invoice_number", prefix: "Invoice " }, { field: "booking_number", prefix: "Booking " },
    ] } },
    { id: "status", label: "Status", source: null, type: "string", role: "dimension", semantic: "status", order: SHIPMENT_STATUSES,
      derived: { kind: "keyword", from: ["status_text"], rules: STATUS_RULES, fallback: null } },
    // A revised ETA before the sailing date cannot be right: the planned ETA stands until it is corrected.
    { id: "revised_lead_days", label: "Revised ETA after sailing (days)", source: null, type: "number", role: "measure", format: "days", hidden: true, derived: { kind: "diffDays", from: "ets", to: "revised_eta" } },
    { id: "revised_eta_used", label: "Revised ETA (checked)", source: null, type: "date", role: "date", format: "date", hidden: true, derived: { kind: "case", cases: [
      { when: { field: "revised_lead_days", op: "gte", value: 0 }, from: "revised_eta" },
      { when: { and: [{ field: "ets", op: "isNull" }, { field: "revised_eta", op: "notNull" }] }, from: "revised_eta" },
    ], fallback: null } },
    { id: "arrival", label: "Expected arrival", source: null, type: "date", role: "date", format: "date", derived: { kind: "coalesce", fields: ["revised_eta_used", "eta"] } },
    { id: "days_to_sailing", label: "Days to sailing", source: null, type: "number", role: "measure", format: "days", hidden: true, derived: { kind: "daysUntil", from: "ets" } },
    { id: "days_to_arrival", label: "Days to arrival", source: null, type: "number", role: "measure", format: "days", derived: { kind: "daysUntil", from: "arrival" } },
    { id: "planned_transit_days", label: "Planned transit days", source: null, type: "number", role: "measure", format: "days", derived: { kind: "diffDays", from: "ets", to: "eta" } },
    { id: "revised_transit_days", label: "Revised transit days", source: null, type: "number", role: "measure", format: "days", derived: { kind: "diffDays", from: "ets", to: "arrival" } },
    { id: "delay_days", label: "Delay (days)", source: null, type: "number", role: "measure", format: "days", derived: { kind: "diffDays", from: "eta", to: "arrival" } },
    { id: "stage", label: "Stage", source: null, type: "string", role: "dimension", semantic: "status", order: STAGES, derived: { kind: "case", cases: [
      { when: status("Delivered"), value: "Delivered" },
      { when: status("Returned", "Cancelled"), value: "Returned / cancelled" },
      { when: status("In transit", "In port", "Waiting clearance"), value: "On the water" },
      // Loaded and past its sailing date: on the water even if the status was not moved on.
      { when: { and: [status("Loaded"), { field: "days_to_sailing", op: "lte", value: 0 }] }, value: "On the water" },
    ], fallback: "Not shipped yet" } },
    { id: "delay_band", label: "Delay band", source: null, type: "string", role: "dimension", order: ["On time / early", "1–7 days late", "8–14 days late", "15+ days late"],
      derived: { kind: "bucket", from: "delay_days", edges: [1, 8, 15], labels: ["On time / early", "1–7 days late", "8–14 days late", "15+ days late"] } },
    { id: "month_loaded", label: "Month loaded", source: null, type: "date", role: "date", format: "date", semantic: "period", derived: { kind: "period", from: "loading_date", unit: "month" } },
  );
  return { ...inferred, fields, idField: "shipment", primaryDate: "loading_date", foldCase: true, dateChain: ["loading_date", "cut_off_date", "ets", "eta"] };
}

const onWater: FilterExpr = { field: "stage", op: "eq", value: "On the water" };
const delivered: FilterExpr = { field: "stage", op: "eq", value: "Delivered" };
const dueSoon: FilterExpr = { and: [onWater, { field: "days_to_arrival", op: "between", value: [0, 30] }] };
const overdue: FilterExpr = { and: [onWater, { field: "days_to_arrival", op: "lt", value: 0 }] };
const usd = (filter?: FilterExpr) => ({ agg: "sum" as const, field: "value_usd", format: "currency" as const, currency: "USD", ...(filter ? { filter } : {}) });

export function shipmentsLayout(schema: SchemaMap): Layout {
  const has = (id: string) => schema.fields.some((f) => f.id === id);
  const overviewWidgets: Widget[] = [
    { id: "insights", type: "insights", title: "What changed since the last update" },
    { id: "kpi_shipments", type: "kpi", title: "Shipments", metric: { agg: "count" }, good: "up", sparkline: { dateField: "loading_date", unit: "month" } },
    { id: "kpi_containers", type: "kpi", title: "Containers", metric: { agg: "sum", field: "containers", format: "integer" }, good: "up", secondary: { metric: { agg: "sum", field: "weight_tons", format: "decimal" }, label: "tons" } },
    { id: "kpi_value", type: "kpi", title: "Value shipped", metric: usd(), good: "up" },
    { id: "kpi_water", type: "kpi", title: "On the water", metric: { agg: "count", filter: onWater }, good: "none", onClick: onWater, secondary: { metric: usd(onWater), label: "in transit" } },
    { id: "kpi_delivered", type: "kpi", title: "Delivered", metric: { agg: "count", filter: delivered }, good: "up", onClick: delivered, secondary: { metric: { agg: "rate", numerator: delivered, format: "percent" }, label: "of all shipments" } },
    { id: "kpi_overdue", type: "kpi", title: "Past arrival date", metric: { agg: "count", filter: overdue }, good: "down", onClick: overdue, secondary: { metric: { agg: "avg", field: "delay_days", format: "days", filter: onWater }, label: "avg delay" } },
    { id: "pipeline", type: "bar", title: "Where every shipment stands", subtitle: "Shipments by stage, click to filter", dimension: "stage", metric: { agg: "count" }, sort: "order", colorBy: "status", orientation: "horizontal" },
    { id: "monthly", type: "line", title: "Monthly shipments", subtitle: "Value shipped and number of shipments, by loading month", dateField: "loading_date", unit: "month", series: [
      { label: "Value (USD)", metric: usd(), kind: "bar" }, { label: "Shipments", metric: { agg: "count" }, kind: "line" },
    ] },
    { id: "destinations", type: "bar", title: "Destinations", subtitle: "Value by destination country", dimension: "pod_country", metric: usd(), stackBy: "stage", colorBy: "status", orientation: "horizontal", topN: 8 },
    { id: "carriers", type: "bar", title: "Carriers", subtitle: "Containers by carrier", dimension: "carrier", metric: { agg: "sum", field: "containers", format: "integer" }, stackBy: "stage", colorBy: "status", orientation: "horizontal", topN: 8 },
    { id: "customers", type: "bar", title: "Customers", subtitle: "Value by customer", dimension: "customer_name", metric: usd(), orientation: "horizontal", topN: 8 },
    { id: "sales", type: "bar", title: "Sales people", subtitle: "Value by sales person", dimension: "sales_person", metric: usd(), stackBy: "stage", colorBy: "status", orientation: "horizontal" },
  ];
  const overview: Page = { id: "overview", title: "Overview", widgets: overviewWidgets, grid: [
    { i: "insights", x: 0, y: 0, w: 12, h: 2, minH: 2 },
    { i: "kpi_shipments", x: 0, y: 2, w: 2, h: 3 }, { i: "kpi_containers", x: 2, y: 2, w: 2, h: 3 }, { i: "kpi_value", x: 4, y: 2, w: 2, h: 3 },
    { i: "kpi_water", x: 6, y: 2, w: 2, h: 3 }, { i: "kpi_delivered", x: 8, y: 2, w: 2, h: 3 }, { i: "kpi_overdue", x: 10, y: 2, w: 2, h: 3 },
    { i: "pipeline", x: 0, y: 5, w: 4, h: 7 }, { i: "monthly", x: 4, y: 5, w: 8, h: 7 },
    { i: "destinations", x: 0, y: 12, w: 4, h: 7 }, { i: "carriers", x: 4, y: 12, w: 4, h: 7 }, { i: "customers", x: 8, y: 12, w: 4, h: 7 },
    { i: "sales", x: 0, y: 19, w: 12, h: 5 },
  ] };

  const arrivalCols = ["shipment", "customer_name", "pod_country", "carrier", "arrival", "days_to_arrival", "delay_days", "status"].filter(has);
  const arrivals: Page = { id: "arrivals", title: "Arrivals and delays", widgets: [
    { id: "due", type: "table", title: "Arriving in the next 30 days", subtitle: "On the water, by expected arrival (revised ETA, else ETA)", columns: arrivalCols, filter: dueSoon, sort: { field: "arrival", dir: "asc" }, statusField: "status", emphasisField: "delay_days", pageSize: 15 },
    { id: "late", type: "table", title: "Past their arrival date", subtitle: "Still on the water after the expected arrival", columns: arrivalCols, filter: overdue, sort: { field: "days_to_arrival", dir: "asc" }, statusField: "status", emphasisField: "delay_days", pageSize: 15 },
    { id: "delay_dots", type: "dots", title: "Delay by shipment", subtitle: "Revised ETA against planned ETA, one dot per shipment; left of the line is early", valueField: "delay_days", labelField: "shipment", colorField: "stage", target: 0, targetLabel: "On time", format: "days" },
    { id: "delay_bands", type: "bar", title: "How late", subtitle: "Containers by delay band", dimension: "delay_band", metric: { agg: "sum", field: "containers", format: "integer" }, orientation: "horizontal", sort: "order", colorBy: "single" },
    { id: "carrier_delay", type: "bar", title: "Average delay by carrier", subtitle: "Days, revised ETA against planned", dimension: "carrier", metric: { agg: "avg", field: "delay_days", format: "days" }, orientation: "horizontal", topN: 8, colorBy: "single" },
    { id: "transit", type: "heatmap", title: "Average transit days", subtitle: "Destination country by carrier", rowDim: "pod_country", colDim: "carrier", metric: { agg: "avg", field: "revised_transit_days", format: "days" } },
  ], grid: [
    { i: "due", x: 0, y: 0, w: 12, h: 8 }, { i: "late", x: 0, y: 8, w: 12, h: 6 },
    { i: "delay_dots", x: 0, y: 14, w: 7, h: 7 }, { i: "delay_bands", x: 7, y: 14, w: 5, h: 7 },
    { i: "carrier_delay", x: 0, y: 21, w: 5, h: 7 }, { i: "transit", x: 5, y: 21, w: 7, h: 7 },
  ] };

  const registerCols = ["shipment", "customer_name", "product", "container_type", "carrier", "vessel", "pol", "pod_country", "pod", "loading_date", "ets", "eta", "revised_eta", "status", "status_text", "containers", "value_usd", "invoice_number"].filter(has);
  const register: Page = { id: "register", title: "Register", widgets: [
    { id: "register", type: "table", title: "All shipments", columns: registerCols, sort: { field: "loading_date", dir: "desc" }, statusField: "status", search: true, pageSize: 50 },
  ], grid: [{ i: "register", x: 0, y: 0, w: 12, h: 18 }] };
  const quality: Page = { id: "quality", title: "Data quality", widgets: [{ id: "quality", type: "quality", title: "Data quality" }], grid: [{ i: "quality", x: 0, y: 0, w: 12, h: 16 }] };

  const filters: Layout["filters"] = [
    { kind: "daterange", field: "loading_date", label: "Loaded" },
    { kind: "select", field: "stage", label: "Stage" },
    { kind: "select", field: "status", label: "Status" },
    { kind: "select", field: "pod_country", label: "Destination" },
    { kind: "select", field: "carrier", label: "Carrier" },
    { kind: "select", field: "sales_person", label: "Sales person" },
    { kind: "select", field: "customer_name", label: "Customer" },
    { kind: "search", field: "product", label: "Search" },
  ].filter((f) => has(f.field)) as Layout["filters"];
  return { version: 1, dateField: "loading_date", filters, pages: [overview, arrivals, register, quality] };
}

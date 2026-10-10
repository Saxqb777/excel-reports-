import type { Field, FilterExpr, SchemaMap } from "@/lib/schema/types";
import { normKey } from "@/lib/schema/types";
import type { Layout, Page, Widget } from "@/lib/dashboard/types";
import type { MetricSpec } from "@/lib/engine/metrics";

/**
 * Curated layout for an export container tracker: one row per container line (a container carrying several products is
 * split into "ABCD1234567", "ABCD1234567-1", "ABCD1234567-2"), with the sales order, product, vessel, loading and sailing
 * dates, a status and a Done/Pending checklist of export documents. Everything the viewer sees counts physical containers,
 * never split lines. Matched by headers (the Bait Al Tamour tracker); works for any sheet using the same column names.
 */

/** Export documents tracked per container, each a Done / Pending column in the sheet. */
const DOCS: { id: string; label: string; headers: string[] }[] = [
  { id: "doc_manifest", label: "Manifest", headers: ["manifest update", "manifest"] },
  { id: "doc_invoice", label: "Invoice", headers: ["invoice", "commercial invoice"] },
  { id: "doc_packing_list", label: "Packing list", headers: ["packing list"] },
  { id: "doc_fumigation", label: "Fumigation", headers: ["fumigation", "fumigation certificate"] },
  { id: "doc_coo", label: "Certificate of origin", headers: ["coo", "certificate of origin"] },
  { id: "doc_phyto", label: "Phytosanitary", headers: ["phyto sanitary", "phytosanitary", "phyto"] },
  { id: "doc_boe", label: "Customs BOE", headers: ["boe", "bill of entry", "bill of export"] },
  { id: "doc_exit", label: "Exit certificate", headers: ["exit certificate", "exit cert"] },
  { id: "doc_si", label: "Shipping instruction", headers: ["si", "shipping instruction", "shipping instructions"] },
  { id: "doc_bl", label: "B/L issued", headers: ["bl", "b/l", "bill of lading"] },
];
const DOC_DONE = ["Done", "Yes", "Completed", "Complete", "OK", "Received", "Issued"];
const DOC_VALUE_MAP: Record<string, string> = { yes: "Done", ok: "Done", completed: "Done", complete: "Done", received: "Done", issued: "Done", y: "Done", no: "Pending", n: "Pending", "not yet": "Pending", "in progress": "Pending", "under preparation": "Pending", pending: "Pending", "-": "Pending" };

/** The sheet's own status vocabulary (its "Lisit" sheet), in process order. */
export const CONTAINER_STATUSES = [
  "Planned", "Gate Out", "On the Way Loading", "Waiting for Loading", "Under Loading",
  "On the way to Sajja", "Staging in Sajja", "On the Way to KCT", "Under Clearance", "Gate In KCT",
  "Container Onboarded in Vessel", "Sailing", "Arrived", "Delivered",
];
const STATUS_VALUE_MAP: Record<string, string> = {
  "stagging in sajja": "Staging in Sajja", "container in sajja": "Staging in Sajja", "in sajja": "Staging in Sajja",
  "on the way to port": "On the Way to KCT", "to port": "On the Way to KCT", "on the way to kct": "On the Way to KCT",
  "in kct": "Gate In KCT", "gate in": "Gate In KCT", "in port": "Gate In KCT",
  "onboarded": "Container Onboarded in Vessel", "on board": "Container Onboarded in Vessel", "loaded on vessel": "Container Onboarded in Vessel",
  "sailed": "Sailing", "in transit": "Sailing",
  "discharged": "Arrived", "reached": "Arrived",
};
export const STAGES = ["Planned", "Loading", "To port", "At port", "On vessel", "Arrived"];

/** ERP item descriptions folded into customer-facing product names. Unknown descriptions show as typed. */
const PRODUCT_NAMES: Record<string, string> = {
  "dc fardh pch 500gm*16 india": "Fardh 500 g pouch × 16",
  "dc fardh pch 250gm*20 india": "Fardh 250 g pouch × 20",
  "dc khenzi pch 500gm*16 ind": "Khenaizi 500 g pouch × 16",
  "dc khenzi pch 500gm*16 ind 18m": "Khenaizi 500 g pouch × 16 (18 months)",
  "dc khenaizi retail t/b box 5kg": "Khenaizi 5 kg box",
  "dc khenaizi retail t/b box": "Khenaizi 5 kg box",
  "dc bouman thrmo 500gm*16 in": "Bouman 500 g thermo × 16",
  "dc bouman thrmo 500gm*16 ind": "Bouman 500 g thermo × 16",
  "dc neghal t/b box 5kg": "Neghal 5 kg box",
  "emirates deluxe fardh 500gx16": "Emirates Deluxe Fardh 500 g × 16",
  "emirates deluxe fardh 500gx14": "Emirates Deluxe Fardh 500 g × 14",
  "emirates premium 10x800g-ind": "Emirates Premium 800 g × 10",
  "emirates premium 10x800g-in": "Emirates Premium 800 g × 10",
  "barhi thrmo 500gm*16 ind": "Barhi 500 g thermo × 16",
  "dc khlas tub 750gm*12 india": "Khalas 750 g tub × 12",
};

const CURRENCY = "AED";
type Spec = { headers: string[]; patch: Partial<Field> & { id: string } };
const money = (id: string, label: string, aggregate?: Field["aggregate"]): Partial<Field> & { id: string } => ({ id, label, type: "number", role: "measure", semantic: "amount", format: "currency", currency: CURRENCY, ...(aggregate ? { aggregate } : {}) });
const SPECS: Spec[] = [
  { headers: ["s.no", "s no", "sl no", "sr no", "#"], patch: { id: "s_no", role: "ignore" } },
  { headers: ["so order number", "so number", "sales order", "sales order number"], patch: { id: "sales_order", label: "Sales order", type: "string", role: "dimension" } },
  { headers: ["erp order status"], patch: { id: "erp_status", label: "ERP status", type: "string", role: "dimension", hidden: true } },
  { headers: ["stock ready date"], patch: { id: "stock_ready_date", label: "Stock ready", type: "date", role: "date", format: "date" } },
  { headers: ["sku", "item code"], patch: { id: "sku", label: "SKU", type: "string", role: "dimension" } },
  { headers: ["sku description", "item description", "product"], patch: { id: "product", label: "Product", type: "string", role: "dimension", semantic: "description", valueMap: PRODUCT_NAMES } },
  { headers: ["order qty", "qty", "quantity", "cartons"], patch: { id: "cartons", label: "Cartons", type: "number", role: "measure", semantic: "quantity", format: "integer" } },
  { headers: ["net weight ( mt )", "net weight (mt)", "net weight mt", "net weight"], patch: { id: "net_weight_mt", label: "Net weight (MT)", type: "number", role: "measure", semantic: "quantity", format: "decimal" } },
  { headers: ["gross weight (mt)", "gross weight ( mt )", "gross weight mt", "gross weight"], patch: { id: "gross_weight_mt", label: "Gross weight (MT)", type: "number", role: "measure", semantic: "quantity", format: "decimal" } },
  { headers: ["per ton cost", "price per ton", "rate per mt"], patch: money("price_per_mt", `Price per MT (${CURRENCY})`, "avg") },
  { headers: ["material cost", "goods value"], patch: money("material_value", `Goods value (${CURRENCY})`) },
  { headers: ["loading charge", "loading charges"], patch: money("loading_charge", `Loading charge (${CURRENCY})`) },
  { headers: ["actual erp invoice", "invoice value", "invoice amount"], patch: money("invoice_value", `Invoice value (${CURRENCY})`) },
  { headers: ["per carton", "price per carton"], patch: money("price_per_carton", `Price per carton (${CURRENCY})`, "avg") },
  { headers: ["erp invoice"], patch: { id: "erp_invoice", label: "ERP invoice", type: "string", role: "text", hidden: true } },
  { headers: ["manual inv number", "invoice number", "invoice no"], patch: { id: "invoice_number", label: "Invoice no.", type: "string", role: "text" } },
  { headers: ["dpw booking number", "dp world booking"], patch: { id: "dpw_booking", label: "DP World booking", type: "string", role: "text", hidden: true } },
  { headers: ["gt line booking number", "line booking number", "carrier booking", "booking number"], patch: { id: "line_booking", label: "Line booking", type: "string", role: "text", hidden: true } },
  { headers: ["job reference number", "job reference", "job ref"], patch: { id: "job_ref", label: "Job reference", type: "string", role: "text", hidden: true } },
  { headers: ["b/l number", "bl number", "bill of lading number"], patch: { id: "bl_number", label: "Bill of lading", type: "string", role: "text" } },
  { headers: ["b/l date", "bl date"], patch: { id: "bl_date", label: "B/L date", type: "date", role: "date", format: "date" } },
  { headers: ["container number", "container no", "container"], patch: { id: "container_number", label: "Container", type: "string", role: "id" } },
  { headers: ["container type", "size"], patch: { id: "container_type", label: "Container type", type: "string", role: "dimension" } },
  { headers: ["pol", "port of loading"], patch: { id: "pol", label: "Port of loading", type: "string", role: "dimension", semantic: "origin" } },
  { headers: ["pod", "port of discharge"], patch: { id: "pod", label: "Port of discharge", type: "string", role: "dimension", semantic: "destination" } },
  { headers: ["seal number", "seal no"], patch: { id: "seal_number", label: "Seal", type: "string", role: "text", hidden: true } },
  { headers: ["transporter", "trucking company", "haulier"], patch: { id: "transporter", label: "Transporter", type: "string", role: "dimension", hidden: true } },
  { headers: ["truck number", "truck no"], patch: { id: "truck_number", role: "ignore" } },
  { headers: ["driver name", "driver"], patch: { id: "driver_name", role: "ignore" } },
  { headers: ["driver mobile number", "driver mobile", "driver phone"], patch: { id: "driver_mobile", role: "ignore" } },
  { headers: ["loading date", "loaded on", "stuffing date"], patch: { id: "loading_date", label: "Loaded", type: "date", role: "date", format: "date" } },
  { headers: ["loading place", "loading location"], patch: { id: "loading_place", label: "Loading place", type: "string", role: "dimension", hidden: true } },
  { headers: ["empty pickup location", "empty pickup"], patch: { id: "empty_pickup", label: "Empty pickup", type: "string", role: "dimension", hidden: true } },
  { headers: ["al saad gate out", "factory gate out", "gate out"], patch: { id: "factory_gate_out", label: "Factory gate out", type: "date", role: "date", format: "date", hidden: true } },
  { headers: ["sajja gate in", "depot gate in"], patch: { id: "depot_gate_in", role: "ignore" } },
  { headers: ["sajja gate out", "depot gate out"], patch: { id: "depot_gate_out", role: "ignore" } },
  { headers: ["shipping line", "carrier", "line"], patch: { id: "shipping_line", label: "Shipping line", type: "string", role: "dimension" } },
  { headers: ["vessel name", "vessel", "vessel / voyage"], patch: { id: "vessel", label: "Vessel", type: "string", role: "dimension" } },
  { headers: ["imo"], patch: { id: "imo", label: "IMO", type: "string", role: "text", hidden: true } },
  { headers: ["cut off", "cut-off", "cutoff"], patch: { id: "cut_off", label: "Cut-off", type: "date", role: "date", format: "date" } },
  { headers: ["kct gate open", "gate open"], patch: { id: "gate_open", label: "Gate open", type: "date", role: "date", format: "date", hidden: true } },
  { headers: ["kct gate in", "port gate in", "gate in"], patch: { id: "gate_in", label: "Gate in at port", type: "date", role: "date", format: "date" } },
  { headers: ["kct gate close", "gate close"], patch: { id: "gate_close", label: "Gate close", type: "date", role: "date", format: "date", hidden: true } },
  { headers: ["ets", "etd", "sailing date"], patch: { id: "ets", label: "Sailing (ETS)", type: "date", role: "date", format: "date" } },
  { headers: ["eta", "arrival date"], patch: { id: "eta", label: "Arrival (ETA)", type: "date", role: "date", format: "date" } },
  { headers: ["ed update", "export declaration", "ed number"], patch: { id: "export_declaration", label: "Export declaration", type: "string", role: "text", hidden: true } },
  { headers: ["current status", "status"], patch: { id: "status", label: "Status", type: "string", role: "dimension", semantic: "status", allowedValues: CONTAINER_STATUSES, order: CONTAINER_STATUSES, valueMap: STATUS_VALUE_MAP } },
  ...DOCS.map((d): Spec => ({ headers: d.headers, patch: { id: d.id, label: d.label, type: "string", role: "dimension", allowedValues: ["Done", "Pending"], order: ["Done", "Pending"], valueMap: DOC_VALUE_MAP, hidden: true } })),
];

const specFor = (header: string): Spec | undefined => { const k = normKey(header); return SPECS.find((s) => s.headers.includes(k)); };

export function matchesContainers(headers: string[]): boolean {
  const ids = new Set(headers.map((h) => specFor(h)?.patch.id).filter(Boolean));
  const docs = DOCS.filter((d) => ids.has(d.id)).length;
  return ["container_number", "status", "vessel", "eta", "loading_date"].every((id) => ids.has(id)) && docs >= 3;
}

/** Dates in the order they happen for one container; a typed date out of this order is probably day/month swapped. */
const DATE_CHAIN = ["stock_ready_date", "loading_date", "factory_gate_out", "gate_in", "cut_off", "ets", "eta"];

export function containersSchema(inferred: SchemaMap): SchemaMap {
  const fields: Field[] = [];
  const taken = new Set<string>();
  for (const f of inferred.fields) {
    if (f.derived) continue;
    const spec = f.source ? specFor(f.source) : undefined;
    if (!spec || taken.has(spec.patch.id)) { fields.push({ ...f, role: f.role === "id" ? "text" : f.role }); continue; }
    taken.add(spec.patch.id);
    const { id, ...patch } = spec.patch;
    const base: Field = { id, label: f.label, source: f.source, type: f.type, role: f.role };
    // Inferred value maps fold case variants; the template's map takes precedence where it speaks.
    const valueMap = patch.valueMap || f.valueMap ? { ...(f.valueMap ?? {}), ...(patch.valueMap ?? {}) } : undefined;
    fields.push({ ...base, ...patch, ...(valueMap ? { valueMap } : {}), ...(f.aliases ? { aliases: f.aliases } : {}) });
  }
  const has = (id: string) => fields.some((f) => f.id === id);
  const docIds = DOCS.map((d) => d.id).filter(has);
  fields.push(
    // One physical container can be split into several lines ("-1", "-2"): this is the key everything counts by.
    { id: "container_id", label: "Container (physical)", source: null, type: "string", role: "text", hidden: true, derived: { kind: "baseRef", from: "container_number" } },
    { id: "stage", label: "Stage", source: null, type: "string", role: "dimension", semantic: "status", order: STAGES,
      derived: { kind: "keyword", from: ["status"], rules: [
        { value: "Arrived", match: ["arrived", "delivered", "discharged", "reached"] },
        { value: "On vessel", match: ["onboarded", "on board", "sailing", "sailed", "departed", "in transit"] },
        { value: "At port", match: ["gate in kct", "under clearance", "in kct", "at port", "in port", "gate in"] },
        { value: "To port", match: ["sajja", "to kct", "to port", "staging", "stagging", "depot", "yard"] },
        { value: "Planned", match: ["planned", "gate out", "on the way loading", "waiting for loading", "not started"] },
        { value: "Loading", match: ["loading", "stuffing", "factory"] },
      ], fallback: null } },
  );
  if (has("eta")) fields.push({ id: "days_to_arrival", label: "Days to arrival", source: null, type: "number", role: "measure", format: "days", aggregate: "min", derived: { kind: "daysUntil", from: "eta" } });
  if (has("loading_date") && has("ets")) fields.push({ id: "loading_to_sailing_days", label: "Loading to sailing (days)", source: null, type: "number", role: "measure", format: "days", aggregate: "max", derived: { kind: "diffDays", from: "loading_date", to: "ets" } });
  if (has("ets") && has("eta")) fields.push({ id: "transit_days", label: "Transit (days)", source: null, type: "number", role: "measure", format: "days", aggregate: "max", derived: { kind: "diffDays", from: "ets", to: "eta" } });
  if (docIds.length) {
    fields.push(
      { id: "docs_pending", label: "Documents pending", source: null, type: "number", role: "measure", format: "integer", aggregate: "max", derived: { kind: "pendingCount", fields: docIds, done: DOC_DONE } },
      { id: "docs_pending_list", label: "Pending documents", source: null, type: "string", role: "text", derived: { kind: "pendingList", fields: docIds, done: DOC_DONE } },
      { id: "docs_status", label: "Documents", source: null, type: "string", role: "dimension", semantic: "status", order: ["Complete", "Pending"], derived: { kind: "bucket", from: "docs_pending", edges: [1], labels: ["Complete", "Pending"] } },
    );
  }
  return { ...inferred, fields, idField: has("container_number") ? "container_number" : inferred.idField, primaryDate: has("loading_date") ? "loading_date" : inferred.primaryDate, dateChain: DATE_CHAIN.filter(has) };
}

const onVessel: FilterExpr = { field: "stage", op: "eq", value: "On vessel" };
const arrived: FilterExpr = { field: "stage", op: "eq", value: "Arrived" };
const beforeVessel: FilterExpr = { field: "stage", op: "nin", value: ["On vessel", "Arrived"] };
const toLoad: FilterExpr = { field: "stage", op: "in", value: ["Planned", "Loading"] };
const pastEta: FilterExpr = { and: [onVessel, { field: "days_to_arrival", op: "lt", value: 0 }] };
const docsComplete: FilterExpr = { field: "docs_status", op: "eq", value: "Complete" };
const docsPending: FilterExpr = { field: "docs_pending", op: "gt", value: 0 };
/** Physical containers, not container lines. */
const containers = (filter?: FilterExpr): MetricSpec => ({ agg: "distinct", field: "container_id", format: "integer", ...(filter ? { filter } : {}) });
const share = (numerator: FilterExpr): MetricSpec => ({ agg: "rate", field: "container_id", numerator, format: "percent" });
const aed = (field: string, filter?: FilterExpr): MetricSpec => ({ agg: "sum", field, format: "currency", currency: CURRENCY, ...(filter ? { filter } : {}) });

export function containersLayout(schema: SchemaMap): Layout {
  const has = (id: string) => schema.fields.some((f) => f.id === id);
  const docIds = DOCS.map((d) => d.id).filter(has);
  const table = (w: Omit<Extract<Widget, { type: "table" }>, "type" | "groupBy" | "rowLabel">): Widget => ({ type: "table", groupBy: "container_id", rowLabel: "containers", ...w, columns: w.columns.filter(has) });
  const overviewWidgets: Widget[] = [
    { id: "insights", type: "insights", title: "What changed since the last update" },
    { id: "kpi_containers", type: "kpi", title: "Containers", metric: containers(), good: "up", secondary: { metric: containers(toLoad), label: "still to load" } },
    { id: "kpi_tonnage", type: "kpi", title: "Net weight (MT)", metric: { agg: "sum", field: "net_weight_mt", format: "decimal" }, good: "up", secondary: { metric: { agg: "sum", field: "cartons", format: "integer" }, label: "cartons" } },
    ...(has("invoice_value") ? [{ id: "kpi_value", type: "kpi", title: "Invoice value", metric: aed("invoice_value"), good: "up", secondary: { metric: { agg: "avg", field: "price_per_mt", format: "currency", currency: CURRENCY }, label: "per MT" } } as Widget] : []),
    { id: "kpi_vessel", type: "kpi", title: "On the vessel", metric: containers(onVessel), good: "none", onClick: onVessel, secondary: { metric: containers(pastEta), label: "past ETA" } },
    { id: "kpi_arrived", type: "kpi", title: "Arrived", metric: containers(arrived), good: "up", onClick: arrived, secondary: { metric: share(arrived), label: "of all containers" } },
    { id: "kpi_docs", type: "kpi", title: "Documents complete", metric: containers(docsComplete), good: "up", onClick: docsComplete, secondary: { metric: share(docsComplete), label: "of all containers" } },
    { id: "pipeline", type: "bar", title: "Where every container stands", subtitle: "Containers by stage, click to filter", dimension: "stage", metric: containers(), sort: "order", colorBy: "status", orientation: "horizontal" },
    { id: "loading", type: "line", title: "Loading days", subtitle: "Containers loaded per day", dateField: "loading_date", unit: "day", series: [{ label: "Containers", metric: containers(), kind: "bar" }] },
    { id: "vessels", type: "bar", title: "Vessels", subtitle: "Containers by vessel and stage", dimension: "vessel", metric: containers(), stackBy: "stage", colorBy: "categorical", orientation: "horizontal", topN: 8 },
    { id: "products", type: "bar", title: "Products", subtitle: "Net weight (MT) by product", dimension: "product", metric: { agg: "sum", field: "net_weight_mt", format: "decimal" }, colorBy: "single", orientation: "horizontal", topN: 12 },
    { id: "orders", type: "bar", title: "Sales orders", subtitle: "Containers by sales order and stage", dimension: "sales_order", metric: containers(), stackBy: "stage", colorBy: "categorical", orientation: "horizontal", topN: 8 },
    { id: "docs", type: "bar", title: "Document readiness", subtitle: "Containers with every export document done", dimension: "docs_status", metric: containers(), sort: "order", colorBy: "status", orientation: "horizontal" },
    table({ id: "docs_pending", title: "Containers with pending documents", subtitle: "What is still missing, per container", columns: ["container_number", "product", "vessel", "status", "docs_pending", "docs_pending_list"], filter: docsPending, sort: { field: "docs_pending", dir: "desc" }, statusField: "status", emphasisField: "docs_pending", pageSize: 10 }),
  ];
  const kpiIds = ["kpi_containers", "kpi_tonnage", ...(has("invoice_value") ? ["kpi_value"] : []), "kpi_vessel", "kpi_arrived", "kpi_docs"];
  const widths = kpiIds.length === 6 ? [2, 2, 2, 2, 2, 2] : [3, 3, 2, 2, 2];
  let x = 0;
  const kpiGrid = kpiIds.map((i, k) => { const g = { i, x, y: 2, w: widths[k], h: 3 }; x += widths[k]; return g; });
  const overview: Page = { id: "overview", title: "Overview", widgets: overviewWidgets, grid: [
    { i: "insights", x: 0, y: 0, w: 12, h: 2, minH: 2 },
    ...kpiGrid,
    { i: "pipeline", x: 0, y: 5, w: 4, h: 7 }, { i: "loading", x: 4, y: 5, w: 8, h: 7 },
    { i: "products", x: 0, y: 12, w: 6, h: 11 }, { i: "vessels", x: 6, y: 12, w: 6, h: 5 }, { i: "orders", x: 6, y: 17, w: 6, h: 6 },
    { i: "docs", x: 0, y: 23, w: 4, h: 6 }, { i: "docs_pending", x: 4, y: 23, w: 8, h: 6 },
  ] };

  const vessels: Page = { id: "vessels", title: "Vessels and arrivals", widgets: [
    table({ id: "sailing", title: "On the vessel", subtitle: "Loaded on board, by arrival date; a negative day count means the ETA has passed", columns: ["container_number", "product", "vessel", "bl_number", "ets", "eta", "days_to_arrival", "status"], filter: onVessel, sort: { field: "eta", dir: "asc" }, statusField: "status", pageSize: 30 }),
    table({ id: "waiting", title: "Waiting to sail", subtitle: "Planned, loading, on the way to the port or at the port", columns: ["container_number", "product", "sales_order", "loading_date", "vessel", "gate_in", "cut_off", "ets", "status"], filter: beforeVessel, sort: { field: "loading_date", dir: "desc" }, statusField: "status", pageSize: 30 }),
    table({ id: "arrived", title: "Arrived", subtitle: "Discharged at the destination port", columns: ["container_number", "product", "vessel", "ets", "eta", "bl_number", "status"], filter: arrived, sort: { field: "eta", dir: "desc" }, statusField: "status", pageSize: 30 }),
  ], grid: [
    { i: "sailing", x: 0, y: 0, w: 12, h: 8 }, { i: "waiting", x: 0, y: 8, w: 12, h: 8 }, { i: "arrived", x: 0, y: 16, w: 12, h: 8 },
  ] };

  const documents: Page = { id: "documents", title: "Documents", widgets: [
    table({ id: "checklist", title: "Document checklist", subtitle: "Done or pending per container", columns: ["container_number", "vessel", "status", ...docIds], sort: { field: "docs_pending", dir: "desc" }, statusField: "status", statusFields: docIds, search: true, pageSize: 60, dense: true }),
  ], grid: [{ i: "checklist", x: 0, y: 0, w: 12, h: 18 }] };

  const register: Page = { id: "register", title: "Register", widgets: [
    table({ id: "register", title: "All containers", subtitle: "A container carrying several products is one line; its products are listed together", columns: ["container_number", "product", "cartons", "net_weight_mt", "invoice_value", "sales_order", "loading_date", "vessel", "ets", "eta", "bl_number", "status", "docs_status"], sort: { field: "loading_date", dir: "desc" }, statusField: "status", statusFields: ["docs_status"], search: true, pageSize: 60 }),
  ], grid: [{ i: "register", x: 0, y: 0, w: 12, h: 18 }] };
  const quality: Page = { id: "quality", title: "Data quality", widgets: [{ id: "quality", type: "quality", title: "Data quality" }], grid: [{ i: "quality", x: 0, y: 0, w: 12, h: 16 }] };

  const filters: Layout["filters"] = [
    { kind: "daterange", field: "loading_date", label: "Loaded" },
    { kind: "select", field: "stage", label: "Stage" },
    { kind: "select", field: "status", label: "Status" },
    { kind: "select", field: "vessel", label: "Vessel" },
    { kind: "select", field: "sales_order", label: "Sales order" },
    { kind: "select", field: "product", label: "Product" },
    { kind: "select", field: "docs_status", label: "Documents" },
    { kind: "search", field: "container_number", label: "Search" },
  ].filter((f) => has(f.field)) as Layout["filters"];
  return { version: 1, dateField: "loading_date", filters, pages: [overview, vessels, documents, register, quality] };
}

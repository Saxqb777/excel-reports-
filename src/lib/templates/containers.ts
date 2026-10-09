import type { Field, FilterExpr, SchemaMap } from "@/lib/schema/types";
import { normKey } from "@/lib/schema/types";
import type { Layout, Page, Widget } from "@/lib/dashboard/types";

/**
 * Curated layout for an export container tracker: one row per container with the sales order, product, vessel,
 * loading and sailing dates, a status and a Done/Pending checklist of export documents.
 * Matched by headers (the Bait Al Tamour tracker); works for any sheet using the same column names.
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
const DOC_VALUE_MAP: Record<string, string> = { yes: "Done", ok: "Done", completed: "Done", complete: "Done", received: "Done", issued: "Done", y: "Done", no: "Pending", n: "Pending", "not yet": "Pending", "in progress": "Pending", pending: "Pending", "-": "Pending" };

export const CONTAINER_STATUSES = ["Loading", "On the way to port", "In Sajja depot", "At port", "Sailing", "Arrived", "Delivered"];
const STATUS_VALUE_MAP: Record<string, string> = {
  "on the way loading": "Loading", "under loading": "Loading", "loading": "Loading",
  "on the way to port": "On the way to port", "to port": "On the way to port",
  "container in sajja": "In Sajja depot", "in sajja": "In Sajja depot", "sajja": "In Sajja depot",
  "in kct": "At port", "kct": "At port", "in port": "At port", "gate in": "At port",
  "sailed": "Sailing", "on board": "Sailing", "in transit": "Sailing",
  "discharged": "Arrived", "reached": "Arrived",
};
export const STAGES = ["Loading", "On the way to port", "In depot", "Sailing", "Arrived"];

/** ERP item descriptions folded into customer-facing product names. Unknown descriptions show as typed. */
const PRODUCT_NAMES: Record<string, string> = {
  "dc fardh pch 500gm*16 india": "Fardh 500 g pouch × 16",
  "dc khenzi pch 500gm*16 ind": "Khenaizi 500 g pouch × 16",
  "dc khenaizi retail t/b box 5kg": "Khenaizi 5 kg box",
  "dc khenaizi retail t/b box": "Khenaizi 5 kg box",
  "dc bouman thrmo 500gm*16 in": "Bouman 500 g thermo × 16",
  "dc neghal t/b box 5kg": "Neghal 5 kg box",
  "emirates deluxe fardh 500gx16": "Emirates Deluxe Fardh 500 g × 16",
  "emirates premium 10x800g-ind": "Emirates Premium 800 g × 10",
  "emirates premium 10x800g-in": "Emirates Premium 800 g × 10",
  "barhi thrmo 500gm*16 ind": "Barhi 500 g thermo × 16",
  "dc khlas tub 750gm*12 india": "Khalas 750 g tub × 12",
};

type Spec = { headers: string[]; patch: Partial<Field> & { id: string } };
const SPECS: Spec[] = [
  { headers: ["s.no", "s no", "sl no", "sr no", "#"], patch: { id: "s_no", role: "ignore" } },
  { headers: ["so order number", "so number", "sales order", "sales order number"], patch: { id: "sales_order", label: "Sales order", type: "string", role: "dimension" } },
  { headers: ["erp order status"], patch: { id: "erp_status", label: "ERP status", type: "string", role: "dimension", hidden: true } },
  { headers: ["stock ready date"], patch: { id: "stock_ready_date", label: "Stock ready", type: "date", role: "date", format: "date" } },
  { headers: ["sku", "item code"], patch: { id: "sku", label: "SKU", type: "string", role: "dimension" } },
  { headers: ["sku description", "item description", "product"], patch: { id: "product", label: "Product", type: "string", role: "dimension", semantic: "description", valueMap: PRODUCT_NAMES } },
  { headers: ["order qty", "qty", "quantity", "cartons"], patch: { id: "cartons", label: "Cartons", type: "number", role: "measure", semantic: "quantity", format: "integer" } },
  { headers: ["net weight ( mt )", "net weight (mt)", "net weight mt", "net weight"], patch: { id: "net_weight_mt", label: "Net weight (MT)", type: "number", role: "measure", semantic: "quantity", format: "decimal" } },
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
    { id: "stage", label: "Stage", source: null, type: "string", role: "dimension", semantic: "status", order: STAGES,
      derived: { kind: "keyword", from: ["status"], rules: [
        { value: "Arrived", match: ["arrived", "delivered", "discharged", "reached"] },
        { value: "Sailing", match: ["sailing", "sailed", "on board", "departed", "in transit"] },
        { value: "At port", match: ["at port", "in port", "kct", "gate in"] },
        { value: "In depot", match: ["sajja", "depot", "yard"] },
        { value: "On the way to port", match: ["to port"] },
        { value: "Loading", match: ["loading", "stuffing", "factory", "ready"] },
      ], fallback: null } },
  );
  if (has("eta")) fields.push({ id: "days_to_arrival", label: "Days to arrival", source: null, type: "number", role: "measure", format: "days", derived: { kind: "daysUntil", from: "eta" } });
  if (has("loading_date") && has("ets")) fields.push({ id: "loading_to_sailing_days", label: "Loading to sailing (days)", source: null, type: "number", role: "measure", format: "days", derived: { kind: "diffDays", from: "loading_date", to: "ets" } });
  if (has("ets") && has("eta")) fields.push({ id: "transit_days", label: "Transit (days)", source: null, type: "number", role: "measure", format: "days", derived: { kind: "diffDays", from: "ets", to: "eta" } });
  if (docIds.length) {
    fields.push(
      { id: "docs_pending", label: "Documents pending", source: null, type: "number", role: "measure", format: "integer", derived: { kind: "pendingCount", fields: docIds, done: DOC_DONE } },
      { id: "docs_pending_list", label: "Pending documents", source: null, type: "string", role: "text", derived: { kind: "pendingList", fields: docIds, done: DOC_DONE } },
      { id: "docs_status", label: "Documents", source: null, type: "string", role: "dimension", semantic: "status", order: ["Complete", "Pending"], derived: { kind: "bucket", from: "docs_pending", edges: [1], labels: ["Complete", "Pending"] } },
    );
  }
  return { ...inferred, fields, idField: has("container_number") ? "container_number" : inferred.idField, primaryDate: has("loading_date") ? "loading_date" : inferred.primaryDate };
}

const sailing: FilterExpr = { field: "stage", op: "eq", value: "Sailing" };
const arrived: FilterExpr = { field: "stage", op: "eq", value: "Arrived" };
const beforeSailing: FilterExpr = { field: "stage", op: "nin", value: ["Sailing", "Arrived"] };
const inDepot: FilterExpr = { field: "stage", op: "eq", value: "In depot" };
const pastEta: FilterExpr = { and: [sailing, { field: "days_to_arrival", op: "lt", value: 0 }] };
const docsComplete: FilterExpr = { field: "docs_status", op: "eq", value: "Complete" };
const docsPending: FilterExpr = { field: "docs_pending", op: "gt", value: 0 };

export function containersLayout(schema: SchemaMap): Layout {
  const has = (id: string) => schema.fields.some((f) => f.id === id);
  const docIds = DOCS.map((d) => d.id).filter(has);
  const overviewWidgets: Widget[] = [
    { id: "insights", type: "insights", title: "What changed since the last update" },
    { id: "kpi_containers", type: "kpi", title: "Containers", metric: { agg: "count" }, good: "up", secondary: { metric: { agg: "distinct", field: "sales_order", format: "integer" }, label: "sales orders" } },
    { id: "kpi_tonnage", type: "kpi", title: "Net weight (MT)", metric: { agg: "sum", field: "net_weight_mt", format: "decimal" }, good: "up", secondary: { metric: { agg: "sum", field: "cartons", format: "integer" }, label: "cartons" } },
    { id: "kpi_before", type: "kpi", title: "Before sailing", metric: { agg: "count", filter: beforeSailing }, good: "none", onClick: beforeSailing, secondary: { metric: { agg: "count", filter: inDepot }, label: "in depot" } },
    { id: "kpi_sailing", type: "kpi", title: "Sailing", metric: { agg: "count", filter: sailing }, good: "none", onClick: sailing, secondary: { metric: { agg: "count", filter: pastEta }, label: "past ETA" } },
    { id: "kpi_arrived", type: "kpi", title: "Arrived", metric: { agg: "count", filter: arrived }, good: "up", onClick: arrived, secondary: { metric: { agg: "rate", numerator: arrived, format: "percent" }, label: "of all containers" } },
    { id: "kpi_docs", type: "kpi", title: "Documents complete", metric: { agg: "count", filter: docsComplete }, good: "up", onClick: docsComplete, secondary: { metric: { agg: "rate", numerator: docsComplete, format: "percent" }, label: "of all containers" } },
    { id: "pipeline", type: "bar", title: "Where every container stands", subtitle: "Containers by stage, click to filter", dimension: "stage", metric: { agg: "count" }, sort: "order", colorBy: "status", orientation: "horizontal" },
    { id: "loading", type: "line", title: "Loading days", subtitle: "Containers loaded per day", dateField: "loading_date", unit: "day", series: [{ label: "Containers", metric: { agg: "count" }, kind: "bar" }] },
    { id: "vessels", type: "bar", title: "Vessels", subtitle: "Containers by vessel and stage", dimension: "vessel", metric: { agg: "count" }, stackBy: "stage", colorBy: "categorical", orientation: "horizontal", topN: 8 },
    { id: "products", type: "bar", title: "Products", subtitle: "Net weight (MT) by product", dimension: "product", metric: { agg: "sum", field: "net_weight_mt", format: "decimal" }, colorBy: "single", orientation: "horizontal", topN: 10 },
    { id: "orders", type: "bar", title: "Sales orders", subtitle: "Containers by sales order and stage", dimension: "sales_order", metric: { agg: "count" }, stackBy: "stage", colorBy: "categorical", orientation: "horizontal", topN: 8 },
    { id: "docs", type: "bar", title: "Document readiness", subtitle: "Containers with every export document done", dimension: "docs_status", metric: { agg: "count" }, sort: "order", colorBy: "status", orientation: "horizontal" },
    { id: "docs_pending", type: "table", title: "Containers with pending documents", subtitle: "What is still missing, per container", columns: ["container_number", "product", "vessel", "status", "docs_pending", "docs_pending_list"].filter(has), filter: docsPending, sort: { field: "docs_pending", dir: "desc" }, statusField: "status", emphasisField: "docs_pending", pageSize: 10 },
  ];
  const overview: Page = { id: "overview", title: "Overview", widgets: overviewWidgets, grid: [
    { i: "insights", x: 0, y: 0, w: 12, h: 2, minH: 2 },
    { i: "kpi_containers", x: 0, y: 2, w: 2, h: 3 }, { i: "kpi_tonnage", x: 2, y: 2, w: 2, h: 3 }, { i: "kpi_before", x: 4, y: 2, w: 2, h: 3 },
    { i: "kpi_sailing", x: 6, y: 2, w: 2, h: 3 }, { i: "kpi_arrived", x: 8, y: 2, w: 2, h: 3 }, { i: "kpi_docs", x: 10, y: 2, w: 2, h: 3 },
    { i: "pipeline", x: 0, y: 5, w: 4, h: 7 }, { i: "loading", x: 4, y: 5, w: 8, h: 7 },
    { i: "products", x: 0, y: 12, w: 6, h: 10 }, { i: "vessels", x: 6, y: 12, w: 6, h: 4 }, { i: "orders", x: 6, y: 16, w: 6, h: 6 },
    { i: "docs", x: 0, y: 22, w: 4, h: 6 }, { i: "docs_pending", x: 4, y: 22, w: 8, h: 6 },
  ] };

  const vessels: Page = { id: "vessels", title: "Vessels and arrivals", widgets: [
    { id: "sailing", type: "table", title: "Sailing now", subtitle: "On board, by arrival date; a negative day count means the ETA has passed", columns: ["container_number", "product", "vessel", "bl_number", "ets", "eta", "days_to_arrival", "status"].filter(has), filter: sailing, sort: { field: "eta", dir: "asc" }, statusField: "status", emphasisField: "days_to_arrival", pageSize: 30 },
    { id: "waiting", type: "table", title: "Waiting to sail", subtitle: "Loaded, in the depot or on the way to the port", columns: ["container_number", "product", "sales_order", "loading_date", "vessel", "gate_in", "cut_off", "ets", "status"].filter(has), filter: beforeSailing, sort: { field: "loading_date", dir: "desc" }, statusField: "status", pageSize: 30 },
    { id: "dwell", type: "dots", title: "Loading to departure", subtitle: "Days between loading and the vessel's sailing date, one dot per container", valueField: "loading_to_sailing_days", labelField: "container_number", colorField: "vessel", format: "days" },
  ], grid: [
    { i: "sailing", x: 0, y: 0, w: 12, h: 8 }, { i: "waiting", x: 0, y: 8, w: 12, h: 7 }, { i: "dwell", x: 0, y: 15, w: 12, h: 6 },
  ] };

  const documents: Page = { id: "documents", title: "Documents", widgets: [
    { id: "checklist", type: "table", title: "Document checklist", subtitle: "Done or pending per container", columns: ["container_number", "vessel", "status", ...docIds].filter(has), sort: { field: "docs_pending", dir: "desc" }, statusField: "status", statusFields: docIds, search: true, pageSize: 60, dense: true },
  ], grid: [{ i: "checklist", x: 0, y: 0, w: 12, h: 18 }] };

  const registerCols = ["container_number", "product", "sku", "cartons", "net_weight_mt", "sales_order", "loading_date", "vessel", "ets", "eta", "bl_number", "status", "docs_status"].filter(has);
  const register: Page = { id: "register", title: "Register", widgets: [
    { id: "register", type: "table", title: "All containers", columns: registerCols, sort: { field: "loading_date", dir: "desc" }, statusField: "status", statusFields: ["docs_status"], search: true, pageSize: 60 },
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

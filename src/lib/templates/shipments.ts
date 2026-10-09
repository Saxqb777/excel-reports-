import type { Field, FilterExpr, SchemaMap } from "@/lib/schema/types";
import { normKey } from "@/lib/schema/types";
import type { Layout, Page, Widget } from "@/lib/dashboard/types";

/**
 * Curated layout for an export shipment tracker: one row per container with status, ports, dates, carrier and value.
 * Matched by headers (the Al Foah tracker layout); works for any sheet using the same column names.
 */
const REQUIRED = ["status", "container number", "eta", "pod country", "loading date", "carrier"];
export function matchesShipments(headers: string[]): boolean {
  const have = new Set(headers.map((h) => normKey(h)));
  return REQUIRED.every((h) => have.has(normKey(h))) && [...have].some((h) => /value/.test(h));
}

export const SHIPMENT_STATUSES = ["Planned", "Booked", "Under loading", "Loaded", "In transit", "In port", "Waiting clearance", "Delivered", "Returned", "Cancelled"];
const ON_WATER = ["Loaded", "In transit", "In port", "Waiting clearance"];
const NOT_SHIPPED = ["Planned", "Booked", "Under loading"];
export const STAGES = ["Not shipped yet", "On the water", "Delivered", "Returned / cancelled"];

export function shipmentsSchema(inferred: SchemaMap): SchemaMap {
  const fields: Field[] = inferred.fields.filter((f) => !f.derived).map((f) => ({ ...f }));
  const byId = new Map(fields.map((f) => [f.id, f]));
  const set = (id: string, patch: Partial<Field>) => { const f = byId.get(id); if (f) Object.assign(f, patch); };
  // One id: the shipment reference. The container number is a plain attribute (a container can appear on two rows).
  for (const f of fields) if (f.role === "id" && f.id !== "shipment_ref") f.role = "text";
  set("status", { role: "dimension", semantic: "status", allowedValues: SHIPMENT_STATUSES, order: SHIPMENT_STATUSES, valueMap: { "in-transit": "In transit", "on the way": "In transit", "intransit": "In transit" } });
  set("value_usd", { role: "measure", semantic: "amount", format: "currency", currency: "USD", label: "Value (USD)" });
  set("containers", { role: "measure", semantic: "quantity", format: "integer" });
  set("packages", { role: "measure", format: "integer" });
  set("weight_tons", { role: "measure", format: "decimal", label: "Weight (tons)" });
  for (const id of ["planned_transit_days", "revised_transit_days", "delay_days"]) set(id, { role: "measure", format: "days" });
  set("delay_days", { label: "Delay (days)" });
  set("free_days_at_pol", { role: "measure", format: "integer", semantic: undefined });
  set("free_days_at_pod", { role: "measure", format: "integer", semantic: undefined });
  set("customer_name", { label: "Customer" });
  set("pod_country", { label: "Destination country" });
  set("pod", { label: "Destination port" });
  set("pol", { label: "Loading port" });
  set("sales_person", { label: "Sales person", semantic: "owner" });
  set("incoterm", { semantic: undefined });
  set("transporter", { semantic: undefined });
  set("mode", { semantic: "mode" });

  const statusId = byId.has("status") ? "status" : fields.find((f) => f.semantic === "status")?.id ?? "status";
  const revised = byId.has("revised_eta") ? "revised_eta" : "eta";
  fields.push(
    { id: "stage", label: "Stage", source: null, type: "string", role: "dimension", semantic: "status", order: STAGES,
      derived: { kind: "keyword", from: [statusId], rules: [
        { value: "Delivered", match: ["delivered"] },
        { value: "Returned / cancelled", match: ["returned", "cancelled", "ceased"] },
        { value: "On the water", match: ON_WATER.map((s) => s.toLowerCase()) },
        { value: "Not shipped yet", match: NOT_SHIPPED.map((s) => s.toLowerCase()) },
      ], fallback: "Not shipped yet" } },
    { id: "days_to_arrival", label: "Days to arrival", source: null, type: "number", role: "measure", format: "days", derived: { kind: "daysUntil", from: revised } },
    { id: "delay_band", label: "Delay band", source: null, type: "string", role: "dimension", order: ["On time / early", "1–7 days late", "8–14 days late", "15+ days late"],
      derived: { kind: "bucket", from: "delay_days", edges: [1, 8, 15], labels: ["On time / early", "1–7 days late", "8–14 days late", "15+ days late"] } },
    { id: "month_loaded", label: "Month loaded", source: null, type: "date", role: "date", format: "date", semantic: "period", derived: { kind: "period", from: "loading_date", unit: "month" } },
  );
  return { ...inferred, fields, idField: byId.has("shipment_ref") ? "shipment_ref" : inferred.idField, primaryDate: byId.has("loading_date") ? "loading_date" : inferred.primaryDate };
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
    { id: "kpi_overdue", type: "kpi", title: "Past revised ETA", metric: { agg: "count", filter: overdue }, good: "down", onClick: overdue, secondary: { metric: { agg: "avg", field: "delay_days", format: "days", filter: onWater }, label: "avg delay" } },
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

  const arrivalCols = ["shipment_ref", "customer_name", "pod_country", "carrier", "revised_eta", "days_to_arrival", "delay_days", "status"].filter(has);
  const arrivals: Page = { id: "arrivals", title: "Arrivals and delays", widgets: [
    { id: "due", type: "table", title: "Arriving in the next 30 days", subtitle: "On the water, by revised ETA", columns: arrivalCols, filter: dueSoon, sort: { field: "revised_eta", dir: "asc" }, statusField: "status", emphasisField: "delay_days", pageSize: 15 },
    { id: "late", type: "table", title: "Past their revised ETA", subtitle: "Still on the water after the revised arrival date", columns: arrivalCols, filter: overdue, sort: { field: "days_to_arrival", dir: "asc" }, statusField: "status", emphasisField: "delay_days", pageSize: 15 },
    { id: "delay_dots", type: "dots", title: "Delay by shipment", subtitle: "Revised ETA against planned ETA, one dot per container; left of the line is early", valueField: "delay_days", labelField: "shipment_ref", colorField: "stage", target: 0, targetLabel: "On time", format: "days" },
    { id: "delay_bands", type: "bar", title: "How late", subtitle: "Containers by delay band", dimension: "delay_band", metric: { agg: "sum", field: "containers", format: "integer" }, orientation: "horizontal", sort: "order", colorBy: "single" },
    { id: "carrier_delay", type: "bar", title: "Average delay by carrier", subtitle: "Days, revised ETA against planned", dimension: "carrier", metric: { agg: "avg", field: "delay_days", format: "days" }, orientation: "horizontal", topN: 8, colorBy: "single" },
    { id: "transit", type: "heatmap", title: "Average transit days", subtitle: "Destination country by carrier", rowDim: "pod_country", colDim: "carrier", metric: { agg: "avg", field: "revised_transit_days", format: "days" } },
  ], grid: [
    { i: "due", x: 0, y: 0, w: 12, h: 8 }, { i: "late", x: 0, y: 8, w: 12, h: 6 },
    { i: "delay_dots", x: 0, y: 14, w: 7, h: 7 }, { i: "delay_bands", x: 7, y: 14, w: 5, h: 7 },
    { i: "carrier_delay", x: 0, y: 21, w: 5, h: 7 }, { i: "transit", x: 5, y: 21, w: 7, h: 7 },
  ] };

  const registerCols = ["shipment_ref", "customer_name", "product", "container_number", "container_type", "carrier", "pol", "pod_country", "pod", "loading_date", "ets", "eta", "revised_eta", "status", "containers", "value_usd", "invoice_number", "remarks"].filter(has);
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

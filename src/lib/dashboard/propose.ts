import type { Field, FilterExpr, SchemaMap } from "@/lib/schema/types";
import type { BarWidget, GridItem, KpiWidget, Layout, Page, Widget } from "./types";

/**
 * Generic dashboard proposal from a schema map. Used for new projects that do not match a curated template.
 * Produces a KPI row, category breakdowns, a time series when a date exists, a register table and a quality page.
 */
export function proposeLayout(schema: SchemaMap): Layout {
  const fields = schema.fields.filter((f) => f.role !== "ignore" && !f.hidden);
  const measures = fields.filter((f) => f.role === "measure" && !f.derived);
  const dims = fields.filter((f) => f.role === "dimension");
  const dates = fields.filter((f) => f.role === "date");
  const id = fields.find((f) => f.role === "id");
  const primaryDate = (schema.primaryDate && fields.find((f) => f.id === schema.primaryDate)) || dates[0];
  const status = fields.find((f) => f.semantic === "status");
  const outcome = fields.find((f) => f.semantic === "outcome");
  const amount = fields.find((f) => f.semantic === "amount") ?? measures[0];

  const widgets: Widget[] = [{ id: "insights", type: "insights", title: "What changed" }];
  const grid: GridItem[] = [{ i: "insights", x: 0, y: 0, w: 12, h: 2 }];
  const kpis: KpiWidget[] = [];
  kpis.push({ id: "kpi_rows", type: "kpi", title: `${id ? id.label : "Rows"} count`, metric: { agg: "count" }, good: "up", ...(primaryDate ? { sparkline: { dateField: primaryDate.id, unit: "week" as const } } : {}) });
  if (amount) kpis.push({ id: `kpi_${amount.id}`, type: "kpi", title: `Total ${amount.label.toLowerCase()}`, metric: { agg: "sum", field: amount.id, format: amount.format === "currency" ? "currency" : "integer", currency: amount.currency }, good: "up", ...(primaryDate ? { sparkline: { dateField: primaryDate.id, unit: "week" as const } } : {}) });
  for (const m of measures.filter((x) => x !== amount).slice(0, 2)) kpis.push({ id: `kpi_${m.id}`, type: "kpi", title: `Avg ${m.label.toLowerCase()}`, metric: { agg: "avg", field: m.id, format: m.format === "currency" ? "currency" : "decimal", currency: m.currency }, good: "none" });
  if (outcome) {
    const won = outcome.allowedValues?.find((v) => /won|win/i.test(v)) ?? "Won";
    const lost = outcome.allowedValues?.find((v) => /lost|loss/i.test(v)) ?? "Lost";
    const decided: FilterExpr = { field: outcome.id, op: "in", value: [won, lost] };
    kpis.push({ id: "kpi_win", type: "kpi", title: "Win rate", metric: { agg: "rate", numerator: { field: outcome.id, op: "eq", value: won }, denominator: decided, format: "percent" }, good: "up", onClick: decided });
  }
  if (status) {
    const top = status.allowedValues?.[0] ?? status.order?.[0];
    if (top) kpis.push({ id: "kpi_status", type: "kpi", title: `${status.label}: ${top}`, metric: { agg: "count", filter: { field: status.id, op: "eq", value: top } }, good: "none", onClick: { field: status.id, op: "eq", value: top } });
  }
  const kpiRow = kpis.slice(0, 6);
  const w = Math.max(2, Math.floor(12 / Math.max(kpiRow.length, 1)));
  kpiRow.forEach((k, i) => { widgets.push(k); grid.push({ i: k.id, x: i * w, y: 2, w, h: 3 }); });

  let y = 5;
  if (primaryDate) {
    widgets.push({ id: "trend", type: "line", title: `Weekly ${id ? id.label.toLowerCase() : "rows"}`, dateField: primaryDate.id, unit: "week", series: [
      { label: "Count", metric: { agg: "count" }, kind: "bar" },
      ...(amount ? [{ label: amount.label, metric: { agg: "sum" as const, field: amount.id }, kind: "line" as const }] : []),
    ] });
    grid.push({ i: "trend", x: 0, y, w: 7, h: 7 });
  }
  const breakdownDims = dims.filter((d) => d !== status && d !== outcome).slice(0, 4);
  const stackBy = outcome?.id ?? status?.id;
  let x = primaryDate ? 7 : 0;
  breakdownDims.forEach((d, i) => {
    const bw: BarWidget = { id: `bar_${d.id}`, type: "bar", title: `${d.label}`, dimension: d.id, metric: amount ? { agg: "sum", field: amount.id, format: amount.format === "currency" ? "currency" : "integer", currency: amount.currency } : { agg: "count" }, stackBy, orientation: "horizontal", topN: 8, colorBy: stackBy ? "status" : "single" };
    widgets.push(bw);
    if (i === 0) { grid.push({ i: bw.id, x, y, w: 12 - x, h: 7 }); y += 7; x = 0; }
    else { grid.push({ i: bw.id, x, y, w: 4, h: 6 }); x += 4; if (x >= 12) { x = 0; y += 6; } }
  });
  if (x !== 0) y += 6;

  const tableCols = fields.filter((f) => !f.derived || f.semantic === "turnaround" || f.semantic === "age").map((f) => f.id).slice(0, 12);
  const register: Page = { id: "register", title: "Register", widgets: [{ id: "register", type: "table", title: "All rows", columns: tableCols, sort: primaryDate ? { field: primaryDate.id, dir: "desc" } : undefined, search: true, pageSize: 50, statusField: (outcome ?? status)?.id }], grid: [{ i: "register", x: 0, y: 0, w: 12, h: 18 }] };
  const overview: Page = { id: "overview", title: "Overview", widgets, grid };
  const quality: Page = { id: "quality", title: "Data quality", widgets: [{ id: "quality", type: "quality", title: "Data quality" }], grid: [{ i: "quality", x: 0, y: 0, w: 12, h: 16 }] };

  const filters: Layout["filters"] = [];
  if (primaryDate) filters.push({ field: primaryDate.id, kind: "daterange", label: primaryDate.label });
  for (const d of [status, outcome, ...breakdownDims].filter((d): d is Field => Boolean(d)).slice(0, 5)) filters.push({ field: d.id, kind: "select", label: d.label });
  const text = fields.find((f) => f.role === "text") ?? id;
  if (text) filters.push({ field: text.id, kind: "search", label: "Search" });

  return { version: 1, dateField: primaryDate?.id, filters, pages: [overview, register, quality] };
}

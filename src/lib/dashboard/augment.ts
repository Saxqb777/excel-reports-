import type { Field, FilterExpr, SchemaMap } from "@/lib/schema/types";
import type { BarWidget, KpiWidget, Layout, Widget } from "./types";

/**
 * When an upload introduces a money or quantity column, add value visuals to the first page automatically.
 * Idempotent: widgets are keyed by field id.
 */
export function augmentLayoutForNewMeasures(layout: Layout, schema: SchemaMap, added: Field[]): Layout {
  const measures = added.filter((f) => f.role === "measure" && f.type === "number" && ["amount", "cost", "margin", "quantity"].includes(f.semantic ?? ""));
  if (measures.length === 0) return layout;
  const page = layout.pages[0];
  if (!page) return layout;
  const outcome = schema.fields.find((f) => f.semantic === "outcome");
  const stage = schema.fields.find((f) => f.id === "stage") ?? schema.fields.find((f) => f.semantic === "status");
  const won = outcome?.allowedValues?.find((v) => /won|win/i.test(v)) ?? "Won";
  const widgets: Widget[] = [...page.widgets];
  const grid = [...page.grid];
  let y = grid.reduce((a, g) => Math.max(a, g.y + g.h), 0);
  for (const m of measures) {
    if (widgets.some((w) => w.id === `auto_kpi_${m.id}`)) continue;
    const fmt = m.format === "currency" ? "currency" : "integer";
    const total: KpiWidget = { id: `auto_kpi_${m.id}`, type: "kpi", title: `Total ${m.label.toLowerCase()}`, metric: { agg: "sum", field: m.id, format: fmt, currency: m.currency }, good: "up", ...(layout.dateField ? { sparkline: { dateField: layout.dateField, unit: "week" as const } } : {}) };
    widgets.push(total); grid.push({ i: total.id, x: 0, y, w: 3, h: 3 });
    let x = 3;
    if (outcome) {
      const wonFilter: FilterExpr = { field: outcome.id, op: "eq", value: won };
      const wonKpi: KpiWidget = { id: `auto_kpi_${m.id}_won`, type: "kpi", title: `${m.label} won`, metric: { agg: "sum", field: m.id, filter: wonFilter, format: fmt, currency: m.currency }, good: "up", onClick: wonFilter, secondary: { metric: { agg: "rate", numerator: wonFilter, format: "percent" }, label: "of rows" } };
      widgets.push(wonKpi); grid.push({ i: wonKpi.id, x, y, w: 3, h: 3 }); x += 3;
      const avg: KpiWidget = { id: `auto_kpi_${m.id}_avg`, type: "kpi", title: `Average ${m.label.toLowerCase()}`, metric: { agg: "avg", field: m.id, format: fmt, currency: m.currency }, good: "none" };
      widgets.push(avg); grid.push({ i: avg.id, x, y, w: 3, h: 3 }); x += 3;
    }
    if (stage) {
      const bar: BarWidget = { id: `auto_bar_${m.id}`, type: "bar", title: `${m.label} by ${stage.label.toLowerCase()}`, dimension: stage.id, metric: { agg: "sum", field: m.id, format: fmt, currency: m.currency }, orientation: "horizontal", sort: "order", colorBy: "status" };
      widgets.push(bar); grid.push({ i: bar.id, x, y, w: 12 - x, h: 3 });
    }
    y += 3;
  }
  return { ...layout, pages: [{ ...page, widgets, grid }, ...layout.pages.slice(1)] };
}

import type { FilterExpr } from "@/lib/schema/types";
import type { MetricSpec } from "@/lib/engine/metrics";

export type Unit = "week" | "month" | "day";

export interface WidgetBase {
  id: string;
  title: string;
  subtitle?: string;
  /** Free-text note shown in the widget's info reveal. */
  note?: string;
}

export interface KpiWidget extends WidgetBase {
  type: "kpi";
  metric: MetricSpec;
  /** Direction that is good news: drives delta colouring. */
  good?: "up" | "down" | "none";
  sparkline?: { dateField: string; unit: Unit };
  /** Clicking the tile applies this filter to the dashboard. */
  onClick?: FilterExpr;
  /** Small secondary line, e.g. "of 17 RFQs". */
  secondary?: { metric: MetricSpec; label: string };
}

export interface BarWidget extends WidgetBase {
  type: "bar";
  dimension: string;
  metric: MetricSpec;
  stackBy?: string;
  orientation?: "horizontal" | "vertical";
  topN?: number;
  sort?: "value" | "key" | "order";
  colorBy?: "single" | "status" | "categorical";
  includeNull?: boolean;
}

export interface LineWidget extends WidgetBase {
  type: "line";
  dateField: string;
  unit: Unit;
  series: { label: string; metric: MetricSpec; kind?: "line" | "bar" }[];
}

export interface FunnelWidget extends WidgetBase {
  type: "funnel";
  stages: { label: string; filter: FilterExpr; status?: "pos" | "neg" | "warn" | "neutral" | "accent" }[];
}

export interface DotsWidget extends WidgetBase {
  type: "dots";
  valueField: string;
  labelField?: string;
  colorField?: string;
  target?: number;
  targetLabel?: string;
  format?: MetricSpec["format"];
}

export interface TableWidget extends WidgetBase {
  type: "table";
  columns: string[];
  sort?: { field: string; dir: "asc" | "desc" };
  filter?: FilterExpr;
  pageSize?: number;
  search?: boolean;
  /** Field rendered as a status pill. */
  statusField?: string;
  /** Field whose value drives row emphasis (e.g. age). */
  emphasisField?: string;
  dense?: boolean;
}

export interface HeatmapWidget extends WidgetBase {
  type: "heatmap";
  rowDim: string;
  colDim: string;
  metric: MetricSpec;
}

export interface InsightsWidget extends WidgetBase { type: "insights" }
export interface QualityWidget extends WidgetBase { type: "quality" }
export interface TextWidget extends WidgetBase { type: "text"; body: string }

export type Widget = KpiWidget | BarWidget | LineWidget | FunnelWidget | DotsWidget | TableWidget | HeatmapWidget | InsightsWidget | QualityWidget | TextWidget;

export interface GridItem { i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number }

export interface Page {
  id: string;
  title: string;
  widgets: Widget[];
  grid: GridItem[];
  hidden?: string[];
}

export interface FilterControl {
  field: string;
  label?: string;
  kind: "select" | "daterange" | "search";
}

export interface Layout {
  version: number;
  pages: Page[];
  filters: FilterControl[];
  /** Field used by the date range control. */
  dateField?: string;
}

export interface Theme {
  name: string;
  clientName?: string;
  primary: string;
  logoUrl?: string | null;
  mode: "dark" | "light" | "system";
  /** Short mark shown when there is no logo, e.g. "AG". */
  monogram?: string;
}

export const DEFAULT_THEME: Theme = { name: "Untitled", primary: "#0f5fd7", mode: "dark", logoUrl: null };

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
  /** "date" sorts month labels ("Jan 2026") chronologically. */
  sort?: "value" | "key" | "order" | "date";
  colorBy?: "single" | "status" | "categorical";
  includeNull?: boolean;
  /** false hides the share-of-total column (a measure that can be negative, such as a margin). */
  share?: boolean;
  /** Only rows matching this are grouped (a page about one stream of a merged table). */
  filter?: FilterExpr;
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
  /** Further fields rendered with a status dot (e.g. a document checklist). */
  statusFields?: string[];
  /** Show only the first rows in the widget's own sort order (a "top five" list); viewers can still re-sort those. */
  limit?: number;
  /** Roll rows sharing this field's value into one line (container lines → containers): measures sum, differing texts are listed. */
  groupBy?: string;
  /** Word for the row count in the footer, e.g. "containers". */
  rowLabel?: string;
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

/** A table over a secondary sheet (e.g. the vessel schedule), optionally with a column counting matching rows of the main table. */
export interface AuxTableWidget extends WidgetBase {
  type: "auxTable";
  sheet: string;
  columns?: string[];
  sort?: { field: string; dir: "asc" | "desc" };
  statusField?: string;
  pageSize?: number;
  rowLabel?: string;
  /** Count distinct `distinct` values of main-table rows whose `snapshotField` joins the sheet row's `keyColumn`; shown after `after`. */
  countColumn?: { label: string; keyColumn: string; snapshotField: string; distinct: string; after?: string };
}

export interface InsightsWidget extends WidgetBase { type: "insights" }
export interface QualityWidget extends WidgetBase { type: "quality" }
export interface TextWidget extends WidgetBase { type: "text"; body: string }

export type Widget = KpiWidget | BarWidget | LineWidget | FunnelWidget | DotsWidget | TableWidget | AuxTableWidget | HeatmapWidget | InsightsWidget | QualityWidget | TextWidget;

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

"use client";
import type { Widget } from "@/lib/dashboard/types";
import { KpiTile } from "./KpiTile";
import { BarTile } from "./BarTile";
import { TimeTile } from "./TimeTile";
import { FunnelTile } from "./FunnelTile";
import { DotsTile } from "./DotsTile";
import { HeatmapTile } from "./HeatmapTile";
import { TableTile } from "./TableTile";
import { InsightsTile, type Insight } from "./InsightsTile";
import type { Anomaly } from "@/lib/intelligence/anomalies";
import { QualityTile } from "./QualityTile";
import { Tile } from "./Tile";

export interface IntelligenceProps { insights?: Insight[]; anomalies?: Anomaly[]; comparedTo?: number | null; previousKpis?: Record<string, number | null> | null }

export function WidgetRenderer({ w, insights, anomalies, comparedTo, previousKpis }: { w: Widget } & IntelligenceProps) {
  switch (w.type) {
    case "kpi": return <KpiTile w={w} anomaly={anomalies?.find((a) => a.scope === "metric" && a.widgetId === w.id)} previous={previousKpis?.[w.id]} comparedTo={comparedTo} />;
    case "bar": return <BarTile w={w} />;
    case "line": return <TimeTile w={w} />;
    case "funnel": return <FunnelTile w={w} />;
    case "dots": return <DotsTile w={w} />;
    case "heatmap": return <HeatmapTile w={w} />;
    case "table": return <TableTile w={w} />;
    case "insights": return <InsightsTile w={w} insights={insights} comparedTo={comparedTo} />;
    case "quality": return <QualityTile w={w} anomalies={anomalies} />;
    case "text": return <Tile title={w.title}><div className="text-[12.5px] text-ink-2 whitespace-pre-wrap">{w.body}</div></Tile>;
  }
}

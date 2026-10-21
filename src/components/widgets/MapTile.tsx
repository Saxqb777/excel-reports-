"use client";
import { useMemo, useState } from "react";
import { geoNaturalEarth1, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { Topology, GeometryCollection } from "topojson-specification";
import world from "world-atlas/countries-110m.json";
import type { MapWidget } from "@/lib/dashboard/types";
import { computeMetric, groupBy } from "@/lib/engine/metrics";
import { formatNumber } from "@/lib/engine/format";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { useTooltip } from "@/lib/ui/tooltip";
import { useSize } from "@/components/charts/useSize";
import { Tile, DataTable } from "./Tile";

/** Dashboard country names that differ from the atlas's. */
const ATLAS_NAMES: Record<string, string> = {
  USA: "United States of America", UAE: "United Arab Emirates", "United Kingdom": "United Kingdom", UK: "United Kingdom", "South Korea": "South Korea", Russia: "Russia", "Czech Republic": "Czechia",
  "Ivory Coast": "Côte d'Ivoire", "Hong Kong": "China", Singapore: "Malaysia", Bahrain: "Qatar", "Saudi Arabia": "Saudi Arabia", Syria: "Syria", Laos: "Laos", "Dem. Rep. Congo": "Dem. Rep. Congo",
};
const HOME = "United Arab Emirates";

type Countries = FeatureCollection<Geometry, { name: string }>;
const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
const COUNTRIES: Countries = feature(topo, topo.objects.countries) as Countries;
const byName = new Map(COUNTRIES.features.map((f) => [f.properties.name, f]));
const atlasName = (name: string) => ATLAS_NAMES[name] ?? name;

/**
 * A world map with one dot per country, sized by the metric and coloured by the share executed. Arcs join the home
 * country to each destination. The projection is fitted once to every country in the data, so filtering changes the
 * dots, not the view. Clicking a dot filters the dashboard to that country.
 */
export function MapTile({ w }: { w: MapWidget }) {
  const { snapshot, maskFor, dispatch, isSelected, fields, baseMask } = useDashboard();
  const tip = useTooltip();
  const [ref, size] = useSize<HTMLDivElement>();
  const [table, setTable] = useState(false);
  const mask = maskFor(w.id);
  const dim = fields.get(w.countryField);
  const rows = useMemo(() => groupBy(snapshot, mask, w.countryField, w.metric, { sort: "value" }), [snapshot, mask, w.countryField, w.metric]);
  const executed = useMemo(() => {
    if (!w.executedMetric) return new Map<string, number>();
    const col = snapshot.columns[w.countryField];
    const out = new Map<string, number>();
    for (const r of rows) {
      const sub = new Uint8Array(snapshot.n);
      for (let i = 0; i < snapshot.n; i++) if (mask[i] && col[i] === r.key) sub[i] = 1;
      out.set(r.key, computeMetric(snapshot, sub, w.executedMetric) ?? 0);
    }
    return out;
  }, [snapshot, mask, rows, w.countryField, w.executedMetric]);
  // Fit to every country the sheet ever mentions (not just the filtered ones), plus home.
  const everyCountry = useMemo(() => {
    const names = new Set<string>([HOME]);
    const col = snapshot.columns[w.countryField];
    for (let i = 0; i < snapshot.n; i++) if (baseMask[i] && typeof col[i] === "string") names.add(atlasName(col[i] as string));
    return [...names].map((n) => byName.get(n)).filter((f): f is Countries["features"][number] => Boolean(f));
  }, [snapshot, baseMask, w.countryField]);
  const width = Math.max(10, size.width), height = Math.max(10, size.height);
  const { projection, path } = useMemo(() => {
    const projection = geoNaturalEarth1();
    const fc: GeoPermissibleObjects = { type: "FeatureCollection", features: everyCountry.length > 1 ? everyCountry : COUNTRIES.features };
    projection.fitExtent([[12, 8], [width - 12, height - 8]], fc);
    // Never closer than a third of the world: the context is what makes a map readable.
    const worldScale = geoNaturalEarth1().fitExtent([[12, 8], [width - 12, height - 8]], COUNTRIES).scale();
    if (projection.scale() > worldScale * 3) { projection.fitExtent([[12, 8], [width - 12, height - 8]], COUNTRIES); projection.scale(worldScale * 3); }
    return { projection, path: geoPath(projection) };
  }, [everyCountry, width, height]);
  const home = byName.get(HOME);
  const homeXY = home ? path.centroid(home) : null;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const radius = (v: number) => 4 + Math.sqrt(v / max) * Math.min(22, Math.max(10, width / 40));
  const sel = isSelected(w.id);
  const dots = rows.map((r) => {
    const f = byName.get(atlasName(r.key));
    const c = f ? path.centroid(f) : null;
    return { ...r, f, x: c?.[0] ?? null, y: c?.[1] ?? null, exec: executed.get(r.key) ?? 0 };
  });
  const missing = dots.filter((d) => d.x === null).map((d) => d.key);
  const onSelect = (key: string) => dispatch({ type: "toggle", selection: { widgetId: w.id, field: w.countryField, values: [key], label: `${dim?.label ?? "Country"} = ${key}` } });
  const fmt = w.metric.format ?? "integer";
  const present = new Set(dots.map((d) => atlasName(d.key)));
  return (
    <Tile title={w.title} subtitle={w.subtitle} selected={Boolean(sel)} onClear={() => dispatch({ type: "clearSelection", widgetId: w.id })} padded={false} tableActive={table} onToggleTable={() => setTable((t) => !t)}>
      {table ? (
        <div className="h-full px-3.5 pb-3"><DataTable columns={[dim?.label ?? "Country", "Requests", "Executed", "Share executed"]} rows={dots.map((d) => [d.key, formatNumber(d.value, fmt, w.metric.currency), formatNumber(d.exec, fmt), d.value ? `${Math.round((d.exec / d.value) * 100)}%` : "–"])} /></div>
      ) : (
      <div ref={ref} className="relative h-full w-full overflow-hidden">
        {size.width > 0 && (
          <svg width={width} height={height} className="block" role="img" aria-label="Map of countries">
            <defs>
              <radialGradient id={`${w.id}-glow`}><stop offset="0" stopColor="var(--accent)" stopOpacity="0.45" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></radialGradient>
            </defs>
            {COUNTRIES.features.map((f, i) => (
              <path key={i} d={path(f) ?? undefined} fill={present.has(f.properties.name) ? "color-mix(in oklab, var(--accent) 16%, var(--bg-sunk))" : "var(--bg-sunk)"} stroke="var(--line)" strokeWidth={0.5} style={{ transition: "fill 240ms ease" }} />
            ))}
            {homeXY && dots.filter((d) => d.x !== null && d.f && d.f.properties.name !== HOME).map((d) => {
              const line: GeoPermissibleObjects = { type: "LineString", coordinates: [path.centroid(home!) && projection.invert ? projection.invert(homeXY)! : [54, 24], projection.invert ? projection.invert([d.x!, d.y!])! : [0, 0]] };
              return <path key={`arc-${d.key}`} d={path(line) ?? undefined} fill="none" stroke="var(--accent)" strokeWidth={1} strokeOpacity={sel && sel.values[0] !== d.key ? 0.08 : 0.16 + 0.4 * (d.value / max)} strokeLinecap="round" style={{ transition: "stroke-opacity 200ms ease" }} />;
            })}
            {homeXY && <g transform={`translate(${homeXY[0]},${homeXY[1]})`}><circle r={18} fill={`url(#${w.id}-glow)`} /><rect x={-4} y={-4} width={8} height={8} transform="rotate(45)" fill="var(--accent)" stroke="var(--bg)" strokeWidth={1.5} /><text x={-9} y={-9} fontSize={12} fontWeight={600} textAnchor="end" className="fill-[var(--ink-2)]" style={{ fontFamily: "var(--font-ui)", paintOrder: "stroke", stroke: "var(--bg-elev)", strokeWidth: 3 }}>Al Foah</text></g>}
            {dots.filter((d) => d.x !== null && d.f?.properties.name !== HOME).sort((a, b) => b.value - a.value).map((d) => {
              const share = d.value ? d.exec / d.value : 0;
              const on = sel?.values[0] === d.key, dimmed = Boolean(sel) && !on;
              const color = w.executedMetric ? `color-mix(in oklab, var(--pos) ${Math.round(share * 100)}%, var(--warn-mark))` : "var(--accent)";
              return (
                <g key={d.key} transform={`translate(${d.x},${d.y})`} className="cursor-pointer" opacity={dimmed ? 0.35 : 1} style={{ transition: "opacity 160ms ease" }} onClick={() => onSelect(d.key)}
                  onPointerEnter={(e) => tip.show(e, { title: d.key, rows: [{ label: "Requests", value: formatNumber(d.value, fmt, w.metric.currency) }, ...(w.executedMetric ? [{ label: "Executed", value: `${formatNumber(d.exec, fmt)} · ${Math.round(share * 100)}%` }] : [])], note: "Click to filter the dashboard to this country" })} onPointerMove={tip.move} onPointerLeave={tip.hide}>
                  <circle r={radius(d.value)} fill={color} fillOpacity={0.85} stroke={on ? "var(--ink)" : "var(--bg)"} strokeWidth={on ? 2 : 1.2} style={{ transition: "r 300ms ease" }} />
                  {radius(d.value) >= 11 && <text y={1} fontSize={11.5} fontWeight={700} textAnchor="middle" dominantBaseline="middle" fill="var(--accent-ink)" style={{ fontFamily: "var(--font-num)", pointerEvents: "none" }}>{formatNumber(d.value, fmt)}</text>}
                </g>
              );
            })}
          </svg>
        )}
        {w.executedMetric && (
          <div className="pointer-events-none absolute bottom-2 left-3 flex items-center gap-2 text-[12.5px] text-ink-3">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--warn-mark)" }} /> none executed
            <span className="inline-block h-2.5 w-10" style={{ background: "linear-gradient(90deg, var(--warn-mark), var(--pos))" }} />
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--pos)" }} /> all executed
            {missing.length > 0 && <span className="ml-3">Not on the map: {missing.join(", ")}</span>}
          </div>
        )}
      </div>
      )}
    </Tile>
  );
}

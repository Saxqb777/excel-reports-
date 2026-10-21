"use client";
import { useMemo, useState } from "react";
import { sankey, sankeyLinkHorizontal, sankeyJustify, type SankeyNode, type SankeyLink } from "d3-sankey";
import type { FlowWidget } from "@/lib/dashboard/types";
import { formatNumber } from "@/lib/engine/format";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { stackColor } from "@/lib/ui/colors";
import { useTooltip } from "@/lib/ui/tooltip";
import { useSize } from "@/components/charts/useSize";
import { Tile, DataTable } from "./Tile";

type N = { id: string; level: number; field: string; name: string; idx: number };
type L = { source: string; target: string; value: number };
type Node = SankeyNode<N, L>;
type Link = SankeyLink<N, L>;

/**
 * Ribbons from one dimension to the next (direction → mode → stage). Each ribbon's width is the metric over the rows
 * that share both values. Hovering a node lights every ribbon through it; clicking filters the dashboard to it.
 */
export function FlowTile({ w }: { w: FlowWidget }) {
  const { snapshot, maskFor, dispatch, isSelected, fields } = useDashboard();
  const tip = useTooltip();
  const [ref, size] = useSize<HTMLDivElement>();
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const mask = maskFor(w.id);
  const sel = isSelected(w.id);
  const weightField = w.metric.agg === "sum" && w.metric.field ? snapshot.columns[w.metric.field] : null;
  const { nodes, links } = useMemo(() => {
    const cols = w.levels.map((f) => snapshot.columns[f] ?? []);
    const seen = w.levels.map(() => new Map<string, number>());
    const pairs = new Map<string, number>();
    for (let i = 0; i < snapshot.n; i++) {
      if (!mask[i]) continue;
      const wgt = weightField ? (typeof weightField[i] === "number" ? (weightField[i] as number) : 0) : 1;
      if (!wgt) continue;
      const vals = cols.map((c) => (c[i] === null ? "Not set" : String(c[i])));
      vals.forEach((v, li) => seen[li].set(v, (seen[li].get(v) ?? 0) + wgt));
      for (let li = 0; li < vals.length - 1; li++) { const k = `${li}|${vals[li]}|${vals[li + 1]}`; pairs.set(k, (pairs.get(k) ?? 0) + wgt); }
    }
    const nodes: N[] = [];
    w.levels.forEach((f, li) => {
      const order = fields.get(f)?.order ?? [];
      const keys = [...seen[li].keys()].sort((a, b) => { const ia = order.indexOf(a), ib = order.indexOf(b); if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib); return (seen[li].get(b) ?? 0) - (seen[li].get(a) ?? 0); });
      keys.forEach((k, idx) => nodes.push({ id: `${li}:${k}`, level: li, field: f, name: k, idx }));
    });
    const links: L[] = [...pairs.entries()].map(([k, value]) => { const [li, a, b] = k.split("|"); return { source: `${li}:${a}`, target: `${Number(li) + 1}:${b}`, value }; });
    return { nodes, links };
  }, [snapshot, mask, w.levels, weightField, fields]);
  const width = Math.max(10, size.width), height = Math.max(10, size.height);
  const graph = useMemo(() => {
    if (!nodes.length || !links.length || width < 40) return null;
    const gen = sankey<N, L>().nodeId((d) => d.id).nodeWidth(12).nodePadding(Math.max(5, Math.min(16, height / 14))).nodeAlign(sankeyJustify).nodeSort(() => 0).linkSort(() => 0).extent([[4, 6], [width - 4, height - 12]]);
    return gen({ nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) });
  }, [nodes, links, width, height]);
  const colorOf = (n: N) => stackColor(n.name, n.idx, fields.get(n.field)?.semantic === "status" ? "status" : "categorical");
  const nodeOf = (x: string | Node) => x as Node;
  const lit = (l: Link) => { if (!hover) return null; const s = nodeOf(l.source).id, t = nodeOf(l.target).id; return s === hover || t === hover; };
  const onSelect = (n: N) => dispatch({ type: "toggle", selection: { widgetId: w.id, field: n.field, values: [n.name], label: `${fields.get(n.field)?.label ?? n.field} = ${n.name}` } });
  const fmt = w.metric.format ?? "integer";
  const levelCount = w.levels.length;
  const linkPath = sankeyLinkHorizontal<N, L>();
  return (
    <Tile title={w.title} subtitle={w.subtitle} selected={Boolean(sel)} onClear={() => dispatch({ type: "clearSelection", widgetId: w.id })} tableActive={table} onToggleTable={() => setTable((t) => !t)}>
      {table ? (
        <DataTable columns={["From", "To", "Value"]} rows={links.map((l) => [l.source.split(":")[1], l.target.split(":")[1], formatNumber(l.value, fmt, w.metric.currency)])} />
      ) : (
      <div ref={ref} className="h-full w-full overflow-hidden">
        {graph && (
          <svg width={width} height={height} className="block" role="img" aria-label="Flow diagram">
            <defs>
              {graph.links.map((l, i) => { const s = nodeOf(l.source), t = nodeOf(l.target); return (
                <linearGradient key={i} id={`${w.id}-g${i}`} gradientUnits="userSpaceOnUse" x1={s.x1} x2={t.x0}><stop offset="0" stopColor={colorOf(s)} /><stop offset="1" stopColor={colorOf(t)} /></linearGradient>
              ); })}
            </defs>
            {graph.links.map((l, i) => { const s = nodeOf(l.source), t = nodeOf(l.target); const on = lit(l); return (
              <path key={i} d={linkPath(l) ?? undefined} fill="none" stroke={`url(#${w.id}-g${i})`} strokeWidth={Math.max(1, l.width ?? 1)} strokeOpacity={on === null ? 0.38 : on ? 0.8 : 0.08} style={{ transition: "stroke-opacity 160ms ease" }}
                onPointerEnter={(e) => tip.show(e, { title: `${s.name} → ${t.name}`, rows: [{ label: w.metric.agg === "sum" ? "Value" : "Requests", value: formatNumber(l.value, fmt, w.metric.currency) }] })} onPointerMove={tip.move} onPointerLeave={tip.hide} />
            ); })}
            {graph.nodes.map((n) => {
              const on = hover === n.id, dimmed = Boolean(sel) && !(sel!.field === n.field && sel!.values[0] === n.name);
              const last = n.level === levelCount - 1;
              const h = Math.max(1, (n.y1 ?? 0) - (n.y0 ?? 0));
              return (
                <g key={n.id} className="cursor-pointer" opacity={dimmed ? 0.45 : 1} style={{ transition: "opacity 160ms ease" }} onClick={() => onSelect(n)} onPointerEnter={(e) => { setHover(n.id); tip.show(e, { title: n.name, rows: [{ label: fields.get(n.field)?.label ?? n.field, value: n.name, muted: true }, { label: w.metric.agg === "sum" ? "Value" : "Requests", value: formatNumber(n.value ?? 0, fmt, w.metric.currency) }], note: "Click to filter" }); }} onPointerMove={tip.move} onPointerLeave={() => { setHover(null); tip.hide(); }}>
                  <rect x={n.x0} y={n.y0} width={(n.x1 ?? 0) - (n.x0 ?? 0)} height={h} fill={colorOf(n)} rx={2} stroke={on ? "var(--ink)" : "none"} />
                  {h >= 10 && <text x={last ? (n.x0 ?? 0) - 6 : (n.x1 ?? 0) + 6} y={((n.y0 ?? 0) + (n.y1 ?? 0)) / 2} dominantBaseline="middle" textAnchor={last ? "end" : "start"} fontSize={12.5} className="fill-[var(--ink-2)]" style={{ fontFamily: "var(--font-ui)", pointerEvents: "none" }}>
                    {n.name} <tspan className="fill-[var(--ink-3)]" style={{ fontFamily: "var(--font-num)" }}>{formatNumber(n.value ?? 0, fmt, w.metric.currency)}</tspan>
                  </text>}
                </g>
              );
            })}
          </svg>
        )}
      </div>
      )}
    </Tile>
  );
}

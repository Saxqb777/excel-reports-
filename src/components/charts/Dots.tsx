"use client";
import { scaleLinear, scaleBand } from "d3-scale";
import { useTooltip } from "@/lib/ui/tooltip";
import { formatNumber } from "@/lib/engine/format";
import { stackColor } from "@/lib/ui/colors";
import { useSize } from "./useSize";

export interface DotPoint { id: string; label: string; value: number; lane: string; detail?: string }

export function Dots({ points, lanes, target, targetLabel, format = "days", selectedLane, onSelect }: { points: DotPoint[]; lanes: string[]; target?: number; targetLabel?: string; format?: "integer" | "decimal" | "currency" | "percent" | "days"; selectedLane?: string | null; onSelect?: (lane: string) => void }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const tip = useTooltip();
  const m = { top: 8, right: 16, bottom: 26, left: 110 };
  const W = Math.max(0, size.width), H = Math.max(0, size.height);
  const iw = Math.max(10, W - m.left - m.right), ih = Math.max(10, H - m.top - m.bottom);
  const max = Math.max(target ?? 0, ...points.map((p) => p.value), 1);
  const x = scaleLinear().domain([0, max * 1.08]).range([0, iw]).nice(5);
  const y = scaleBand<string>().domain(lanes).range([0, ih]).paddingInner(0.2);
  const ticks = x.ticks(Math.min(6, Math.max(2, Math.floor(iw / 60))));
  const laneIndex = new Map(lanes.map((l, i) => [l, i]));
  const seen = new Map<string, number>();
  const jitter = (p: DotPoint) => { const k = `${p.lane}|${p.value}`; const n = seen.get(k) ?? 0; seen.set(k, n + 1); return n; };
  return (
    <div ref={ref} className="h-full w-full">
      {W > 0 && H > 0 && (
        <svg width={W} height={H} className="block" role="img" aria-label="Distribution">
          <g transform={`translate(${m.left},${m.top})`}>
            {ticks.map((t) => (
              <g key={t} transform={`translate(${x(t)},0)`}>
                <line y1={0} y2={ih} stroke="var(--line)" />
                <text y={ih + 14} textAnchor="middle" fontSize={10.5} className="num fill-[var(--ink-3)]">{formatNumber(t, format)}</text>
              </g>
            ))}
            {lanes.map((l) => {
              const cy = (y(l) ?? 0) + y.bandwidth() / 2;
              const dim = selectedLane && selectedLane !== l;
              return (
                <g key={l} opacity={dim ? 0.35 : 1} style={{ transition: "opacity 160ms ease" }}>
                  <rect x={-m.left} y={y(l) ?? 0} width={iw + m.left} height={y.bandwidth()} fill="transparent" className="cursor-pointer" onClick={() => onSelect?.(l)} />
                  <line x1={0} x2={iw} y1={cy} y2={cy} stroke="var(--line)" strokeWidth={1} />
                  <text x={-10} y={cy} dominantBaseline="middle" textAnchor="end" fontSize={12} className="fill-[var(--ink-2)] pointer-events-none" style={{ fontFamily: "var(--font-ui)" }}>{l}</text>
                </g>
              );
            })}
            {target !== undefined && (
              <g transform={`translate(${x(target)},0)`}>
                <line y1={-4} y2={ih} stroke="var(--accent)" strokeWidth={1} strokeDasharray="3 3" />
                <text y={-1} x={4} fontSize={10} className="fill-[var(--accent)] label">{targetLabel ?? "target"}</text>
              </g>
            )}
            {points.map((p) => {
              const j = jitter(p);
              const cy = (y(p.lane) ?? 0) + y.bandwidth() / 2 + (j % 2 === 0 ? 1 : -1) * Math.ceil(j / 2) * 7;
              const dim = selectedLane && selectedLane !== p.lane;
              const color = stackColor(p.lane, laneIndex.get(p.lane) ?? 0, "status");
              return (
                <g key={p.id} opacity={dim ? 0.3 : 1} className="cursor-pointer" style={{ transition: "opacity 160ms ease" }}
                  onPointerEnter={(e) => tip.show(e, { title: p.label, rows: [{ label: "Value", value: formatNumber(p.value, format) }, { label: "Stage", value: p.lane, muted: true }], note: p.detail })}
                  onPointerMove={tip.move} onPointerLeave={tip.hide} onClick={() => onSelect?.(p.lane)}>
                  <circle cx={x(p.value)} cy={cy} r={12} fill="transparent" />
                  <circle cx={x(p.value)} cy={cy} r={4.5} fill={color} stroke="var(--bg)" strokeWidth={2} />
                </g>
              );
            })}
          </g>
        </svg>
      )}
    </div>
  );
}

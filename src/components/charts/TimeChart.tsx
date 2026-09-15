"use client";
import { useMemo, useState } from "react";
import { scaleBand, scaleLinear } from "d3-scale";
import { line as d3line, curveLinear } from "d3-shape";
import { useTooltip } from "@/lib/ui/tooltip";
import { useTweenArray } from "@/lib/ui/tween";
import { formatDate, formatNumber } from "@/lib/engine/format";
import { catVar } from "@/lib/ui/colors";
import { roundedTop } from "./HBars";
import { useSize } from "./useSize";

export interface TimeSeriesDef { label: string; kind: "bar" | "line"; values: (number | null)[] }

export function TimeChart({ times, series, unit, format = "integer", currency, onSelect, selected }: { times: number[]; series: TimeSeriesDef[]; unit: "week" | "month" | "day"; format?: "integer" | "decimal" | "currency" | "percent" | "days"; currency?: string; onSelect?: (t: number) => void; selected?: number | null }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const tip = useTooltip();
  const [hover, setHover] = useState<number | null>(null);
  const m = { top: 10, right: 12, bottom: 24, left: 34 };
  const W = Math.max(0, size.width), H = Math.max(0, size.height);
  const iw = Math.max(10, W - m.left - m.right), ih = Math.max(10, H - m.top - m.bottom);
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const x = scaleBand<number>().domain(times).range([0, iw]).paddingInner(0.35).paddingOuter(0.15);
  const y = scaleLinear().domain([0, niceMax(max)]).range([ih, 0]).nice(4);
  const bars = series.filter((s) => s.kind === "bar");
  const lines = series.filter((s) => s.kind === "line");
  const flatBars = useMemo(() => bars.flatMap((s) => s.values.map((v) => v ?? 0)), [bars]);
  const tb = useTweenArray(flatBars);
  const flatLines = useMemo(() => lines.flatMap((s) => s.values.map((v) => v ?? 0)), [lines]);
  const tl = useTweenArray(flatLines);
  const ticks = y.ticks(4);
  const bw = Math.min(24, x.bandwidth() / Math.max(1, bars.length));
  const colorOf = (i: number) => (i === 0 ? "var(--accent)" : catVar(i));
  const labelEvery = Math.max(1, Math.ceil(times.length / Math.max(1, Math.floor(iw / 56))));
  return (
    <div ref={ref} className="h-full w-full">
      {W > 0 && H > 0 && (
        <svg width={W} height={H} className="block" role="img" aria-label="Time series chart">
          <g transform={`translate(${m.left},${m.top})`}>
            {ticks.map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line x1={0} x2={iw} stroke="var(--line)" strokeWidth={1} />
                <text x={-8} dominantBaseline="middle" textAnchor="end" fontSize={12} className="num fill-[var(--ink-3)]">{formatNumber(t, format === "percent" ? "percent" : "integer", currency, true)}</text>
              </g>
            ))}
            {times.map((t, i) => {
              const bx = x(t) ?? 0;
              const isHover = hover === i;
              const isSel = selected === t;
              return (
                <g key={t}>
                  <rect x={bx - x.step() * x.paddingInner() / 2} y={0} width={x.step()} height={ih} fill={isHover || isSel ? "var(--accent-wash)" : "transparent"} className="cursor-pointer"
                    onPointerEnter={(e) => { setHover(i); tip.show(e, { title: labelFor(t, unit), rows: series.map((s, si) => ({ label: s.label, value: formatNumber(s.values[i], format, currency), color: s.kind === "bar" ? colorOf(si) : "var(--ink)" })) }); }}
                    onPointerMove={tip.move}
                    onPointerLeave={() => { setHover(null); tip.hide(); }}
                    onClick={() => onSelect?.(t)} />
                  {bars.map((s, si) => {
                    const v = tb[si * times.length + i] ?? 0;
                    const h = ih - y(v);
                    const offset = bx + (x.bandwidth() - bw * bars.length - 2 * (bars.length - 1)) / 2 + si * (bw + 2);
                    return <path key={s.label} d={roundedTop(offset, y(v), bw, h, 4)} fill={colorOf(si)} opacity={selected !== null && selected !== undefined && !isSel ? 0.4 : 1} className="pointer-events-none transition-opacity duration-150" />;
                  })}
                  {i % labelEvery === 0 && (
                    <text x={bx + x.bandwidth() / 2} y={ih + 15} textAnchor="middle" fontSize={12} className="num fill-[var(--ink-3)] pointer-events-none">{labelFor(t, unit, true)}</text>
                  )}
                </g>
              );
            })}
            {lines.map((s, li) => {
              const pts = times.map((t, i) => [ (x(t) ?? 0) + x.bandwidth() / 2, y(tl[li * times.length + i] ?? 0)] as [number, number]);
              const path = d3line<[number, number]>().x((p) => p[0]).y((p) => p[1]).curve(curveLinear)(pts) ?? "";
              return (
                <g key={s.label} className="pointer-events-none">
                  <path d={path} fill="none" stroke="var(--ink)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={hover === i ? 5 : 4} fill="var(--ink)" stroke="var(--bg)" strokeWidth={2} />)}
                </g>
              );
            })}
            <line x1={0} x2={iw} y1={ih} y2={ih} stroke="var(--line-strong)" strokeWidth={1} />
          </g>
        </svg>
      )}
    </div>
  );
}

function niceMax(v: number): number {
  if (v <= 5) return 5;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / p) * p;
}

export function labelFor(t: number, unit: "week" | "month" | "day", short = false): string {
  if (unit === "month") return formatDate(t, "month");
  if (unit === "day") return formatDate(t, short ? "week" : "long");
  return short ? formatDate(t, "week") : `Week of ${formatDate(t, "long")}`;
}

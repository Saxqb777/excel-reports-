"use client";
import { useId } from "react";
import { area as d3area, line as d3line, curveMonotoneX } from "d3-shape";
import { scaleLinear } from "d3-scale";

export function Sparkline({ values, width = 84, height = 24, accentLast = true }: { values: (number | null)[]; width?: number; height?: number; accentLast?: boolean }) {
  const id = useId();
  const pts = values.map((v, i) => [i, v] as [number, number | null]);
  const valid = pts.filter((p): p is [number, number] => p[1] !== null);
  if (valid.length < 2) return <svg width={width} height={height} aria-hidden />;
  const x = scaleLinear().domain([0, values.length - 1]).range([2, width - 4]);
  const max = Math.max(...valid.map((p) => p[1]), 1);
  const y = scaleLinear().domain([0, max]).range([height - 3, 3]);
  const ln = d3line<[number, number]>().x((p) => x(p[0])).y((p) => y(p[1])).curve(curveMonotoneX);
  const ar = d3area<[number, number]>().x((p) => x(p[0])).y0(height - 2).y1((p) => y(p[1])).curve(curveMonotoneX);
  const last = valid[valid.length - 1];
  return (
    <svg width={width} height={height} aria-hidden className="block overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--spark)" stopOpacity="0.28" />
          <stop offset="1" stopColor="var(--spark)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={ar(valid) ?? ""} fill={`url(#${id})`} />
      <path d={ln(valid) ?? ""} fill="none" stroke="var(--spark)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {accentLast && <circle cx={x(last[0])} cy={y(last[1])} r={3} fill="var(--accent)" stroke="var(--bg)" strokeWidth={2} />}
    </svg>
  );
}

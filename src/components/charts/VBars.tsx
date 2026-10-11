"use client";
import { useMemo } from "react";
import { scaleBand, scaleLinear } from "d3-scale";
import { useTooltip } from "@/lib/ui/tooltip";
import { useTweenArray } from "@/lib/ui/tween";
import { formatNumber, pct } from "@/lib/engine/format";
import { stackColor } from "@/lib/ui/colors";
import { useSize } from "./useSize";
import { roundedTop, type HBarsProps } from "./HBars";

const AXIS_H = 22;
const LABEL_H = 18;
const CHAR_W = 7;

/** Columns, optionally stacked, for a few ordered categories (months): same props and interactions as HBars. */
export function VBars({ rows, stackKeys, colorBy = "single", format = "integer", currency, selected, onSelect, total }: HBarsProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const tip = useTooltip();
  const keys = useMemo(() => stackKeys ?? [], [stackKeys]);
  const flat = useMemo(() => rows.flatMap((r) => (keys.length ? keys.map((k) => r.stacks?.[k] ?? 0) : [r.value])), [rows, keys]);
  const tweened = useTweenArray(flat);
  const colorIndex = new Map(keys.map((k, i) => [k, i]));
  const sum = total ?? rows.reduce((a, r) => a + r.value, 0);
  const w = Math.max(80, size.width), h = Math.max(80, size.height);
  const plotH = h - AXIS_H - LABEL_H;
  const x = scaleBand<string>().domain(rows.map((r) => r.key)).range([0, w]).paddingInner(0.28).paddingOuter(0.12);
  const max = Math.max(format === "percent" ? 1 : 0, ...rows.map((r) => r.value), 1e-9);
  const y = scaleLinear().domain([0, max]).range([0, plotH]);
  const bw = Math.min(56, x.bandwidth());
  const maxChars = Math.max(3, Math.floor(x.step() / CHAR_W));
  // Narrow columns: "Sep" instead of "Sep 2026", and values without the currency code.
  const label = (k: string) => (k.length <= maxChars ? k : /^[A-Za-z]{3} \d{4}$/.test(k) ? k.slice(0, 3) : k.slice(0, maxChars - 1) + "…");
  const valueFormat = format === "currency" && x.step() < 72 ? "compact" : format;
  const anySelected = Boolean(selected?.key);
  return (
    <div ref={ref} className="h-full w-full overflow-hidden">
      {size.width > 0 && (
        <svg width={w} height={h} className="block" role="img" aria-label="Column chart">
          <line x1={0} x2={w} y1={LABEL_H + plotH + 0.5} y2={LABEL_H + plotH + 0.5} stroke="var(--line)" />
          {rows.map((r, ri) => {
            const bx = (x(r.key) ?? 0) + (x.bandwidth() - bw) / 2;
            const isSel = selected?.key === r.key;
            const segs = keys.length ? keys.map((k, ki) => ({ k, v: tweened[ri * keys.length + ki] ?? 0, ki })) : [{ k: r.key, v: tweened[ri] ?? 0, ki: 0 }];
            const visible = segs.filter((s) => s.v > 0);
            let cursor = 0;
            const top = LABEL_H + plotH - y(segs.reduce((a, s) => a + Math.max(0, s.v), 0));
            return (
              <g key={r.key} opacity={anySelected && !isSel ? 0.35 : 1} style={{ transition: "opacity 160ms ease" }}>
                <rect x={x(r.key) ?? 0} y={LABEL_H} width={x.bandwidth()} height={plotH} fill="transparent" className="cursor-pointer" onClick={() => onSelect?.(r.key)} />
                {visible.map((s, si) => {
                  const segH = Math.max(0, y(s.v) - (cursor > 0 ? 2 : 0));
                  const sy = LABEL_H + plotH - cursor - y(s.v);
                  cursor += y(s.v);
                  const color = keys.length ? stackColor(s.k, colorIndex.get(s.k) ?? s.ki, colorBy) : stackColor(r.key, ri, colorBy);
                  return (
                    <path key={s.k} d={roundedTop(bx, sy, bw, segH, si === visible.length - 1 ? 3 : 0)} fill={color}
                      opacity={isSel && selected?.stack && selected.stack !== s.k ? 0.35 : 1} className="cursor-pointer transition-opacity duration-150"
                      onClick={(e) => { e.stopPropagation(); onSelect?.(r.key, keys.length ? s.k : undefined); }}
                      onPointerEnter={(e) => tip.show(e, { title: r.key, rows: [
                        ...(keys.length ? keys.map((k, ki) => ({ label: k, value: formatNumber(r.stacks?.[k] ?? 0, format, currency), color: stackColor(k, ki, colorBy), muted: k !== s.k })) : []),
                        { label: keys.length ? "Total" : "Value", value: formatNumber(r.value, format, currency) },
                        ...(sum && format !== "percent" ? [{ label: "Share", value: pct(r.value, sum), muted: true }] : []),
                      ] })}
                      onPointerMove={tip.move} onPointerLeave={tip.hide} />
                  );
                })}
                {r.value !== 0 && <text x={bx + bw / 2} y={top - 5} textAnchor="middle" className="num fill-[var(--ink)]" fontSize={12.5} fontWeight={500}>{formatNumber(r.value, valueFormat, currency, true)}</text>}
                <text x={(x(r.key) ?? 0) + x.bandwidth() / 2} y={h - 6} textAnchor="middle" className="fill-[var(--ink-2)]" fontSize={12.5} style={{ fontFamily: "var(--font-ui)" }}>
                  {label(r.key)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

"use client";
import { useMemo } from "react";
import { scaleLinear } from "d3-scale";
import { useTooltip } from "@/lib/ui/tooltip";
import { useTweenArray } from "@/lib/ui/tween";
import { formatNumber, pct } from "@/lib/engine/format";
import { stackColor } from "@/lib/ui/colors";
import { useSize } from "./useSize";

export interface HBarRow { key: string; value: number; count: number; stacks?: Record<string, number> }

export interface HBarsProps {
  rows: HBarRow[];
  stackKeys?: string[];
  colorBy?: "single" | "status" | "categorical";
  format?: "integer" | "decimal" | "currency" | "percent" | "days";
  currency?: string;
  selected?: { key?: string; stack?: string } | null;
  dimmed?: boolean;
  onSelect?: (key: string, stack?: string) => void;
  labelWidth?: number;
  /** Total used for share-of column; defaults to sum of rows. */
  total?: number;
  showShare?: boolean;
}

const ROW_H = 26;
const BAR_H = 14;

const CHAR_W = 6.6;

export function HBars({ rows, stackKeys, colorBy = "single", format = "integer", currency, selected, onSelect, labelWidth: labelWidthProp, total, showShare = true }: HBarsProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const tip = useTooltip();
  const longest = rows.reduce((a, r) => Math.max(a, r.key.length), 0);
  const labelWidth = labelWidthProp ?? Math.min(Math.max(72, longest * CHAR_W + 14), Math.max(90, size.width * 0.42));
  const maxChars = Math.max(6, Math.floor((labelWidth - 14) / CHAR_W));
  const max = Math.max(1, ...rows.map((r) => r.value));
  const sum = total ?? rows.reduce((a, r) => a + r.value, 0);
  const valueW = 64;
  const shareW = showShare ? 40 : 0;
  const plotW = Math.max(40, size.width - labelWidth - valueW - shareW - 8);
  const x = scaleLinear().domain([0, max]).range([0, plotW]);
  const keys = stackKeys ?? [];
  const flat = useMemo(() => rows.flatMap((r) => (keys.length ? keys.map((k) => r.stacks?.[k] ?? 0) : [r.value])), [rows, keys]);
  const tweened = useTweenArray(flat);
  const colorIndex = new Map(keys.map((k, i) => [k, i]));
  const anySelected = Boolean(selected?.key);
  return (
    <div ref={ref} className="h-full w-full overflow-y-auto overflow-x-hidden">
      <svg width="100%" height={rows.length * ROW_H + 4} className="block" role="img" aria-label="Bar chart">
        {rows.map((r, ri) => {
          const y = ri * ROW_H + 2;
          const isSel = selected?.key === r.key;
          const rowDim = anySelected && !isSel;
          let cursor = 0;
          const segs = keys.length ? keys.map((k, ki) => ({ k, v: tweened[ri * keys.length + ki] ?? 0, raw: r.stacks?.[k] ?? 0, ki })) : [{ k: r.key, v: tweened[ri] ?? 0, raw: r.value, ki: 0 }];
          return (
            <g key={r.key} transform={`translate(0,${y})`} opacity={rowDim ? 0.35 : 1} style={{ transition: "opacity 160ms ease" }}>
              <text x={labelWidth - 10} y={ROW_H / 2} dominantBaseline="middle" textAnchor="end" className="fill-[var(--ink-2)]" fontSize={12} style={{ fontFamily: "var(--font-ui)" }}>
                {r.key.length > maxChars ? r.key.slice(0, maxChars - 1) + "…" : r.key}
              </text>
              <rect x={labelWidth} y={(ROW_H - BAR_H) / 2} width={plotW} height={BAR_H} fill="transparent" className="cursor-pointer" onClick={() => onSelect?.(r.key)} />
              {segs.map((s) => {
                if (s.v <= 0) return null;
                const w = Math.max(0, x(s.v) - (cursor > 0 ? 2 : 0));
                const sx = labelWidth + cursor + (cursor > 0 ? 2 : 0);
                cursor += x(s.v);
                const isLast = s === segs.filter((q) => q.v > 0).slice(-1)[0];
                const color = keys.length ? stackColor(s.k, colorIndex.get(s.k) ?? s.ki, colorBy) : stackColor(r.key, ri, colorBy === "categorical" ? "categorical" : "single");
                const segSel = isSel && (!selected?.stack || selected.stack === s.k);
                return (
                  <path
                    key={s.k}
                    d={roundedRight(sx, (ROW_H - BAR_H) / 2, w, BAR_H, isLast ? 4 : 0)}
                    fill={color}
                    opacity={isSel && selected?.stack && selected.stack !== s.k ? 0.35 : 1}
                    className="cursor-pointer transition-opacity duration-150"
                    style={{ filter: segSel ? "brightness(1.15)" : undefined }}
                    onClick={(e) => { e.stopPropagation(); onSelect?.(r.key, keys.length ? s.k : undefined); }}
                    onPointerEnter={(e) => tip.show(e, { title: r.key, rows: [
                      ...(keys.length ? keys.map((k, ki) => ({ label: k, value: formatNumber(r.stacks?.[k] ?? 0, format, currency), color: stackColor(k, ki, colorBy), muted: k !== s.k })) : []),
                      { label: keys.length ? "Total" : "Value", value: formatNumber(r.value, format, currency) },
                      ...(sum ? [{ label: "Share", value: pct(r.value, sum), muted: true }] : []),
                    ] })}
                    onPointerMove={tip.move}
                    onPointerLeave={tip.hide}
                  />
                );
              })}
              <text x={labelWidth + plotW + 8} y={ROW_H / 2} dominantBaseline="middle" className="num fill-[var(--ink)]" fontSize={11.5} fontWeight={500}>
                {formatNumber(r.value, format, currency, true)}
              </text>
              {showShare && sum > 0 && (
                <text x={labelWidth + plotW + valueW + shareW - 4} y={ROW_H / 2} dominantBaseline="middle" textAnchor="end" className="num fill-[var(--ink-3)]" fontSize={11}>
                  {pct(r.value, sum)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function roundedRight(x: number, y: number, w: number, h: number, r: number): string {
  if (w <= 0) return "";
  const rr = Math.min(r, w / 2, h / 2);
  if (rr <= 0) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y}h${w - rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - 2 * rr}a${rr},${rr} 0 0 1 ${-rr},${rr}h${-(w - rr)}z`;
}

export function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h / 2);
  if (rr <= 0) return `M${x},${y}h${w}v${h}h${-w}z`;
  return `M${x},${y + rr}a${rr},${rr} 0 0 1 ${rr},${-rr}h${w - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - rr}h${-w}z`;
}

export function Legend({ keys, colorBy = "status", onToggle, active }: { keys: string[]; colorBy?: "single" | "status" | "categorical"; onToggle?: (k: string) => void; active?: string | null }) {
  if (keys.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {keys.map((k, i) => (
        <button key={k} type="button" onClick={() => onToggle?.(k)} className={`flex items-center gap-1.5 text-[11px] ${active && active !== k ? "text-ink-4" : "text-ink-2"} ${onToggle ? "cursor-pointer hover:text-ink" : "cursor-default"}`}>
          <span className="inline-block h-[8px] w-[8px]" style={{ background: stackColor(k, i, colorBy) }} />
          {k}
        </button>
      ))}
    </div>
  );
}

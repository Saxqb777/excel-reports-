"use client";
import { useMemo, useState } from "react";
import type { WaterfallWidget } from "@/lib/dashboard/types";
import { computeMetric } from "@/lib/engine/metrics";
import { formatNumber } from "@/lib/engine/format";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { useTooltip } from "@/lib/ui/tooltip";
import { useTweenArray } from "@/lib/ui/tween";
import { useSize } from "@/components/charts/useSize";
import { Tile, DataTable } from "./Tile";
import { segmentColor } from "./segments";

interface Step { label: string; value: number; start: number; end: number; kind: "base" | "add" | "total"; color: string }

/** Floating bars from a base through each addition to a total: cost of goods, then every logistics cost group, then landed cost. */
export function WaterfallTile({ w }: { w: WaterfallWidget }) {
  const { snapshot, maskFor } = useDashboard();
  const tip = useTooltip();
  const [ref, size] = useSize<HTMLDivElement>();
  const [table, setTable] = useState(false);
  const mask = maskFor(w.id);
  const currency = w.steps.find((s) => s.metric?.currency)?.metric?.currency ?? "AED";
  const fmt = w.steps.find((s) => s.metric?.format)?.metric?.format ?? "currency";
  const steps = useMemo<Step[]>(() => {
    let run = 0, addIndex = 0;
    const out: Step[] = [];
    for (const s of w.steps) {
      const kind = s.kind ?? "add";
      if (kind === "total") { const v = s.metric ? computeMetric(snapshot, mask, s.metric) ?? run : run; out.push({ label: s.label, value: v, start: 0, end: v, kind, color: "var(--ink)" }); continue; }
      const v = s.metric ? computeMetric(snapshot, mask, s.metric) ?? 0 : 0;
      if (kind === "base") { out.push({ label: s.label, value: v, start: 0, end: v, kind, color: "var(--c1)" }); run = v; continue; }
      out.push({ label: s.label, value: v, start: run, end: run + v, kind, color: segmentColor(s.label, addIndex + 1) });
      addIndex++;
      run += v;
    }
    return out;
  }, [snapshot, mask, w.steps]);
  const tw = useTweenArray(steps.flatMap((s) => [s.start, s.end]));
  const base = steps.find((s) => s.kind === "base")?.value ?? 0;
  const total = steps.find((s) => s.kind === "total")?.value ?? steps[steps.length - 1]?.end ?? 0;
  const max = Math.max(1, ...steps.map((s) => Math.max(s.start, s.end)));
  const W = Math.max(10, size.width), H = Math.max(10, size.height);
  const n0 = w.steps.length;
  const narrow = (W - 16) / Math.max(1, n0) < 92;
  const padL = 8, padR = 8, padT = 26, padB = narrow ? 56 : 40;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = steps.length;
  const slot = innerW / Math.max(1, n);
  const barW = Math.min(72, slot * 0.62);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  return (
    <Tile title={w.title} subtitle={w.subtitle} tableActive={table} onToggleTable={() => setTable((t) => !t)} padded={false}>
      {table ? (
        <div className="h-full px-3.5 pb-3"><DataTable columns={["Step", "Amount", "Of landed cost", "On top of goods"]} rows={steps.map((s) => [s.label, formatNumber(s.value, fmt, currency), total ? `${Math.round((s.value / total) * 100)}%` : "–", s.kind === "add" && base ? `+${Math.round((s.value / base) * 100)}%` : "–"])} /></div>
      ) : (
        <div ref={ref} className="h-full w-full px-2 pb-1">
          {size.width > 0 && (
            <svg width={W} height={H} className="block" role="img" aria-label={w.title}>
              {steps.map((s, i) => {
                const start = tw[i * 2] ?? s.start, end = tw[i * 2 + 1] ?? s.end;
                const x = padL + slot * i + (slot - barW) / 2;
                const top = y(Math.max(start, end)), bottom = y(Math.min(start, end));
                const h = Math.max(1.5, bottom - top);
                const next = steps[i + 1];
                return (
                  <g key={s.label} onPointerEnter={(e) => tip.show(e, { title: s.label, rows: [{ label: "Amount", value: formatNumber(s.value, fmt, currency) }, ...(s.kind === "add" && base ? [{ label: "On top of goods", value: `+${(s.value / base * 100).toFixed(1)}%` }] : []), ...(total ? [{ label: "Of landed cost", value: `${Math.round((s.value / total) * 100)}%` }] : [])] })} onPointerMove={tip.move} onPointerLeave={tip.hide}>
                    <rect x={x} y={top} width={barW} height={h} rx={5} fill={s.color} fillOpacity={s.kind === "total" ? 0.92 : 0.88} />
                    {next && next.kind !== "total" && <line x1={x + barW} x2={padL + slot * (i + 1) + (slot - barW) / 2} y1={y(end)} y2={y(end)} stroke="var(--line-strong)" strokeDasharray="3 3" />}
                    {next && next.kind === "total" && <line x1={x + barW} x2={padL + slot * (i + 1) + (slot - barW) / 2} y1={y(end)} y2={y(end)} stroke="var(--line-strong)" strokeDasharray="3 3" />}
                    <text x={x + barW / 2} y={top - 7} textAnchor="middle" fontSize={narrow ? 11.5 : 13} fontWeight={700} fill="var(--ink)" style={{ fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums" }}>{formatNumber(s.value, fmt, currency, true).replace(/^AED\s/, narrow ? "" : "AED ")}</text>
                    {/* Narrow: labels alternate between two rows so neighbours never collide. */}
                    <text x={x + barW / 2} y={H - padB + 16 + (narrow && i % 2 ? 14 : 0)} textAnchor="middle" fontSize={narrow ? 11 : 13} fill="var(--ink-2)" style={{ fontFamily: "var(--font-ui)" }}>{narrow && s.label.length > 14 ? `${s.label.slice(0, 13)}…` : s.label}</text>
                    {s.kind === "add" && base > 0 && <text x={x + barW / 2} y={H - padB + (narrow ? 44 : 31)} textAnchor="middle" fontSize={11.5} fill="var(--ink-3)" style={{ fontFamily: "var(--font-num)" }}>+{(s.value / base * 100).toFixed(1)}%</text>}
                    {s.kind === "total" && base > 0 && <text x={x + barW / 2} y={H - padB + (narrow ? 44 : 31)} textAnchor="middle" fontSize={11.5} fill="var(--ink-3)" style={{ fontFamily: "var(--font-num)" }}>goods +{Math.round(((total - base) / base) * 100)}%</text>}
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

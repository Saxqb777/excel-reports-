"use client";
import { scaleLinear } from "d3-scale";
import { useTooltip } from "@/lib/ui/tooltip";
import { useTweenArray } from "@/lib/ui/tween";
import { formatNumber, pct } from "@/lib/engine/format";
import { toneVar, type Tone } from "@/lib/ui/colors";
import { roundedRight } from "./HBars";
import { useSize } from "./useSize";

export interface FunnelStage { label: string; value: number; tone: Tone; sub?: boolean }

export function Funnel({ stages, selected, onSelect }: { stages: FunnelStage[]; selected?: string | null; onSelect?: (label: string) => void }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const tip = useTooltip();
  const top = Math.max(1, stages[0]?.value ?? 1);
  const labelW = 96, valueW = 44, shareW = 44;
  const plotW = Math.max(40, size.width - labelW - valueW - shareW - 12);
  const x = scaleLinear().domain([0, top]).range([0, plotW]);
  const vals = useTweenArray(stages.map((s) => s.value));
  const rowH = Math.max(30, Math.min(44, (size.height - 8) / Math.max(1, stages.length)));
  const barH = Math.min(20, rowH - 12);
  return (
    <div ref={ref} className="h-full w-full">
      <svg width="100%" height={stages.length * rowH + 4} className="block" role="img" aria-label="Pipeline funnel">
        {stages.map((s, i) => {
          const y = i * rowH + 2;
          const isSel = selected === s.label;
          const dim = selected && !isSel;
          const w = x(vals[i] ?? 0);
          const prev = i > 0 ? stages[i - 1].value : null;
          return (
            <g key={s.label} transform={`translate(0,${y})`} opacity={dim ? 0.4 : 1} className="cursor-pointer" style={{ transition: "opacity 160ms ease" }}
              onClick={() => onSelect?.(s.label)}
              onPointerEnter={(e) => tip.show(e, { title: s.label, rows: [{ label: "Count", value: formatNumber(s.value) }, { label: "Of received", value: pct(s.value, top), muted: true }, ...(prev !== null && !s.sub ? [{ label: "Of previous stage", value: pct(s.value, prev), muted: true }] : [])] })}
              onPointerMove={tip.move} onPointerLeave={tip.hide}>
              <rect x={0} y={0} width="100%" height={rowH} fill="transparent" />
              <text x={labelW - 10} y={rowH / 2} dominantBaseline="middle" textAnchor="end" fontSize={13.5} className={s.sub ? "fill-[var(--ink-3)]" : "fill-[var(--ink)]"} style={{ fontFamily: "var(--font-ui)", fontWeight: s.sub ? 400 : 500 }}>
                {s.sub ? "\u21B3 " : ""}{s.label}
              </text>
              <rect x={labelW} y={(rowH - barH) / 2} width={plotW} height={barH} fill="var(--bg-sunk)" />
              <path d={roundedRight(labelW, (rowH - barH) / 2, w, barH, 4)} fill={toneVar(s.tone)} style={{ filter: isSel ? "brightness(1.15)" : undefined }} />
              <text x={labelW + plotW + 8} y={rowH / 2} dominantBaseline="middle" fontSize={13.5} fontWeight={500} className="num fill-[var(--ink)]">{formatNumber(s.value)}</text>
              <text x={labelW + plotW + valueW + shareW - 2} y={rowH / 2} dominantBaseline="middle" textAnchor="end" fontSize={12.5} className="num fill-[var(--ink-3)]">{i === 0 ? "" : pct(s.value, top)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

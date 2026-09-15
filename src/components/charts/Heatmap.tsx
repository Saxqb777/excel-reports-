"use client";
import { useTooltip } from "@/lib/ui/tooltip";
import { formatNumber } from "@/lib/engine/format";
import { seqVar } from "@/lib/ui/colors";

export const cellKey = (r: string, c: string) => `${r}||${c}`;

export function Heatmap({ rows, cols, cells, format = "integer", currency, onSelect }: { rows: string[]; cols: string[]; cells: Record<string, number>; format?: "integer" | "decimal" | "currency" | "percent" | "days"; currency?: string; onSelect?: (row: string, col: string) => void }) {
  const tip = useTooltip();
  const max = Math.max(1, ...Object.values(cells));
  const step = (v: number) => (v <= 0 ? 0 : 1 + Math.min(6, Math.floor((v / max) * 6.999)));
  return (
    <div className="h-full w-full overflow-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th className="sticky left-0 bg-bg p-1 text-left"></th>
            {cols.map((c) => <th key={c} className="label p-1 pb-2 text-left font-medium">{c}</th>)}
            <th className="label p-1 pb-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const total = cols.reduce((a, c) => a + (cells[cellKey(r, c)] ?? 0), 0);
            return (
              <tr key={r}>
                <td className="sticky left-0 bg-bg py-[3px] pr-3 text-ink-2 whitespace-nowrap">{r}</td>
                {cols.map((c) => {
                  const v = cells[cellKey(r, c)] ?? 0;
                  const s = step(v);
                  const dark = s >= 5;
                  return (
                    <td key={c} className="p-[1px]">
                      <div className="num flex h-7 cursor-pointer items-center justify-end px-2 text-[11.5px]" style={{ background: s === 0 ? "var(--bg-sunk)" : seqVar(s), color: s === 0 ? "var(--ink-4)" : dark ? "var(--bg)" : "var(--ink)" }}
                        onClick={() => onSelect?.(r, c)}
                        onPointerEnter={(e) => tip.show(e, { title: `${r} / ${c}`, rows: [{ label: "Value", value: formatNumber(v, format, currency) }] })} onPointerMove={tip.move} onPointerLeave={tip.hide}>
                        {v ? formatNumber(v, format, currency, true) : "·"}
                      </div>
                    </td>
                  );
                })}
                <td className="num py-[3px] pl-3 text-right font-medium">{formatNumber(total, format, currency, true)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

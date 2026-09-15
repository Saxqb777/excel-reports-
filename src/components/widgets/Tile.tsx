"use client";
import { createContext, useContext, type ReactNode } from "react";

export interface TileActions { expand?: () => void; toggleTable?: () => void; tableActive?: boolean; hide?: () => void; editing?: boolean }
const TileCtx = createContext<TileActions>({});
export const TileActionsProvider = TileCtx.Provider;
export const useTileActions = () => useContext(TileCtx);

export function Tile({ title, subtitle, right, children, onClear, selected, padded = true, tableActive, onToggleTable }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode; onClear?: () => void; selected?: boolean; padded?: boolean; tableActive?: boolean; onToggleTable?: () => void }) {
  const ctx = useTileActions();
  const actions: TileActions = { ...ctx, toggleTable: onToggleTable ?? ctx.toggleTable, tableActive: tableActive ?? ctx.tableActive };
  return (
    <section className="tile h-full w-full" aria-label={title}>
      <header className="flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-0 px-3.5">
        <div className="flex min-w-0 flex-auto items-baseline gap-2">
          <h3 className="label-strong truncate">{title}</h3>
          {subtitle && <span className="truncate text-[14px] text-ink-3">{subtitle}</span>}
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          {selected && onClear && (
            <button type="button" onClick={onClear} className="chip chip-on h-[18px] px-1.5 text-[14px]" title="Clear this selection">filtering ×</button>
          )}
          {right}
          <div className="tile-actions flex items-center gap-1">
            {actions.toggleTable && <button type="button" className={`chip h-[18px] px-1.5 text-[14px] ${actions.tableActive ? "chip-on" : ""}`} onClick={actions.toggleTable} title={actions.tableActive ? "Back to the chart" : "Show as a table"}>{actions.tableActive ? "chart" : "table"}</button>}
            {actions.expand && <button type="button" className="chip h-[18px] px-1.5 text-[14px]" onClick={actions.expand} title="Expand">⤢</button>}
            {actions.editing && actions.hide && <button type="button" className="chip h-[18px] px-1.5 text-[14px] hover:border-neg hover:text-neg" onClick={actions.hide} title="Hide this tile">hide</button>}
          </div>
        </div>
      </header>
      <div className={`min-h-0 flex-1 ${padded ? "px-3.5 pb-3" : ""}`}>{children}</div>
    </section>
  );
}

/** Table twin for any chart: the same numbers, readable without colour or hover. */
export function DataTable({ columns, rows }: { columns: string[]; rows: (string | number | null)[][] }) {
  return (
    <div className="h-full w-full overflow-auto">
      <table className="w-full border-collapse text-[14.5px]">
        <thead className="sticky top-0 bg-bg">
          <tr>{columns.map((c, i) => <th key={c} className={`label border-b border-line px-2 py-1 font-medium ${i === 0 ? "text-left" : "text-right"}`}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="border-b border-line last:border-0">
              {r.map((v, ci) => <td key={ci} className={`px-2 py-[4px] ${ci === 0 ? "text-ink-2" : "num text-right text-ink"}`}>{v === null ? "·" : String(v)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

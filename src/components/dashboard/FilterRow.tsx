"use client";
import { useMemo } from "react";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { distinctValues } from "@/lib/engine/metrics";
import { formatDate } from "@/lib/engine/format";

const DAY = 86_400_000;
const PRESETS: { id: string; label: string; days?: number }[] = [
  { id: "all", label: "All" }, { id: "30", label: "30d", days: 30 }, { id: "90", label: "90d", days: 90 }, { id: "365", label: "12m", days: 365 },
];

export function FilterRow() {
  const { snapshot, layout, state, dispatch, fields, now } = useDashboard();
  const selects = layout.filters.filter((f) => f.kind === "select");
  const search = layout.filters.find((f) => f.kind === "search");
  const options = useMemo(() => Object.fromEntries(selects.map((s) => [s.field, distinctValues(snapshot, s.field)])), [snapshot, selects]);
  const dateField = layout.dateField ? fields.get(layout.dateField) : undefined;
  const setPreset = (id: string, days?: number) => {
    if (!days) return dispatch({ type: "date", range: { from: null, to: null, preset: id } });
    const to = Math.floor(now / DAY) * DAY + DAY - 1;
    dispatch({ type: "date", range: { from: to - days * DAY, to, preset: id } });
  };
  const active = state.selections.length + Object.keys(state.controls).length + (state.search ? 1 : 0) + (state.dateRange.preset !== "all" ? 1 : 0);
  return (
    <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line bg-bg px-3 py-1.5">
      {dateField && (
        <div className="flex items-center gap-1.5">
          <span className="label">{dateField.label}</span>
          <div className="flex">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" className={`chip -ml-px first:ml-0 ${state.dateRange.preset === p.id ? "chip-on" : ""}`} onClick={() => setPreset(p.id, p.days)}>{p.label}</button>
            ))}
          </div>
        </div>
      )}
      {selects.map((s) => {
        const f = fields.get(s.field);
        const opts = options[s.field] ?? [];
        const ordered = f?.order ? [...f.order.map((o) => opts.find((x) => x.value === o)).filter((x): x is { value: string; count: number } => Boolean(x)), ...opts.filter((o) => !f.order!.includes(o.value))] : opts;
        const current = state.controls[s.field]?.[0] ?? "";
        return (
          <label key={s.field} className="flex items-center gap-1.5">
            <span className="label">{s.label ?? f?.label ?? s.field}</span>
            <select className="field h-[22px] py-0 pr-6 text-[11px]" value={current} onChange={(e) => dispatch({ type: "control", field: s.field, values: e.target.value ? [e.target.value] : [] })}>
              <option value="">Any</option>
              {ordered.map((o) => <option key={o.value} value={o.value}>{o.value} ({o.count})</option>)}
            </select>
          </label>
        );
      })}
      {search && (
        <input className="field h-[22px] w-44 text-[11px]" placeholder={`Search ${search.label?.toLowerCase() === "search" ? "" : search.label ?? ""}`.trim() + "…"} value={state.search} onChange={(e) => dispatch({ type: "search", value: e.target.value })} aria-label="Search rows" />
      )}
      <div className="ml-auto flex items-center gap-2">
        {state.selections.map((s) => (
          <button key={s.widgetId} type="button" className="chip chip-on" onClick={() => dispatch({ type: "clearSelection", widgetId: s.widgetId })} title="Remove this selection">
            <span className="text-ink-3">{s.field === "__kpi__" || s.field === "__funnel__" ? "" : ""}</span>{s.label} <span className="text-ink-3">×</span>
          </button>
        ))}
        {state.dateRange.preset !== "all" && state.dateRange.from !== null && (
          <span className="num text-[11px] text-ink-3">{formatDate(state.dateRange.from)} – {formatDate(state.dateRange.to)}</span>
        )}
        {active > 0 && <button type="button" className="btn h-[22px] px-2 py-0 text-[11px]" onClick={() => dispatch({ type: "reset" })}>Clear all</button>}
      </div>
    </div>
  );
}

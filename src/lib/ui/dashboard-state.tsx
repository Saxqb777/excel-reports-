"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import type { Field, FilterExpr, Snapshot } from "@/lib/schema/types";
import { buildMask } from "@/lib/engine/filters";
import type { Layout } from "@/lib/dashboard/types";

export interface Selection { widgetId: string; field: string; values: string[]; label: string; extra?: FilterExpr }
export interface DateRange { from: number | null; to: number | null; preset: string }

interface State {
  selections: Selection[];
  controls: Record<string, string[]>; // filter-row selects: field -> values
  search: string;
  dateRange: DateRange;
  /** Review mode: tables show only rows that are new or changed since the previous version. */
  changesOnly: boolean;
}

type Action =
  | { type: "toggle"; selection: Selection }
  | { type: "clearSelection"; widgetId?: string }
  | { type: "control"; field: string; values: string[] }
  | { type: "search"; value: string }
  | { type: "date"; range: DateRange }
  | { type: "changesOnly"; value: boolean }
  | { type: "reset" };

const initial: State = { selections: [], controls: {}, search: "", dateRange: { from: null, to: null, preset: "all" }, changesOnly: false };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "toggle": {
      const existing = s.selections.find((x) => x.widgetId === a.selection.widgetId);
      const same = existing && existing.field === a.selection.field && existing.values.join("|") === a.selection.values.join("|") && JSON.stringify(existing.extra) === JSON.stringify(a.selection.extra);
      const rest = s.selections.filter((x) => x.widgetId !== a.selection.widgetId);
      return { ...s, selections: same ? rest : [...rest, a.selection] };
    }
    case "clearSelection": return { ...s, selections: a.widgetId ? s.selections.filter((x) => x.widgetId !== a.widgetId) : [] };
    case "control": { const controls = { ...s.controls }; if (a.values.length) controls[a.field] = a.values; else delete controls[a.field]; return { ...s, controls }; }
    case "search": return { ...s, search: a.value };
    case "date": return { ...s, dateRange: a.range };
    case "changesOnly": return { ...s, changesOnly: a.value };
    case "reset": return initial;
  }
}

interface Ctx {
  snapshot: Snapshot;
  layout: Layout;
  fields: Map<string, Field>;
  state: State;
  dispatch: (a: Action) => void;
  /** Mask of rows passing the filter row + every selection except the given widget's own. */
  maskFor: (excludeWidgetId?: string) => Uint8Array;
  /** Mask of rows passing the filter row only (no cross-filter selections). */
  baseMask: Uint8Array;
  isSelected: (widgetId: string) => Selection | undefined;
  searchFields: string[];
  now: number;
}

const DashboardCtx = createContext<Ctx | null>(null);

function selectionExpr(sel: Selection): FilterExpr {
  // Synthetic selections (KPI tiles, funnel stages) carry their whole predicate in `extra`.
  if (sel.field.startsWith("__")) return sel.extra ?? { and: [] };
  const base: FilterExpr = sel.values.length === 1 ? { field: sel.field, op: "eq", value: sel.values[0] } : { field: sel.field, op: "in", value: sel.values };
  return sel.extra ? { and: [base, sel.extra] } : base;
}

export function DashboardProvider({ snapshot, layout, children }: { snapshot: Snapshot; layout: Layout; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { setNow(Date.now()); }, [snapshot.uploadId]);
  const fields = useMemo(() => new Map(snapshot.fields.map((f) => [f.id, f])), [snapshot.fields]);
  const searchFields = useMemo(() => layout.filters.filter((f) => f.kind === "search").map((f) => f.field), [layout.filters]);

  const rowFilters = useMemo<FilterExpr[]>(() => {
    const out: FilterExpr[] = [];
    for (const [field, values] of Object.entries(state.controls)) out.push({ field, op: "in", value: values });
    if (layout.dateField && (state.dateRange.from !== null || state.dateRange.to !== null)) out.push({ field: layout.dateField, op: "between", value: [state.dateRange.from, state.dateRange.to] });
    if (state.search.trim()) {
      const q = state.search.trim();
      const textFields = snapshot.fields.filter((f) => f.type === "string").map((f) => f.id);
      out.push({ or: (searchFields.length ? [...new Set([...searchFields, ...textFields])] : textFields).map((field) => ({ field, op: "contains", value: q })) });
    }
    return out;
  }, [state.controls, state.dateRange, state.search, layout.dateField, searchFields, snapshot.fields]);

  const baseMask = useMemo(() => buildMask(snapshot.columns, snapshot.n, rowFilters), [snapshot, rowFilters]);

  const maskFor = useCallback((excludeWidgetId?: string) => {
    const sels = state.selections.filter((s) => s.widgetId !== excludeWidgetId);
    if (sels.length === 0) return baseMask;
    return buildMask(snapshot.columns, snapshot.n, [...rowFilters, ...sels.map(selectionExpr)]);
  }, [state.selections, baseMask, snapshot, rowFilters]);

  const isSelected = useCallback((widgetId: string) => state.selections.find((s) => s.widgetId === widgetId), [state.selections]);

  const value = useMemo<Ctx>(() => ({ snapshot, layout, fields, state, dispatch, maskFor, baseMask, isSelected, searchFields, now }), [snapshot, layout, fields, state, maskFor, baseMask, isSelected, searchFields, now]);
  return <DashboardCtx.Provider value={value}>{children}</DashboardCtx.Provider>;
}

export function useDashboard(): Ctx {
  const ctx = useContext(DashboardCtx);
  if (!ctx) throw new Error("useDashboard must be used inside DashboardProvider");
  return ctx;
}

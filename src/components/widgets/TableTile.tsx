"use client";
import { useMemo, useState } from "react";
import type { TableWidget } from "@/lib/dashboard/types";
import type { ColumnValue, Field, FilterExpr, Snapshot } from "@/lib/schema/types";
import { rowMatches } from "@/lib/engine/filters";
import { formatValue } from "@/lib/engine/format";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { statusTone, toneVar } from "@/lib/ui/colors";
import { useSize } from "@/components/charts/useSize";
import { Tile } from "./Tile";
import { Empty } from "./BarTile";

/** Below this width the table turns into stacked cards: one row per record, readable on a phone without sideways scrolling. */
const CARD_MAX = 560;

/** What the table iterates over: snapshot rows as they are, or rows rolled up by `groupBy` (several container lines → one container). */
interface View {
  columns: Record<string, ColumnValue[]>;
  /** Indices into `columns` that pass the dashboard mask and the widget filter. */
  rows: number[];
  rid: (i: number) => string;
  isNew: (i: number) => boolean;
  isChanged: (i: number) => boolean;
}

/** Combine the values one column takes across the rows being rolled up. */
function rollup(f: Field, vals: ColumnValue[]): ColumnValue {
  const vs = vals.filter((v): v is string | number => v !== null && v !== undefined);
  if (vs.length === 0) return null;
  const first = vs[0];
  // Repeated values are one value (a container's sales order on each of its lines), unless the field asks to be summed (counts).
  if (vs.every((v) => v === first) && !(f.aggregate === "sum" && typeof first === "number")) return first;
  if (vs.every((v) => typeof v === "number")) {
    const nums = vs as number[];
    const how = f.type === "date" ? "min" : f.aggregate ?? (f.role === "measure" ? "sum" : "min");
    if (how === "sum") return nums.reduce((a, b) => a + b, 0);
    if (how === "avg") return nums.reduce((a, b) => a + b, 0) / nums.length;
    if (how === "max") return Math.max(...nums);
    return Math.min(...nums);
  }
  return [...new Set(vs.map(String))].join(", ");
}

function sortRows(rows: number[], columns: Record<string, ColumnValue[]>, sort: { field: string; dir: "asc" | "desc" } | null): number[] {
  if (!sort) return rows;
  const col = columns[sort.field] ?? [];
  const dir = sort.dir === "asc" ? 1 : -1;
  return rows.sort((a, b) => {
    const va = col[a], vb = col[b];
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
    return String(va).localeCompare(String(vb)) * dir;
  });
}

function buildView(snapshot: Snapshot, mask: Uint8Array, filter: FilterExpr | undefined, groupBy: string | undefined, idField: Field | undefined, newSet: Set<string>, changedSet: Set<string>): View {
  const keep: number[] = [];
  for (let i = 0; i < snapshot.n; i++) {
    if (!mask[i]) continue;
    if (filter && !rowMatches(snapshot.columns, i, filter)) continue;
    keep.push(i);
  }
  const rid = (i: number) => (idField ? String(snapshot.columns[idField.id]?.[i] ?? "") : "");
  const groupCol = groupBy ? snapshot.columns[groupBy] : undefined;
  if (!groupCol) return { columns: snapshot.columns, rows: keep, rid, isNew: (i) => newSet.has(rid(i)), isChanged: (i) => !newSet.has(rid(i)) && changedSet.has(rid(i)) };
  const groups = new Map<string, number[]>();
  for (const i of keep) {
    const key = groupCol[i] === null ? `\u0000${i}` : String(groupCol[i]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }
  const members = [...groups.values()];
  const columns: Record<string, ColumnValue[]> = {};
  for (const f of snapshot.fields) {
    const src = snapshot.columns[f.id];
    if (!src) continue;
    columns[f.id] = members.map((m) => rollup(f, m.map((i) => src[i])));
  }
  // A rolled-up container shows its shared reference, not the list of its split lines.
  if (idField && columns[idField.id]) members.forEach((m, g) => { if (m.length > 1) columns[idField.id][g] = groupCol[m[0]]; });
  const vrid = (g: number) => (members[g].length > 1 ? String(groupCol[members[g][0]] ?? "") : rid(members[g][0]));
  return {
    columns, rows: members.map((_, g) => g), rid: vrid,
    isNew: (g) => members[g].some((i) => newSet.has(rid(i))),
    isChanged: (g) => !members[g].some((i) => newSet.has(rid(i))) && members[g].some((i) => changedSet.has(rid(i))),
  };
}

export function TableTile({ w, newIds, changedIds, comparedTo }: { w: TableWidget; newIds?: string[]; changedIds?: string[]; comparedTo?: number | null }) {
  const { snapshot, maskFor, fields, dispatch, isSelected, state } = useDashboard();
  const idField = snapshot.fields.find((f) => f.role === "id");
  const newSet = useMemo(() => new Set(newIds ?? []), [newIds]);
  const changedSet = useMemo(() => new Set(changedIds ?? []), [changedIds]);
  const onlyChanges = state.changesOnly && (newSet.size > 0 || changedSet.size > 0);
  const setOnlyChanges = (value: boolean) => dispatch({ type: "changesOnly", value });
  const mask = maskFor(w.id);
  const [sort, setSort] = useState(w.sort ?? null);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const cards = size.width > 0 && size.width < CARD_MAX;
  const cols = w.columns.map((id) => fields.get(id)).filter((f): f is Field => Boolean(f));
  const pageSize = w.pageSize ?? 25;
  const view = useMemo(() => buildView(snapshot, mask, w.filter, w.groupBy, idField, newSet, changedSet), [snapshot, mask, w.filter, w.groupBy, idField, newSet, changedSet]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = w.limit ? sortRows([...view.rows], view.columns, w.sort ?? null).slice(0, w.limit) : view.rows;
    const out = base.filter((i) => {
      if (onlyChanges && idField && !view.isNew(i) && !view.isChanged(i)) return false;
      if (needle && !cols.some((c) => { const v = view.columns[c.id]?.[i]; return v !== null && v !== undefined && formatValue(v, c).toLowerCase().includes(needle); })) return false;
      return true;
    });
    return sortRows(out, view.columns, sort);
  }, [view, cols, q, sort, onlyChanges, idField, w.limit, w.sort]);
  const changeCount = useMemo(() => (idField ? view.rows.filter((i) => view.isNew(i) || view.isChanged(i)).length : 0), [view, idField]);
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const toggleSort = (id: string) => { setPage(0); setSort((s) => (s && s.field === id ? { field: id, dir: s.dir === "asc" ? "desc" : "asc" } : { field: id, dir: fields.get(id)?.type === "number" || fields.get(id)?.type === "date" ? "desc" : "asc" })); };
  const sel = isSelected(w.id);
  const emphasis = w.emphasisField ? view.columns[w.emphasisField] : undefined;
  const maxEmph = emphasis ? Math.max(1, ...emphasis.map((v) => (typeof v === "number" ? v : 0))) : 1;
  const badge = (isNew: boolean, isChanged: boolean) => (isNew || isChanged) && <span className={`rounded-sm px-1 text-[11px] font-semibold leading-4 ${isNew ? "bg-accent text-[var(--accent-ink)]" : "border border-accent text-accent"}`}>{isNew ? "NEW" : "CHANGED"}</span>;
  const emphBar = (i: number) => { const e = emphasis && typeof emphasis[i] === "number" ? (emphasis[i] as number) / maxEmph : 0; return <span className="inline-block h-[3px] w-10 bg-bg-sunk"><span className="block h-full" style={{ width: `${Math.round(e * 100)}%`, background: e > 0.66 ? "var(--neg)" : e > 0.33 ? "var(--warn)" : "var(--ink-3)" }} /></span>; };
  const val = (c: Field, i: number) => view.columns[c.id]?.[i] ?? null;
  const cell = (c: Field, v: string | number | null, i: number) => {
    const isNew = view.isNew(i), isChanged = view.isChanged(i);
    const text = formatValue(v, c);
    if (c.role === "id" && (isNew || isChanged)) return <span className="flex items-center gap-1.5 whitespace-nowrap"><span className="text-ink">{text}</span>{badge(isNew, isChanged)}</span>;
    if ((c.id === w.statusField || w.statusFields?.includes(c.id)) && v !== null) return <span className="flex items-center gap-1.5 whitespace-nowrap text-ink"><span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: toneVar(statusTone(String(v))) }} />{text}</span>;
    if (c.id === w.emphasisField && typeof v === "number") return <span className="flex items-center justify-end gap-2">{emphBar(i)}{text}</span>;
    if (c.role === "text" || (typeof v === "string" && v.includes(", "))) return <span className={expanded === i ? "" : "truncate-2 block"} title={v === null ? undefined : text}>{v === null ? <span className="text-ink-4">·</span> : text}</span>;
    return v === null ? <span className="text-ink-4">·</span> : text;
  };
  const rowLabel = w.rowLabel ?? "rows";

  return (
    <Tile title={w.title} subtitle={w.subtitle} padded={false} selected={Boolean(sel)} onClear={() => dispatch({ type: "clearSelection", widgetId: w.id })}
      right={<div className="flex items-center gap-2">
        {comparedTo ? (changeCount > 0 || onlyChanges) && (
          <button type="button" className={`chip h-[18px] whitespace-nowrap px-1.5 text-[14px] ${onlyChanges ? "chip-on" : ""}`} onClick={() => setOnlyChanges(!onlyChanges)} title={onlyChanges ? `Show every ${rowLabel.replace(/s$/, "")}` : `Show only ${rowLabel} that are new or changed since version ${comparedTo}`}>
            {onlyChanges ? "Showing changes only ×" : `${changeCount} changed since v${comparedTo}`}
          </button>
        ) : null}
        {w.search && !cards && <input className="field h-6 w-40 text-[14px]" placeholder="Find in table" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="Find in table" />}
        <span className="num whitespace-nowrap text-[14px] text-ink-3">{rows.length} {rowLabel}</span>
      </div>}>
      <div ref={wrapRef} className="flex h-full flex-col" data-table-tile>
        {rows.length === 0 ? <Empty /> : cards ? (
          <div className="min-h-0 flex-1 overflow-auto">
            {pageRows.map((i) => {
              const isNew = view.isNew(i), isChanged = view.isChanged(i);
              const idCol = cols.find((c) => c.role === "id") ?? (w.groupBy ? cols.find((c) => c.id === w.groupBy) : undefined);
              const textCols = cols.filter((c) => c.role === "text");
              const statusCol = cols.find((c) => c.id === w.statusField);
              const emphCol = cols.find((c) => c.id === w.emphasisField);
              const rest = cols.filter((c) => c !== idCol && c !== statusCol && c !== emphCol && c.role !== "text");
              return (
                <div key={i} className={`border-b border-line px-3.5 py-2.5 ${isNew || isChanged ? "bg-[color-mix(in_oklab,var(--accent)_6%,transparent)]" : ""}`} onClick={() => setExpanded((x) => (x === i ? null : i))}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="num flex min-w-0 items-center gap-1.5 text-[15px] font-semibold text-ink">{idCol ? formatValue(val(idCol, i), idCol) : `#${i + 1}`}{badge(isNew, isChanged)}</span>
                    {emphCol && typeof val(emphCol, i) === "number" && <span className="num flex shrink-0 items-center gap-2 text-ink">{emphBar(i)}{formatValue(val(emphCol, i), emphCol)}</span>}
                  </div>
                  {textCols[0] && val(textCols[0], i) !== null && <div className="mt-0.5 text-[15px] text-ink">{formatValue(val(textCols[0], i), textCols[0])}</div>}
                  {(statusCol || rest.length > 0) && (
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[14px]">
                      {statusCol && val(statusCol, i) !== null && <span className="flex items-center gap-1.5 text-ink"><span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: toneVar(statusTone(String(val(statusCol, i)))) }} />{formatValue(val(statusCol, i), statusCol)}</span>}
                      {rest.map((c) => val(c, i) !== null && <span key={c.id} className="text-ink-3"><span className="text-ink-4">{c.label} </span><span className="text-ink-2">{formatValue(val(c, i), c)}</span></span>)}
                    </div>
                  )}
                  {textCols.slice(1).map((c) => val(c, i) !== null && <div key={c.id} className={`mt-1 text-[14px] text-ink-2 ${expanded === i ? "" : "truncate-2"}`}>{formatValue(val(c, i), c)}</div>)}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-[14.5px]">
              <thead className="sticky top-0 z-[1] bg-bg">
                <tr>
                  {cols.map((c) => {
                    const numeric = c.type === "number" || c.type === "date";
                    const active = sort?.field === c.id;
                    return (
                      <th key={c.id} className={`label cursor-pointer select-none whitespace-nowrap border-b border-line px-3 py-1.5 font-medium hover:text-ink ${numeric ? "text-right" : "text-left"} ${active ? "text-ink" : ""}`} onClick={() => toggleSort(c.id)} aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}>
                        {c.label}{active && <span className="ml-1 text-ink-3">{sort!.dir === "asc" ? "↑" : "↓"}</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((i) => {
                  const isNew = view.isNew(i), isChanged = view.isChanged(i);
                  return (
                    <tr key={i} className={`group border-b border-line hover:bg-bg-hover ${isNew || isChanged ? "bg-[color-mix(in_oklab,var(--accent)_6%,transparent)]" : ""}`} onClick={() => setExpanded((x) => (x === i ? null : i))}>
                      {cols.map((c) => {
                        const v = val(c, i);
                        const numeric = c.type === "number" || c.type === "date";
                        const listy = c.role === "text" || (typeof v === "string" && v.includes(", "));
                        return (
                          <td key={c.id} className={`align-top px-3 py-[5px] ${numeric ? "num text-right text-ink" : "text-ink-2"} ${c.role === "id" ? "num text-ink" : ""} ${listy ? "max-w-[360px]" : "whitespace-nowrap"}`}>
                            {cell(c, v, i)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && pages > 1 && (
          <div className="flex h-8 shrink-0 items-center justify-between border-t border-line px-3 text-[14px] text-ink-3">
            <span className="num">Page {page + 1} of {pages}</span>
            <div className="flex gap-1">
              <button type="button" className="btn h-6 px-2 py-0 text-[14px]" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</button>
              <button type="button" className="btn h-6 px-2 py-0 text-[14px]" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>Next</button>
            </div>
          </div>
        )}
      </div>
    </Tile>
  );
}

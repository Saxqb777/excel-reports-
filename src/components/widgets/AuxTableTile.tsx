"use client";
import { useMemo, useState } from "react";
import type { AuxTableWidget } from "@/lib/dashboard/types";
import type { AuxColumn, ColumnValue } from "@/lib/schema/types";
import { joinKey } from "@/lib/schema/types";
import { formatDate, formatNumber } from "@/lib/engine/format";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { statusTone, toneVar } from "@/lib/ui/colors";
import { Tile } from "./Tile";
import { Empty } from "./BarTile";

/** A table over a secondary sheet of the workbook (a vessel timetable), with an optional count of matching main-table rows. */
export function AuxTableTile({ w }: { w: AuxTableWidget }) {
  const { snapshot, maskFor } = useDashboard();
  const sheet = snapshot.aux?.[w.sheet];
  const mask = maskFor(w.id);
  const [sort, setSort] = useState(w.sort ?? null);
  const [page, setPage] = useState(0);
  const pageSize = w.pageSize ?? 25;
  const cols = useMemo(() => {
    if (!sheet) return [] as AuxColumn[];
    return w.columns ? w.columns.map((id) => sheet.columns.find((c) => c.id === id)).filter((c): c is AuxColumn => Boolean(c)) : sheet.columns.filter((c) => !c.hidden);
  }, [sheet, w.columns]);
  // Count distinct main-table things (containers) joined to each sheet row, honouring the dashboard's filters.
  const counts = useMemo(() => {
    const cc = w.countColumn;
    if (!cc || !sheet) return null;
    const keyCol = snapshot.columns[cc.snapshotField], idCol = snapshot.columns[cc.distinct];
    if (!keyCol || !idCol) return null;
    const sets = new Map<string, Set<ColumnValue>>();
    for (let i = 0; i < snapshot.n; i++) {
      if (!mask[i] || keyCol[i] === null || idCol[i] === null) continue;
      const k = joinKey(keyCol[i]);
      if (!sets.has(k)) sets.set(k, new Set());
      sets.get(k)!.add(idCol[i]);
    }
    return sets;
  }, [w.countColumn, sheet, snapshot, mask]);
  const rows = useMemo(() => {
    if (!sheet) return [] as number[];
    const out = sheet.rows.map((_, i) => i);
    if (sort) {
      const dir = sort.dir === "asc" ? 1 : -1;
      const val = (i: number): ColumnValue => (sort.field === "__count" ? counts?.get(String(sheet.rows[i][w.countColumn?.keyColumn ?? ""] ?? ""))?.size ?? null : sheet.rows[i][sort.field] ?? null);
      out.sort((a, b) => {
        const va = val(a), vb = val(b);
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      });
    }
    return out;
  }, [sheet, sort, counts, w.countColumn]);
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const toggleSort = (id: string, numeric: boolean) => { setPage(0); setSort((s) => (s && s.field === id ? { field: id, dir: s.dir === "asc" ? "desc" : "asc" } : { field: id, dir: numeric ? "desc" : "asc" })); };
  const shown: AuxColumn[] = useMemo(() => {
    const countCol: AuxColumn | null = w.countColumn ? { id: "__count", label: w.countColumn.label, type: "number", format: "integer" } : null;
    if (!countCol) return cols;
    const at = w.countColumn?.after ? cols.findIndex((c) => c.id === w.countColumn!.after) + 1 : cols.length;
    return [...cols.slice(0, at || cols.length), countCol, ...cols.slice(at || cols.length)];
  }, [cols, w.countColumn]);
  const valueOf = (c: AuxColumn, i: number): ColumnValue => {
    if (c.id === "__count") { const k = String(sheet!.rows[i][w.countColumn!.keyColumn] ?? ""); const n = counts?.get(k)?.size ?? 0; return n || null; }
    return sheet!.rows[i][c.id] ?? null;
  };
  const text = (c: AuxColumn, v: ColumnValue): string => {
    if (v === null) return "";
    if (typeof v === "number") return c.type === "date" ? formatDate(v) : formatNumber(v, c.format === "date" || c.format === "text" ? "integer" : c.format ?? "integer");
    return v;
  };
  const rowLabel = w.rowLabel ?? "rows";

  return (
    <Tile title={w.title} subtitle={w.subtitle} padded={false} right={<span className="num whitespace-nowrap text-[14px] text-ink-3">{rows.length} {rowLabel}</span>}>
      <div className="flex h-full flex-col" data-table-tile>
        {!sheet || rows.length === 0 ? <Empty /> : (
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-[14.5px]">
              <thead className="sticky top-0 z-[1] bg-bg">
                <tr>
                  {shown.map((c) => {
                    const numeric = c.type === "number" || c.type === "date";
                    const active = sort?.field === c.id;
                    return (
                      <th key={c.id} className={`label cursor-pointer select-none whitespace-nowrap border-b border-line px-3 py-1.5 font-medium hover:text-ink ${numeric ? "text-right" : "text-left"} ${active ? "text-ink" : ""}`} onClick={() => toggleSort(c.id, numeric)} aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}>
                        {c.label}{active && <span className="ml-1 text-ink-3">{sort!.dir === "asc" ? "↑" : "↓"}</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((i) => (
                  <tr key={i} className="border-b border-line hover:bg-bg-hover">
                    {shown.map((c) => {
                      const v = valueOf(c, i);
                      const numeric = c.type === "number" || c.type === "date";
                      const t = text(c, v);
                      return (
                        <td key={c.id} className={`align-top px-3 py-[5px] ${numeric ? "num text-right text-ink" : "text-ink-2"} ${c.id === "__count" && v !== null ? "font-semibold" : ""} ${c.id === "remarks" ? "max-w-[320px]" : "whitespace-nowrap"}`}>
                          {v === null ? <span className="text-ink-4">·</span> : c.id === w.statusField ? <span className="flex items-center gap-1.5 whitespace-nowrap text-ink"><span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: toneVar(statusTone(t)) }} />{t}</span> : t}
                        </td>
                      );
                    })}
                  </tr>
                ))}
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

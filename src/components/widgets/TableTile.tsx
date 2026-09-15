"use client";
import { useMemo, useState } from "react";
import type { TableWidget } from "@/lib/dashboard/types";
import type { Field } from "@/lib/schema/types";
import { rowMatches } from "@/lib/engine/filters";
import { formatValue } from "@/lib/engine/format";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { statusTone, toneVar } from "@/lib/ui/colors";
import { Tile } from "./Tile";
import { Empty } from "./BarTile";

export function TableTile({ w }: { w: TableWidget }) {
  const { snapshot, maskFor, fields, dispatch, isSelected } = useDashboard();
  const mask = maskFor(w.id);
  const [sort, setSort] = useState(w.sort ?? null);
  const [page, setPage] = useState(0);
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const cols = w.columns.map((id) => fields.get(id)).filter((f): f is Field => Boolean(f));
  const pageSize = w.pageSize ?? 25;
  const rows = useMemo(() => {
    const out: number[] = [];
    const needle = q.trim().toLowerCase();
    for (let i = 0; i < snapshot.n; i++) {
      if (!mask[i]) continue;
      if (w.filter && !rowMatches(snapshot.columns, i, w.filter)) continue;
      if (needle && !cols.some((c) => { const v = snapshot.columns[c.id]?.[i]; return v !== null && v !== undefined && formatValue(v, c).toLowerCase().includes(needle); })) continue;
      out.push(i);
    }
    if (sort) {
      const col = snapshot.columns[sort.field] ?? [];
      const dir = sort.dir === "asc" ? 1 : -1;
      out.sort((a, b) => {
        const va = col[a], vb = col[b];
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
        return String(va).localeCompare(String(vb)) * dir;
      });
    }
    return out;
  }, [snapshot, mask, w.filter, cols, q, sort]);
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const toggleSort = (id: string) => { setPage(0); setSort((s) => (s && s.field === id ? { field: id, dir: s.dir === "asc" ? "desc" : "asc" } : { field: id, dir: fields.get(id)?.type === "number" || fields.get(id)?.type === "date" ? "desc" : "asc" })); };
  const sel = isSelected(w.id);
  const emphasis = w.emphasisField ? snapshot.columns[w.emphasisField] : undefined;
  const maxEmph = emphasis ? Math.max(1, ...emphasis.map((v) => (typeof v === "number" ? v : 0))) : 1;
  return (
    <Tile title={w.title} subtitle={w.subtitle} padded={false} selected={Boolean(sel)} onClear={() => dispatch({ type: "clearSelection", widgetId: w.id })}
      right={<div className="flex items-center gap-2">
        {w.search && <input className="field h-6 w-40 text-[11px]" placeholder="Find in table" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="Find in table" />}
        <span className="num text-[11px] text-ink-3">{rows.length} rows</span>
      </div>}>
      {rows.length === 0 ? <Empty /> : (
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse text-[12px]">
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
                  const e = emphasis && typeof emphasis[i] === "number" ? (emphasis[i] as number) / maxEmph : 0;
                  return (
                    <tr key={i} className="group border-b border-line hover:bg-bg-hover" onClick={() => setExpanded((x) => (x === i ? null : i))}>
                      {cols.map((c) => {
                        const v = snapshot.columns[c.id]?.[i] ?? null;
                        const numeric = c.type === "number" || c.type === "date";
                        const isStatus = c.id === w.statusField;
                        const isText = c.role === "text";
                        const text = formatValue(v, c);
                        return (
                          <td key={c.id} className={`align-top px-3 py-[5px] ${numeric ? "num text-right text-ink" : "text-ink-2"} ${c.role === "id" ? "num text-ink" : ""} ${isText ? "max-w-[360px]" : "whitespace-nowrap"}`}>
                            {isStatus && v !== null ? (
                              <span className="flex items-center gap-1.5 whitespace-nowrap text-ink"><span className="inline-block h-[7px] w-[7px] rounded-full" style={{ background: toneVar(statusTone(String(v))) }} />{text}</span>
                            ) : c.id === w.emphasisField && typeof v === "number" ? (
                              <span className="flex items-center justify-end gap-2"><span className="inline-block h-[3px] w-10 bg-bg-sunk"><span className="block h-full" style={{ width: `${Math.round(e * 100)}%`, background: e > 0.66 ? "var(--neg)" : e > 0.33 ? "var(--warn)" : "var(--ink-3)" }} /></span>{text}</span>
                            ) : isText ? (
                              <span className={expanded === i ? "" : "truncate-2 block"} title={v === null ? undefined : text}>{v === null ? <span className="text-ink-4">·</span> : text}</span>
                            ) : v === null ? <span className="text-ink-4">·</span> : text}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="flex h-8 shrink-0 items-center justify-between border-t border-line px-3 text-[11px] text-ink-3">
              <span className="num">Page {page + 1} of {pages}</span>
              <div className="flex gap-1">
                <button type="button" className="btn h-6 px-2 py-0 text-[11px]" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</button>
                <button type="button" className="btn h-6 px-2 py-0 text-[11px]" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Tile>
  );
}

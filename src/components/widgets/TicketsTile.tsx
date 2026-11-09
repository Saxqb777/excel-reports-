"use client";
import { useMemo, useState } from "react";
import type { TicketsWidget } from "@/lib/dashboard/types";
import { computeMetric } from "@/lib/engine/metrics";
import { formatDate, formatNumber } from "@/lib/engine/format";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { Tile } from "./Tile";
import { segmentColor } from "./segments";

interface Ticket { id: string; title: string; subtitle: string | null; route: { label: string; value: string }[]; date: number | null; tags: string[]; count: number | null; total: number; stacks: { label: string; value: number; color: string }[]; per: number | null; goods: number | null }

/**
 * One card per shipment: its route as a timeline, what it carried, the cost split as a stacked bar and the totals.
 * Sorted by total spend; a search box narrows the cards; clicking one filters the whole dashboard to that shipment.
 */
export function TicketsTile({ w }: { w: TicketsWidget }) {
  const { snapshot, maskFor, dispatch, isSelected, fields } = useDashboard();
  const mask = maskFor(w.id);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = w.pageSize ?? 12;
  const fmt = w.total.format ?? "currency";
  const currency = w.total.currency ?? "AED";
  const tickets = useMemo<Ticket[]>(() => {
    const idCol = snapshot.columns[w.idField];
    if (!idCol) return [];
    const groups = new Map<string, number[]>();
    for (let i = 0; i < snapshot.n; i++) { if (!mask[i] || idCol[i] === null) continue; const k = String(idCol[i]); (groups.get(k) ?? groups.set(k, []).get(k)!).push(i); }
    const first = (field: string | undefined, idx: number[]): string | number | null => { if (!field) return null; const col = snapshot.columns[field]; if (!col) return null; for (const i of idx) if (col[i] !== null && col[i] !== undefined && col[i] !== "") return col[i] as string | number; return null; };
    const out: Ticket[] = [];
    for (const [id, idx] of groups) {
      const sub = new Uint8Array(snapshot.n);
      for (const i of idx) sub[i] = 1;
      const total = computeMetric(snapshot, sub, w.total) ?? 0;
      const date = first(w.dateField, idx);
      out.push({
        id, title: String(first(w.titleField, idx) ?? id), subtitle: w.subtitleField ? (first(w.subtitleField, idx) as string | null) : null,
        route: w.route.map((f) => ({ label: fields.get(f)?.label ?? f, value: first(f, idx) as string | null })).filter((r): r is { label: string; value: string } => typeof r.value === "string" && r.value.length > 0),
        date: typeof date === "number" ? date : null,
        tags: (w.tags ?? []).map((f) => first(f, idx)).filter((v): v is string => typeof v === "string" && v.length > 0),
        count: w.countMetric ? computeMetric(snapshot, sub, w.countMetric) : null, total,
        stacks: w.stacks.map((s, i) => ({ label: s.label, value: computeMetric(snapshot, sub, s.metric) ?? 0, color: segmentColor(s.label, i) })).filter((s) => s.value > 0),
        per: w.perMetric ? computeMetric(snapshot, sub, w.perMetric) : null, goods: w.goodsMetric ? computeMetric(snapshot, sub, w.goodsMetric) : null,
      });
    }
    return out.sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));
  }, [snapshot, mask, w, fields]);
  const shown = useMemo(() => { const s = q.trim().toLowerCase(); return s ? tickets.filter((t) => [t.id, t.title, t.subtitle, ...t.tags, ...t.route.map((r) => r.value)].some((v) => v && v.toLowerCase().includes(s))) : tickets; }, [tickets, q]);
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = shown.slice(cur * pageSize, cur * pageSize + pageSize);
  const sel = isSelected(w.id);
  const maxTotal = Math.max(1, ...tickets.map((t) => t.total));
  const onSelect = (id: string) => dispatch({ type: "toggle", selection: { widgetId: w.id, field: w.idField, values: [id], label: `${fields.get(w.idField)?.label ?? "Shipment"} ${id}` } });
  return (
    <Tile title={w.title} subtitle={w.subtitle} selected={Boolean(sel)} onClear={() => dispatch({ type: "clearSelection", widgetId: w.id })} padded={false}
      right={<input value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} placeholder="Search shipments" className="field h-7 w-40 text-[13.5px]" aria-label="Search shipments" />}>
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1 overflow-auto px-3.5 pb-2">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
            {slice.map((t) => {
              const on = sel?.values[0] === t.id, dimmed = Boolean(sel) && !on;
              return (
                <button key={t.id} type="button" onClick={() => onSelect(t.id)} className={`ticket flex flex-col gap-2.5 rounded-[16px] p-3.5 text-left transition ${on ? "ticket-on" : ""}`} style={{ opacity: dimmed ? 0.45 : 1 }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="num truncate text-[15px] font-semibold text-ink" style={{ fontFamily: "var(--font-num)" }}>{t.title}</div>
                      {t.subtitle && <div className="truncate text-[13.5px] text-ink-2">{t.subtitle}</div>}
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="num text-[18px] font-bold leading-none text-ink" style={{ fontFamily: "var(--font-num)" }}>{formatNumber(t.total, fmt, currency, true)}</div>
                      {t.date !== null && <div className="num mt-1 text-[12.5px] text-ink-3">{fields.get(w.dateField ?? "")?.label ?? "Date"} {formatDate(t.date)}</div>}
                    </div>
                  </div>
                  {t.route.length > 0 && (
                    <div className="relative flex items-start justify-between gap-1 pt-1">
                      <div className="absolute left-1 right-1 top-[9px] h-px" style={{ background: "var(--line-strong)" }} />
                      {t.route.map((r, i) => (
                        <div key={i} className="relative flex min-w-0 flex-1 flex-col items-center text-center" style={{ alignItems: i === 0 ? "flex-start" : i === t.route.length - 1 ? "flex-end" : "center", textAlign: i === 0 ? "left" : i === t.route.length - 1 ? "right" : "center" }}>
                          <span className="block h-[9px] w-[9px] rounded-full border-2" style={{ background: i === t.route.length - 1 ? "var(--accent)" : "var(--bg-elev)", borderColor: "var(--accent)", boxShadow: i === t.route.length - 1 ? "0 0 0 3px color-mix(in oklab, var(--accent) 25%, transparent)" : undefined }} />
                          <span className="mt-1 max-w-full truncate text-[12.5px] font-medium text-ink">{r.value}</span>
                          <span className="max-w-full truncate text-[11px] text-ink-4">{r.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {t.tags.length > 0 && <div className="flex flex-wrap gap-1.5">{t.tags.map((g, i) => <span key={i} className="chip h-[20px] px-1.5 text-[12px]">{g}</span>)}</div>}
                  <div>
                    <div className="flex h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
                      {t.stacks.map((s) => <span key={s.label} className="block h-full" style={{ width: `${(s.value / Math.max(t.total, 1)) * 100}%`, background: s.color }} title={`${s.label}: ${formatNumber(s.value, fmt, currency)}`} />)}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px] text-ink-2">
                      {t.stacks.map((s) => <span key={s.label} className="inline-flex items-center gap-1 whitespace-nowrap"><span className="inline-block h-2 w-2 rounded-[2px]" style={{ background: s.color }} />{s.label} <span className="num text-ink">{formatNumber(s.value, fmt, currency, true)}</span></span>)}
                    </div>
                  </div>
                  <div className="num flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t pt-2 text-[12.5px] text-ink-3" style={{ borderColor: "var(--line)" }}>
                    {t.count !== null && <span><span className="text-ink">{formatNumber(t.count)}</span> containers</span>}
                    {t.per !== null && <span><span className="text-ink">{formatNumber(t.per, fmt, currency, true)}</span> per container</span>}
                    {t.goods !== null && t.goods > 0 && <span><span className="text-ink">{Math.round((t.total / t.goods) * 100)}%</span> of goods value</span>}
                    <span className="ml-auto h-1 w-16 overflow-hidden rounded-full" style={{ background: "var(--line)" }} title="Spend compared with the largest shipment"><span className="block h-full rounded-full" style={{ width: `${(t.total / maxTotal) * 100}%`, background: "var(--accent)" }} /></span>
                  </div>
                </button>
              );
            })}
          </div>
          {!slice.length && <div className="py-8 text-center text-[14px] text-ink-3">No shipments match.</div>}
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-3.5 py-1.5 text-[13px] text-ink-3" style={{ borderColor: "var(--line)" }}>
          <span className="num">{shown.length} {fields.get(w.idField)?.label?.toLowerCase() ?? "items"}{shown.length !== 1 ? "s" : ""} · {formatNumber(shown.reduce((a, t) => a + t.total, 0), fmt, currency, true)}</span>
          {pages > 1 && <span className="flex items-center gap-1.5"><button type="button" className="chip h-[20px] px-1.5" disabled={cur === 0} onClick={() => setPage(cur - 1)}>‹</button><span className="num">{cur + 1} / {pages}</span><button type="button" className="chip h-[20px] px-1.5" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>›</button></span>}
        </div>
      </div>
    </Tile>
  );
}

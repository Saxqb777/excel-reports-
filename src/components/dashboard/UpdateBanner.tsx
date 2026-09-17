"use client";
import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/engine/format";
import { useDashboard } from "@/lib/ui/dashboard-state";

/**
 * "The sheet was updated" strip. Shown until the reviewer dismisses it for this version, remembered per
 * browser, so every new upload announces itself and can be reviewed in one click (tables switch to changed rows only).
 */
export function UpdateBanner({ projectId, version, comparedTo, uploadedAt, newCount, changedCount }: {
  projectId: string; version: number; comparedTo: number | null; uploadedAt: string | null; newCount: number; changedCount: number;
}) {
  const { state, dispatch } = useDashboard();
  const key = `meridian-seen:${projectId}`;
  const [seen, setSeen] = useState<number | null>(null);
  useEffect(() => {
    try { const v = Number(localStorage.getItem(key) ?? "0"); setSeen(Number.isFinite(v) ? v : 0); } catch { setSeen(0); }
  }, [key]);
  if (seen === null || !comparedTo || seen >= version) return null;
  const dismiss = () => { try { localStorage.setItem(key, String(version)); } catch {} setSeen(version); dispatch({ type: "changesOnly", value: false }); };
  const review = () => {
    dispatch({ type: "changesOnly", value: !state.changesOnly });
    if (!state.changesOnly) requestAnimationFrame(() => document.querySelector("[data-table-tile]")?.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const changes = newCount + changedCount;
  const parts = [newCount > 0 ? `${newCount} new` : null, changedCount > 0 ? `${changedCount} changed` : null].filter(Boolean).join(" · ");
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-accent-wash px-3.5 py-2.5 text-[14.5px]" role="status" style={{ boxShadow: "inset 3px 0 0 var(--accent)" }}>
      <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
      <span className="min-w-[240px] flex-1">
        <span className="font-semibold text-ink">New update</span>
        <span className="text-ink-2">{uploadedAt ? ` · ${formatDateTime(uploadedAt)}` : ""} · version {version}</span>
        <span className="text-ink-2">{changes > 0 ? ` · ${parts} since version ${comparedTo}` : ` · no row changes since version ${comparedTo}`}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {changes > 0 && <button type="button" className={`btn h-7 px-2.5 py-0 text-[14px] ${state.changesOnly ? "" : "btn-accent"}`} onClick={review}>{state.changesOnly ? "Show all rows" : "Review changes"}</button>}
        <button type="button" className="btn h-7 px-2.5 py-0 text-[14px]" onClick={dismiss} title="Hide until the next update">Got it</button>
      </span>
    </div>
  );
}

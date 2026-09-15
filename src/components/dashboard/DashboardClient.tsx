"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Snapshot } from "@/lib/schema/types";
import type { Layout, Theme } from "@/lib/dashboard/types";
import type { UploadSummary } from "@/lib/data/projects";
import { DashboardProvider } from "@/lib/ui/dashboard-state";
import { TooltipProvider } from "@/lib/ui/tooltip";
import { TopBar } from "./TopBar";
import { FilterRow } from "./FilterRow";
import { Grid } from "./Grid";
import { UploadFlow } from "./UploadFlow";
import { HistoryDrawer } from "./HistoryDrawer";
import type { Insight } from "@/components/widgets/InsightsTile";

export interface DashboardProps {
  projectId: string;
  name: string;
  clientName?: string | null;
  theme: Theme;
  layout: Layout;
  snapshot: Snapshot;
  upload: UploadSummary | null;
  insights?: Insight[];
  actions?: ReactNode;
  homeHref?: string | null;
  /** View-only surfaces (share links) hide upload and history. */
  readOnly?: boolean;
}

export function DashboardClient(props: DashboardProps) {
  const { layout, theme } = props;
  const [pageId, setPageId] = useState(layout.pages[0]?.id ?? "");
  const [snapshot, setSnapshot] = useState(props.snapshot);
  const [upload, setUpload] = useState(props.upload);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [reloading, setReloading] = useState(false);
  useEffect(() => setSnapshot(props.snapshot), [props.snapshot]);
  useEffect(() => setUpload(props.upload), [props.upload]);
  const page = layout.pages.find((p) => p.id === pageId) ?? layout.pages[0];
  useEffect(() => { document.documentElement.style.setProperty("--accent", theme.primary); }, [theme.primary]);

  /** Pulls the current snapshot and upload metadata after an upload or a restore; visuals tween to the new values. */
  const refresh = useCallback(async () => {
    setReloading(true);
    const [snapRes, upRes] = await Promise.all([fetch(`/api/projects/${props.projectId}/snapshot`, { cache: "no-store" }), fetch(`/api/projects/${props.projectId}/uploads`, { cache: "no-store" })]);
    if (snapRes.ok) setSnapshot(await snapRes.json());
    if (upRes.ok) { const j = await upRes.json(); const cur = (j.uploads as UploadSummary[]).find((u) => u.id === j.currentUploadId) ?? null; setUpload(cur); }
    setRefreshKey((k) => k + 1);
    setReloading(false);
  }, [props.projectId]);

  const readOnly = props.readOnly ?? false;
  return (
    <TooltipProvider>
      <DashboardProvider snapshot={snapshot} layout={layout}>
        <UploadFlow projectId={props.projectId} onDone={() => void refresh()}>
          {({ openPicker, busy }) => (
            <div className={`flex min-h-screen flex-col bg-bg transition-opacity duration-300 ${reloading || busy ? "opacity-80" : ""}`}>
              <TopBar theme={theme} name={props.name} clientName={props.clientName} pages={layout.pages.map((p) => ({ id: p.id, title: p.title }))} activePage={page.id} onPage={setPageId} upload={upload} homeHref={props.homeHref}
                actions={readOnly ? props.actions : (
                  <>
                    {props.actions}
                    <button type="button" className="btn h-7 px-2 py-0 text-[11px]" onClick={() => setHistoryOpen(true)}>History</button>
                    <button type="button" className="btn btn-accent h-7 px-2 py-0 text-[11px]" onClick={openPicker} disabled={busy}>{busy ? "Loading…" : "Update data"}</button>
                  </>
                )} />
              <FilterRow />
              <main className="flex-1">
                {page && <Grid page={page} insights={props.insights} />}
              </main>
              <footer className="flex h-7 items-center justify-between border-t border-line px-3 text-[10.5px] text-ink-4">
                <span className="num">{snapshot.n} rows · version {snapshot.version}{readOnly ? "" : " · drop a workbook anywhere to update"}</span>
                <span className="label">Meridian</span>
              </footer>
            </div>
          )}
        </UploadFlow>
        {!readOnly && <HistoryDrawer projectId={props.projectId} currentUploadId={upload?.id ?? null} open={historyOpen} onClose={() => setHistoryOpen(false)} refreshKey={refreshKey} onRestored={() => { setHistoryOpen(false); void refresh(); }} />}
      </DashboardProvider>
    </TooltipProvider>
  );
}

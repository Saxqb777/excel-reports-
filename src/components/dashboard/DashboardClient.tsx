"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Layout as RglLayout } from "react-grid-layout";
import type { Snapshot } from "@/lib/schema/types";
import type { Layout, Page, Theme, Widget } from "@/lib/dashboard/types";
import type { UploadSummary } from "@/lib/data/projects";
import type { Intelligence } from "@/lib/data/intelligence";
import { DashboardProvider } from "@/lib/ui/dashboard-state";
import { TooltipProvider } from "@/lib/ui/tooltip";
import { TopBar } from "./TopBar";
import { FilterRow } from "./FilterRow";
import { Grid } from "./Grid";
import { UploadFlow } from "./UploadFlow";
import { HistoryDrawer } from "./HistoryDrawer";
import { AskPanel } from "./AskPanel";
import { SharePanel } from "./SharePanel";
import { Boardroom } from "./Boardroom";
import { ExportMenu } from "./ExportMenu";
import { applyTheme } from "./ThemeToggle";

export interface DashboardProps {
  projectId: string;
  slug?: string;
  name: string;
  clientName?: string | null;
  theme: Theme;
  layout: Layout;
  snapshot: Snapshot;
  upload: UploadSummary | null;
  intelligence?: Intelligence | null;
  actions?: ReactNode;
  homeHref?: string | null;
  /** View-only surfaces (share links) hide upload, history, editing and Ask. */
  readOnly?: boolean;
  share?: { token: string; enabled: boolean; hasPassword: boolean };
  boardroom?: boolean;
  print?: { page?: string; theme?: "dark" | "light" };
}

export function DashboardClient(props: DashboardProps) {
  const { theme } = props;
  const [layout, setLayout] = useState(props.layout);
  const [pageId, setPageId] = useState(props.print?.page ?? props.layout.pages[0]?.id ?? "");
  const [snapshot, setSnapshot] = useState(props.snapshot);
  const [upload, setUpload] = useState(props.upload);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [share, setShare] = useState(props.share);
  const [intel, setIntel] = useState<Intelligence | null>(props.intelligence ?? null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [reloading, setReloading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [board, setBoard] = useState(Boolean(props.boardroom));
  const savedLayout = useRef(props.layout);
  useEffect(() => setSnapshot(props.snapshot), [props.snapshot]);
  useEffect(() => setUpload(props.upload), [props.upload]);
  useEffect(() => setIntel(props.intelligence ?? null), [props.intelligence]);
  useEffect(() => { setLayout(props.layout); savedLayout.current = props.layout; }, [props.layout]);
  const page = layout.pages.find((p) => p.id === pageId) ?? layout.pages[0];
  useEffect(() => { document.documentElement.style.setProperty("--accent", theme.primary); }, [theme.primary]);
  useEffect(() => { if (props.print?.theme) applyTheme(props.print.theme); }, [props.print?.theme]);

  const refresh = useCallback(async () => {
    setReloading(true);
    const [snapRes, upRes] = await Promise.all([fetch(`/api/projects/${props.projectId}/snapshot`, { cache: "no-store" }), fetch(`/api/projects/${props.projectId}/uploads`, { cache: "no-store" })]);
    if (snapRes.ok) setSnapshot(await snapRes.json());
    if (upRes.ok) { const j = await upRes.json(); const cur = (j.uploads as UploadSummary[]).find((u) => u.id === j.currentUploadId) ?? null; setUpload(cur); }
    setRefreshKey((k) => k + 1);
    setReloading(false);
    fetch(`/api/projects/${props.projectId}/intelligence`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setIntel(j); }).catch(() => {});
    fetch(`/api/projects/${props.projectId}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.project?.layout) { setLayout(j.project.layout); savedLayout.current = j.project.layout; } }).catch(() => {});
  }, [props.projectId]);

  // ----- layout editing -----
  const updatePage = useCallback((fn: (p: Page) => Page) => {
    setLayout((l) => ({ ...l, pages: l.pages.map((p) => (p.id === page.id ? fn(p) : p)) }));
    setDirty(true);
  }, [page.id]);
  const onLayoutChange = useCallback((l: RglLayout) => {
    updatePage((p) => ({ ...p, grid: p.grid.map((g) => { const n = l.find((x) => x.i === g.i); return n ? { ...g, x: n.x, y: n.y, w: n.w, h: n.h } : g; }) }));
  }, [updatePage]);
  const hideWidget = useCallback((id: string) => updatePage((p) => ({ ...p, hidden: [...new Set([...(p.hidden ?? []), id])] })), [updatePage]);
  const showWidget = useCallback((id: string) => updatePage((p) => ({ ...p, hidden: (p.hidden ?? []).filter((x) => x !== id) })), [updatePage]);
  const pinWidget = useCallback((w: Widget) => {
    const id = `pin_${Date.now().toString(36)}`;
    const widget = { ...w, id } as Widget;
    updatePage((p) => ({ ...p, widgets: [...p.widgets, widget], grid: [...p.grid, { i: id, x: 0, y: p.grid.reduce((a, g) => Math.max(a, g.y + g.h), 0), w: w.type === "kpi" ? 3 : 6, h: w.type === "kpi" ? 3 : 7 }] }));
    setAskOpen(false);
    setEditing(true);
  }, [updatePage]);
  const saveLayout = async () => {
    setSaving(true);
    const res = await fetch(`/api/projects/${props.projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout }) });
    setSaving(false);
    if (res.ok) { savedLayout.current = layout; setDirty(false); setEditing(false); }
  };
  const discard = () => { setLayout(savedLayout.current); setDirty(false); setEditing(false); };
  const resetLayout = async () => {
    setSaving(true);
    const res = await fetch(`/api/projects/${props.projectId}/layout/reset`, { method: "POST" });
    setSaving(false);
    if (res.ok) { const j = await res.json(); setLayout(j.layout); savedLayout.current = j.layout; setDirty(false); setEditing(false); setPageId(j.layout.pages[0]?.id ?? ""); }
  };
  const hiddenWidgets = useMemo(() => (page.hidden ?? []).map((id) => page.widgets.find((w) => w.id === id)).filter((w): w is Widget => Boolean(w)), [page]);

  const readOnly = props.readOnly ?? false;
  const intelligence = { insights: intel?.insights, anomalies: intel?.anomalies, comparedTo: intel?.comparedTo, previousKpis: intel?.previousKpis };

  if (board) {
    return (
      <TooltipProvider>
        <DashboardProvider snapshot={snapshot} layout={layout}>
          <Boardroom pages={layout.pages} theme={theme} name={props.name} clientName={props.clientName} upload={upload} intelligence={intelligence} onExit={() => setBoard(false)} />
        </DashboardProvider>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <DashboardProvider snapshot={snapshot} layout={layout}>
        <UploadFlow projectId={props.projectId} onDone={() => void refresh()}>
          {({ openPicker, busy }) => (
            <div className={`flex min-h-screen flex-col bg-bg transition-opacity duration-300 ${reloading || busy ? "opacity-80" : ""} ${props.print ? "print-mode" : ""}`} data-print={props.print ? "1" : undefined}>
              {!props.print && (
                <TopBar theme={theme} name={props.name} clientName={props.clientName} pages={layout.pages.map((p) => ({ id: p.id, title: p.title }))} activePage={page.id} onPage={setPageId} upload={upload} homeHref={props.homeHref}
                  actions={readOnly ? (
                    <>
                      <ExportMenu projectId={props.projectId} pageId={page.id} name={props.name} />
                      <button type="button" className="btn h-7 px-2 py-0 text-[11px]" onClick={() => setBoard(true)} title="Full-screen boardroom mode">Boardroom</button>
                    </>
                  ) : editing ? (
                    <>
                      <span className="label hidden md:inline">Editing layout · drag, resize, hide</span>
                      <button type="button" className="btn h-7 px-2 py-0 text-[11px]" onClick={resetLayout} disabled={saving} title="Back to the proposed layout">Reset</button>
                      <button type="button" className="btn h-7 px-2 py-0 text-[11px]" onClick={discard} disabled={saving}>Discard</button>
                      <button type="button" className="btn btn-accent h-7 px-2 py-0 text-[11px]" onClick={saveLayout} disabled={saving || !dirty}>{saving ? "Saving…" : "Save layout"}</button>
                    </>
                  ) : (
                    <>
                      {props.actions}
                      <button type="button" className="btn h-7 px-2 py-0 text-[11px]" onClick={() => setAskOpen(true)}>Ask</button>
                      <button type="button" className="btn h-7 px-2 py-0 text-[11px]" onClick={() => setEditing(true)}>Edit layout</button>
                      <ExportMenu projectId={props.projectId} pageId={page.id} name={props.name} />
                      <button type="button" className="btn h-7 px-2 py-0 text-[11px]" onClick={() => setBoard(true)} title="Full-screen boardroom mode">Boardroom</button>
                      {share && <button type="button" className="btn h-7 px-2 py-0 text-[11px]" onClick={() => setShareOpen(true)}>Share</button>}
                      <button type="button" className="btn h-7 px-2 py-0 text-[11px]" onClick={() => setHistoryOpen(true)}>History</button>
                      {props.slug && <Link href={`/p/${props.slug}/settings`} className="btn h-7 px-2 py-0 text-[11px] leading-7">Settings</Link>}
                      <button type="button" className="btn btn-accent h-7 px-2 py-0 text-[11px]" onClick={openPicker} disabled={busy}>{busy ? "Loading…" : "Update data"}</button>
                    </>
                  )} />
              )}
              {!props.print && <FilterRow />}
              {editing && hiddenWidgets.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
                  <span className="label">Hidden</span>
                  {hiddenWidgets.map((w) => <button key={w.id} type="button" className="chip" onClick={() => showWidget(w.id)} title="Show again">{w.title} +</button>)}
                </div>
              )}
              <main className="flex-1" key={page.id} style={{ animation: "fade-in 180ms ease both" }}>
                {page && <Grid page={page} editable={editing} onLayoutChange={onLayoutChange} onHide={hideWidget} intelligence={intelligence} />}
              </main>
              {!props.print && (
                <footer className="flex h-7 items-center justify-between border-t border-line px-3 text-[10.5px] text-ink-4">
                  <span className="num">{snapshot.n} rows · version {snapshot.version}{readOnly ? "" : " · drop a workbook anywhere to update"}</span>
                  <span className="label">{props.clientName ? `${props.name} · ` : ""}Meridian</span>
                </footer>
              )}
            </div>
          )}
        </UploadFlow>
        {!readOnly && <HistoryDrawer projectId={props.projectId} currentUploadId={upload?.id ?? null} open={historyOpen} onClose={() => setHistoryOpen(false)} refreshKey={refreshKey} onRestored={() => { setHistoryOpen(false); void refresh(); }} />}
        {!readOnly && <AskPanel projectId={props.projectId} open={askOpen} onClose={() => setAskOpen(false)} onPin={pinWidget} />}
        {!readOnly && share && <SharePanel projectId={props.projectId} token={share.token} enabled={share.enabled} hasPassword={share.hasPassword} open={shareOpen} onClose={() => setShareOpen(false)} onChanged={(s) => setShare({ ...share, ...s })} />}
      </DashboardProvider>
    </TooltipProvider>
  );
}

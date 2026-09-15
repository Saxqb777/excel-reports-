"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { Snapshot } from "@/lib/schema/types";
import type { Layout, Theme } from "@/lib/dashboard/types";
import type { UploadSummary } from "@/lib/data/projects";
import { DashboardProvider } from "@/lib/ui/dashboard-state";
import { TooltipProvider } from "@/lib/ui/tooltip";
import { TopBar } from "./TopBar";
import { FilterRow } from "./FilterRow";
import { Grid } from "./Grid";
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
}

export function DashboardClient(props: DashboardProps) {
  const { layout, theme } = props;
  const [pageId, setPageId] = useState(layout.pages[0]?.id ?? "");
  const [snapshot, setSnapshot] = useState(props.snapshot);
  useEffect(() => setSnapshot(props.snapshot), [props.snapshot]);
  const page = layout.pages.find((p) => p.id === pageId) ?? layout.pages[0];
  useEffect(() => { document.documentElement.style.setProperty("--accent", theme.primary); }, [theme.primary]);
  return (
    <TooltipProvider>
      <DashboardProvider snapshot={snapshot} layout={layout}>
        <div className="flex min-h-screen flex-col bg-bg">
          <TopBar theme={theme} name={props.name} clientName={props.clientName} pages={layout.pages.map((p) => ({ id: p.id, title: p.title }))} activePage={page.id} onPage={setPageId} upload={props.upload} actions={props.actions} homeHref={props.homeHref} />
          <FilterRow />
          <main className="flex-1">
            {page && <Grid page={page} insights={props.insights} />}
          </main>
          <footer className="flex h-7 items-center justify-between border-t border-line px-3 text-[10.5px] text-ink-4">
            <span className="num">{snapshot.n} rows · version {snapshot.version}</span>
            <span className="label">Meridian</span>
          </footer>
        </div>
      </DashboardProvider>
    </TooltipProvider>
  );
}

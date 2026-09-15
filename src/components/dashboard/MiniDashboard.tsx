"use client";
import type { Layout, Theme } from "@/lib/dashboard/types";
import type { Snapshot } from "@/lib/schema/types";
import { DashboardProvider } from "@/lib/ui/dashboard-state";
import { Grid, ROW_HEIGHT } from "./Grid";
import { useSize } from "@/components/charts/useSize";

const BASE_W = 1280;
const ROWS = 12;

/** A live, scaled-down render of a project's first page. Real widgets on real data, not a screenshot. */
export function MiniDashboard({ layout, snapshot, theme }: { layout: Layout; snapshot: Snapshot; theme: Theme }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const page = layout.pages[0];
  const scale = size.width > 0 ? size.width / BASE_W : 0.3;
  const height = ROWS * (ROW_HEIGHT + 1);
  return (
    <div ref={ref} className="relative w-full overflow-hidden" style={{ height: height * scale, "--accent": theme.primary } as React.CSSProperties} aria-hidden>
      <div className="pointer-events-none absolute left-0 top-0 origin-top-left select-none" style={{ width: BASE_W, height, transform: `scale(${scale})` }}>
        <DashboardProvider snapshot={snapshot} layout={layout}>
          {page && <Grid page={page} compact />}
        </DashboardProvider>
      </div>
    </div>
  );
}

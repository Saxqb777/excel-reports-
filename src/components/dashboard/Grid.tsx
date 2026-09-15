"use client";
import { useEffect, useState } from "react";
import GridLayout, { useContainerWidth, verticalCompactor, type Layout as RglLayout, type LayoutItem } from "react-grid-layout";
import type { Page, Widget } from "@/lib/dashboard/types";
import { WidgetRenderer, type IntelligenceProps } from "@/components/widgets/WidgetRenderer";
import { TileActionsProvider } from "@/components/widgets/Tile";

export const ROW_HEIGHT = 36;
const PHONE_MAX = 720;

/** Below phone width, tiles stack in reading order: KPIs two per row, everything else full width. */
function phoneLayout(page: Page, hidden: Set<string>): RglLayout {
  const items = page.grid.filter((g) => !hidden.has(g.i)).slice().sort((a, b) => a.y - b.y || a.x - b.x);
  const out: LayoutItem[] = [];
  let y = 0, kpiCol = 0;
  for (const g of items) {
    const w = page.widgets.find((x) => x.id === g.i);
    const t = w?.type;
    if (t === "kpi") {
      out.push({ i: g.i, x: kpiCol, y, w: 1, h: 4, static: true });
      if (kpiCol === 1) { kpiCol = 0; y += 4; } else kpiCol = 1;
      continue;
    }
    if (kpiCol === 1) { kpiCol = 0; y += 4; }
    const h = t === "insights" ? 6 : t === "table" ? Math.max(11, g.h) : t === "quality" ? 22 : Math.max(6, Math.min(g.h, 9));
    out.push({ i: g.i, x: 0, y, w: 2, h, static: true });
    y += h;
  }
  return out;
}

export function Grid({ page, editable = false, onLayoutChange, onHide, intelligence, compact = false }: { page: Page; editable?: boolean; onLayoutChange?: (l: RglLayout) => void; onHide?: (id: string) => void; intelligence?: IntelligenceProps; compact?: boolean }) {
  const { width, containerRef, mounted } = useContainerWidth();
  const [expanded, setExpanded] = useState<Widget | null>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(null); }; if (expanded) window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [expanded]);
  const hidden = new Set(page.hidden ?? []);
  const items = page.grid.filter((g) => !hidden.has(g.i));
  const phone = !compact && width > 0 && width < PHONE_MAX;
  const layout: RglLayout = phone ? phoneLayout(page, hidden) : items.map((g) => ({ ...g, static: !editable }));
  const canEdit = editable && !phone;
  return (
    <div ref={containerRef} className="w-full bg-line">
      {mounted && width > 0 && (
        <GridLayout
          key={page.id}
          width={width}
          layout={layout}
          gridConfig={{ cols: phone ? 2 : 12, rowHeight: ROW_HEIGHT, margin: [1, 1], containerPadding: [0, 0] }}
          dragConfig={{ enabled: canEdit, handle: ".drag-handle" }}
          resizeConfig={{ enabled: canEdit }}
          compactor={verticalCompactor}
          onLayoutChange={(l) => canEdit && onLayoutChange?.(l)}
        >
          {items.map((g, i) => {
            const w = page.widgets.find((x) => x.id === g.i);
            const expandable = Boolean(w && w.type !== "kpi" && w.type !== "insights" && !compact);
            return (
              <div key={g.i} className={`tile ${canEdit ? "outline outline-1 outline-dashed outline-[var(--line-strong)]" : ""}`}>
                <div className="h-full w-full" style={{ animation: compact ? undefined : `tile-in 320ms cubic-bezier(.2,.7,.2,1) both`, animationDelay: `${Math.min(i, 12) * 22}ms` }}>
                  {canEdit && <div className="drag-handle absolute inset-x-0 top-0 z-[2] h-8 cursor-grab active:cursor-grabbing" title="Drag to move" />}
                  <TileActionsProvider value={{ expand: expandable ? () => setExpanded(w!) : undefined, hide: canEdit && onHide ? () => onHide(g.i) : undefined, editing: canEdit }}>
                    {w ? <WidgetRenderer w={w} {...intelligence} /> : <div className="p-3 text-[14px] text-ink-3">Missing widget {g.i}</div>}
                  </TileActionsProvider>
                </div>
              </div>
            );
          })}
        </GridLayout>
      )}
      {expanded && (
        <div className="fixed inset-0 z-[70] bg-[color-mix(in_oklab,var(--bg-sunk)_78%,transparent)] p-2 sm:p-6 md:p-10" onClick={() => setExpanded(null)}>
          <div className="relative h-full w-full border border-line bg-bg shadow-[var(--shadow-pop)]" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={expanded.title}>
            <button type="button" className="chip absolute right-3 top-[5px] z-[2] h-[22px]" onClick={() => setExpanded(null)}>close ×</button>
            <TileActionsProvider value={{}}>
              <WidgetRenderer w={expanded} {...intelligence} />
            </TileActionsProvider>
          </div>
        </div>
      )}
    </div>
  );
}

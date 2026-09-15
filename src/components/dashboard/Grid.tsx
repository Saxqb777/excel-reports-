"use client";
import GridLayout, { useContainerWidth, verticalCompactor, type Layout as RglLayout } from "react-grid-layout";
import type { Page } from "@/lib/dashboard/types";
import { WidgetRenderer, type IntelligenceProps } from "@/components/widgets/WidgetRenderer";

export const ROW_HEIGHT = 36;

export function Grid({ page, editable = false, onLayoutChange, intelligence }: { page: Page; editable?: boolean; onLayoutChange?: (l: RglLayout) => void; intelligence?: IntelligenceProps }) {
  const { width, containerRef, mounted } = useContainerWidth();
  const hidden = new Set(page.hidden ?? []);
  const items = page.grid.filter((g) => !hidden.has(g.i));
  const layout: RglLayout = items.map((g) => ({ ...g, static: !editable }));
  return (
    <div ref={containerRef} className="w-full bg-line">
      {mounted && width > 0 && (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: 12, rowHeight: ROW_HEIGHT, margin: [1, 1], containerPadding: [0, 0] }}
          dragConfig={{ enabled: editable, handle: ".drag-handle" }}
          resizeConfig={{ enabled: editable }}
          compactor={verticalCompactor}
          onLayoutChange={(l) => editable && onLayoutChange?.(l)}
        >
          {items.map((g) => {
            const w = page.widgets.find((x) => x.id === g.i);
            return (
              <div key={g.i} className="tile">
                {editable && <div className="drag-handle absolute inset-x-0 top-0 z-[2] h-8 cursor-grab active:cursor-grabbing" />}
                {w ? <WidgetRenderer w={w} {...intelligence} /> : <div className="p-3 text-[11px] text-ink-3">Missing widget {g.i}</div>}
              </div>
            );
          })}
        </GridLayout>
      )}
    </div>
  );
}

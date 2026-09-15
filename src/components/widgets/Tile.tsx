"use client";
import type { ReactNode } from "react";

export function Tile({ title, subtitle, right, children, onClear, selected, padded = true }: { title: string; subtitle?: string; right?: ReactNode; children: ReactNode; onClear?: () => void; selected?: boolean; padded?: boolean }) {
  return (
    <section className="tile h-full w-full" aria-label={title}>
      <header className="flex h-8 shrink-0 items-center justify-between gap-3 px-3.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="label-strong truncate">{title}</h3>
          {subtitle && <span className="truncate text-[11px] text-ink-3">{subtitle}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {selected && onClear && (
            <button type="button" onClick={onClear} className="chip chip-on h-[18px] px-1.5 text-[10px]" title="Clear this selection">filtering ×</button>
          )}
          {right}
        </div>
      </header>
      <div className={`min-h-0 flex-1 ${padded ? "px-3.5 pb-3" : ""}`}>{children}</div>
    </section>
  );
}

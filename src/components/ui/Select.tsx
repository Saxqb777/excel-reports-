"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface SelectOption { value: string; label: string; count?: number; tone?: string }

/** Terminal-style select: a label, the current value, a popover list with counts. Keyboard: arrows, Enter, Escape. */
export function Select({ label, value, options, onChange, anyLabel = "Any", className = "" }: { label: string; value: string; options: SelectOption[]; onChange: (v: string) => void; anyLabel?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  const all = useMemo<SelectOption[]>(() => [{ value: "", label: anyLabel }, ...options], [anyLabel, options]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  useEffect(() => { if (open) setActive(Math.max(0, all.findIndex((o) => o.value === value))); }, [open, value, all]);
  const current = all.find((o) => o.value === value) ?? all[0];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); else setActive((a) => Math.min(all.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (!open) setOpen(true); else { onChange(all[active].value); setOpen(false); } }
    else if (e.key === "Escape") setOpen(false);
  };
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} onKeyDown={onKey}
        className={`flex h-[24px] items-center gap-1.5 border px-2 text-[11px] transition-colors ${value ? "border-accent bg-[var(--accent-wash)] text-ink" : "border-line text-ink-2 hover:border-line-strong hover:text-ink"}`}>
        <span className="label">{label}</span>
        <span className={`num max-w-[160px] truncate ${value ? "text-ink" : "text-ink-3"}`}>{current.label}</span>
        <span className="text-ink-4" aria-hidden>▾</span>
      </button>
      {open && (
        <ul id={id} role="listbox" className="absolute left-0 top-[26px] z-[40] max-h-72 min-w-[220px] overflow-auto border border-line bg-bg-elev py-1 shadow-[var(--shadow-pop)]">
          {all.map((o, i) => {
            const selected = o.value === value;
            return (
              <li key={o.value} role="option" aria-selected={selected} onMouseEnter={() => setActive(i)} onClick={() => { onChange(o.value); setOpen(false); }}
                className={`flex cursor-pointer items-center justify-between gap-4 px-2.5 py-1 text-[12px] ${i === active ? "bg-bg-hover" : ""} ${selected ? "text-ink" : "text-ink-2"}`}>
                <span className="flex items-center gap-2"><span className={`num w-2 ${selected ? "text-accent" : "text-transparent"}`}>●</span>{o.label}</span>
                {o.count !== undefined && <span className="num text-[11px] text-ink-3">{o.count}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

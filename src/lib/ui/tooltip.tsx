"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface TooltipRow { key?: string; label: string; value: string; color?: string; muted?: boolean }
export interface TooltipContent { title?: string; rows?: TooltipRow[]; note?: string }

interface Ctx { show: (x: number, y: number, c: TooltipContent) => void; move: (x: number, y: number) => void; hide: () => void }

const TooltipCtx = createContext<Ctx | null>(null);

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ x: number; y: number; c: TooltipContent } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const api = useMemo<Ctx>(() => ({
    show: (x, y, c) => setState({ x, y, c }),
    move: (x, y) => setState((s) => (s ? { ...s, x, y } : s)),
    hide: () => setState(null),
  }), []);
  let left = 0, top = 0;
  if (state && typeof window !== "undefined") {
    const w = ref.current?.offsetWidth ?? 220, h = ref.current?.offsetHeight ?? 80;
    left = state.x + 14; top = state.y + 14;
    if (left + w > window.innerWidth - 8) left = state.x - w - 14;
    if (top + h > window.innerHeight - 8) top = state.y - h - 14;
  }
  return (
    <TooltipCtx.Provider value={api}>
      {children}
      {mounted && state && createPortal(
        <div ref={ref} role="tooltip" style={{ left, top }} className="pointer-events-none fixed z-[100] min-w-[160px] max-w-[320px] border border-line bg-bg-elev px-3 py-2 text-[11px] leading-snug text-ink shadow-[var(--shadow-pop)]">
          {state.c.title && <div className="mb-1 font-medium text-ink">{state.c.title}</div>}
          {state.c.rows?.map((r, i) => (
            <div key={r.key ?? i} className="flex items-baseline justify-between gap-4">
              <span className="flex items-center gap-2 text-ink-2">
                {r.color && <span className="inline-block h-[2px] w-3" style={{ background: r.color }} />}
                {r.label}
              </span>
              <span className={`num ${r.muted ? "text-ink-3" : "font-medium text-ink"}`}>{r.value}</span>
            </div>
          ))}
          {state.c.note && <div className="mt-1 text-ink-3">{state.c.note}</div>}
        </div>,
        document.body,
      )}
    </TooltipCtx.Provider>
  );
}

export function useTooltip() {
  const ctx = useContext(TooltipCtx);
  const show = useCallback((e: { clientX: number; clientY: number }, c: TooltipContent) => ctx?.show(e.clientX, e.clientY, c), [ctx]);
  const move = useCallback((e: { clientX: number; clientY: number }) => ctx?.move(e.clientX, e.clientY), [ctx]);
  const hide = useCallback(() => ctx?.hide(), [ctx]);
  return { show, move, hide };
}

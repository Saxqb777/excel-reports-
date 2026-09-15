"use client";
import { useEffect, useRef, useState } from "react";
import type { Page, Theme } from "@/lib/dashboard/types";
import type { UploadSummary } from "@/lib/data/projects";
import { Grid } from "./Grid";
import type { IntelligenceProps } from "@/components/widgets/WidgetRenderer";
import { formatDateTime } from "@/lib/engine/format";

const INTERVAL = 20_000;

/** Full-screen, no chrome, auto-cycling pages. Built for a TV on a wall. Space pauses, arrows move, Esc exits. */
export function Boardroom({ pages, theme, name, clientName, upload, intelligence, onExit }: { pages: Page[]; theme: Theme; name: string; clientName?: string | null; upload: UploadSummary | null; intelligence?: IntelligenceProps; onExit: () => void }) {
  const visible = pages.filter((p) => !p.widgets.every((w) => w.type === "quality"));
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [clock, setClock] = useState("");
  const start = useRef(performance.now());
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (el && document.fullscreenEnabled && !document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
    return () => { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); };
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
      else if (e.key === " ") { e.preventDefault(); setPaused((p) => !p); }
      else if (e.key === "ArrowRight") { setIndex((i) => (i + 1) % visible.length); start.current = performance.now(); }
      else if (e.key === "ArrowLeft") { setIndex((i) => (i - 1 + visible.length) % visible.length); start.current = performance.now(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onExit, visible.length]);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      if (!paused) {
        const p = (now - start.current) / INTERVAL;
        if (p >= 1) { setIndex((i) => (i + 1) % visible.length); start.current = now; setProgress(0); }
        else setProgress(p);
      } else start.current = now - progress * INTERVAL;
      setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, visible.length, progress]);
  const page = visible[index] ?? visible[0];
  return (
    <div ref={rootRef} className="flex min-h-screen flex-col bg-bg" onDoubleClick={onExit}>
      <div className="h-[2px] w-full bg-line"><div className="h-full" style={{ width: `${progress * 100}%`, background: "var(--accent)", transition: paused ? "none" : "width 120ms linear" }} /></div>
      <header className="flex h-12 items-center justify-between px-5">
        <div className="flex items-center gap-3">
          {theme.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={theme.logoUrl} alt="" className="h-6 w-auto max-w-[120px] object-contain" />
          ) : <span className="num flex h-6 min-w-6 items-center justify-center px-1 text-[14px] font-semibold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{(theme.monogram ?? name.slice(0, 2)).toUpperCase()}</span>}
          <span className="text-[15px] font-semibold text-ink">{name}</span>
          {clientName && <span className="text-[14px] text-ink-3">{clientName}</span>}
          <span className="label ml-4">{page?.title}</span>
          <span className="num text-[14px] text-ink-4">{index + 1} / {visible.length}{paused ? " · paused" : ""}</span>
        </div>
        <div className="num flex items-center gap-4 text-[14.5px] text-ink-3">
          {upload && <span>Updated {formatDateTime(upload.uploadedAt)}</span>}
          <span className="text-ink">{clock}</span>
        </div>
      </header>
      <main className="flex-1" key={page?.id} style={{ animation: "fade-in 400ms ease both" }}>
        {page && <Grid page={page} intelligence={intelligence} />}
      </main>
      <footer className="flex h-7 items-center justify-between px-5 text-[14.5px] text-ink-4">
        <span>Space pauses · arrows move · Esc or double-click exits</span>
        <span className="label">Meridian</span>
      </footer>
    </div>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { toPng } from "html-to-image";

/** Export the current page as PNG or every page as PDF. Server render first; client capture as the fallback for PNG. */
export function ExportMenu({ projectId, pageId, name }: { projectId: string; pageId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [open]);
  const theme = () => (document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
  const download = (blob: Blob, filename: string) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  const server = async (format: "png" | "pdf") => {
    setBusy(format); setError(null); setOpen(false);
    try {
      const res = await fetch(`/api/projects/${projectId}/export?format=${format}&page=${encodeURIComponent(pageId)}&theme=${theme()}&width=${Math.min(2560, Math.max(1280, window.innerWidth))}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Export failed (${res.status})`);
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = /filename="([^"]+)"/.exec(cd);
      download(await res.blob(), m?.[1] ?? `${name}.${format}`);
    } catch (e) {
      if (format === "png") { await clientPng(); return; }
      setError(e instanceof Error ? e.message : "Export failed");
    } finally { setBusy(null); }
  };
  const clientPng = async () => {
    setBusy("png-local");
    try {
      const el = document.querySelector("main") as HTMLElement | null;
      if (!el) throw new Error("Nothing to capture");
      const bg = getComputedStyle(document.body).backgroundColor;
      const url = await toPng(el, { pixelRatio: 2, backgroundColor: bg, filter: (n) => !(n instanceof HTMLElement && n.classList.contains("tile-actions")) });
      const blob = await (await fetch(url)).blob();
      download(blob, `${name}-${pageId}.png`);
    } catch (e) { setError(e instanceof Error ? e.message : "Export failed"); }
    finally { setBusy(null); }
  };
  return (
    <div ref={ref} className="relative">
      <button type="button" className="btn h-7 px-2 py-0 text-[11px]" onClick={() => setOpen((o) => !o)} disabled={Boolean(busy)}>{busy ? "Exporting…" : "Export"}</button>
      {open && (
        <div className="absolute right-0 top-8 z-[50] w-56 border border-line bg-bg-elev py-1 shadow-[var(--shadow-pop)]">
          <button type="button" className="block w-full px-3 py-1.5 text-left text-[12px] text-ink-2 hover:bg-bg-hover hover:text-ink" onClick={() => server("png")}>This page as PNG<span className="block text-[10.5px] text-ink-4">Rendered at 2× in the current theme</span></button>
          <button type="button" className="block w-full px-3 py-1.5 text-left text-[12px] text-ink-2 hover:bg-bg-hover hover:text-ink" onClick={() => server("pdf")}>All pages as PDF<span className="block text-[10.5px] text-ink-4">One landscape sheet per page</span></button>
        </div>
      )}
      {error && <div role="alert" className="absolute right-0 top-8 z-[50] w-64 border border-neg bg-bg px-3 py-2 text-[11.5px] text-ink"><span className="text-neg">Export failed.</span> {error} <button type="button" className="ml-2 text-ink-3 hover:text-ink" onClick={() => setError(null)}>Dismiss</button></div>}
    </div>
  );
}

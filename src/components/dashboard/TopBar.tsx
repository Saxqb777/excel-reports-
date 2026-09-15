"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Theme } from "@/lib/dashboard/types";
import type { UploadSummary } from "@/lib/data/projects";
import { formatDateTime } from "@/lib/engine/format";
import { ThemeToggle } from "./ThemeToggle";

export function TopBar({ theme, name, clientName, pages, activePage, onPage, upload, actions, homeHref = "/", scope }: { theme: Theme; name: string; clientName?: string | null; pages: { id: string; title: string }[]; activePage: string; onPage: (id: string) => void; upload: UploadSummary | null; actions?: ReactNode; homeHref?: string | null; scope?: string }) {
  const monogram = theme.monogram ?? name.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!menu) return; const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [menu]);
  return (
    <header className="shrink-0 border-b border-line bg-bg">
    <div className="flex h-11 items-center justify-between px-3">
      <div className="flex min-w-0 items-center gap-3">
        {homeHref && <Link href={homeHref} className="label hover:text-ink" aria-label="All projects">Meridian</Link>}
        {homeHref && <span className="h-4 w-px bg-line" />}
        <div className="flex items-center gap-2.5">
          {theme.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={theme.logoUrl} alt="" className="h-5 w-auto max-w-[96px] object-contain" />
          ) : (
            <span className="num flex h-5 min-w-5 items-center justify-center px-1 text-[14px] font-semibold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{monogram}</span>
          )}
          <span className="truncate text-[14px] font-semibold text-ink">{name}</span>
          {clientName && <span className="hidden truncate text-[14.5px] text-ink-3 sm:inline">{clientName}</span>}
        </div>
      </div>
      <nav className="hidden h-full items-stretch gap-1 lg:flex" aria-label="Dashboard pages">
        {pages.map((p) => (
          <button key={p.id} type="button" onClick={() => onPage(p.id)} className={`label relative px-3 transition-colors hover:text-ink ${activePage === p.id ? "text-ink" : ""}`} aria-current={activePage === p.id ? "page" : undefined}>
            {p.title}
            {activePage === p.id && <span className="absolute inset-x-3 bottom-0 h-[2px]" style={{ background: "var(--accent)" }} />}
          </button>
        ))}
      </nav>
      <div className="hidden items-center gap-2 lg:flex">
        {upload && (
          <div className="num hidden text-right text-[14px] leading-tight text-ink-3 xl:block" title={upload.fileName}>
            <div><span className="text-ink-2">Updated by {upload.uploadedBy}</span> · {formatDateTime(upload.uploadedAt)}</div>
            <div>Version {upload.versionNo} · {upload.rowCount} rows</div>
          </div>
        )}
        {actions}
        <ThemeToggle defaultMode={theme.mode} scope={scope} compact />
      </div>
      <div ref={menuRef} className="relative lg:hidden">
        <button type="button" className="btn h-7 px-2.5 py-0 text-[14px]" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">Menu</button>
        {menu && (
          <div role="menu" className="absolute right-0 top-9 z-[45] flex w-64 flex-col gap-2 border border-line bg-bg-elev p-3 shadow-[var(--shadow-pop)] [&_a]:w-full [&_button]:w-full [&_button]:justify-start" onClick={(e) => { if ((e.target as HTMLElement).closest("button,a")) setTimeout(() => setMenu(false), 50); }}>
            {upload && <div className="num text-[14px] leading-tight text-ink-3"><div><span className="text-ink-2">v{upload.versionNo}</span> · {formatDateTime(upload.uploadedAt)}</div><div>by {upload.uploadedBy} · {upload.rowCount} rows</div></div>}
            {actions}
            <ThemeToggle defaultMode={theme.mode} scope={scope} />
          </div>
        )}
      </div>
    </div>
    <nav className="flex h-9 items-stretch gap-1 overflow-x-auto border-t border-line px-1 lg:hidden" aria-label="Dashboard pages">
      {pages.map((p) => (
        <button key={p.id} type="button" onClick={() => onPage(p.id)} className={`label relative shrink-0 px-3 transition-colors hover:text-ink ${activePage === p.id ? "text-ink" : ""}`} aria-current={activePage === p.id ? "page" : undefined}>
          {p.title}
          {activePage === p.id && <span className="absolute inset-x-3 bottom-0 h-[2px]" style={{ background: "var(--accent)" }} />}
        </button>
      ))}
    </nav>
    </header>
  );
}

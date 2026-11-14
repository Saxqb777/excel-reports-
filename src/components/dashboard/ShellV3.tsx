"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Theme } from "@/lib/dashboard/types";
import type { UploadSummary } from "@/lib/data/projects";
import { formatDateTime } from "@/lib/engine/format";
import { ThemeToggle } from "./ThemeToggle";
import { PageIcon } from "./ShellV2";

/**
 * The glass look: a slim icon rail on the left (the active page glows in the brand colour), a header that names the
 * page and holds the filters, translucent cards with large radii on a soft gradient. Designed for dark and light alike,
 * with full-contrast text: glass is the surface, never the words. Switched on per project (settings.ui = "v3").
 */
export function ShellV3({ theme, name, description, pages, activePage, onPage, upload, primary, actions, homeHref = "/projects", scope, filters, banner, children, footer }: {
  theme: Theme; name: string; description?: string | null; pages: { id: string; title: string }[]; activePage: string; onPage: (id: string) => void; upload: UploadSummary | null;
  primary?: ReactNode; actions?: ReactNode; homeHref?: string | null; scope?: string; filters?: ReactNode; banner?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  const monogram = theme.monogram ?? name.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  const [more, setMore] = useState(false);
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!more) return; const h = (e: MouseEvent) => { if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMore(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [more]);
  const active = pages.find((p) => p.id === activePage);
  return (
    <div className="v3-bg flex min-h-screen" data-ui="v3">
      {/* Icon rail (laptop and up) */}
      <div className="v3-rail relative z-[40] hidden w-[76px] shrink-0 lg:block">
      <aside className="sticky top-0 flex h-screen w-[76px] flex-col items-center py-3" aria-label="Pages">
        {homeHref ? (
          <Link href={homeHref} className="v3-mono num flex h-11 w-11 items-center justify-center rounded-[14px] text-[15px] font-bold" title="Reports and analytics">{theme.logoUrl ? <img src={theme.logoUrl} alt="" className="h-7 w-7 object-contain" /> : monogram}</Link>
        ) : (
          <span className="v3-mono num flex h-11 w-11 items-center justify-center rounded-[14px] text-[15px] font-bold">{theme.logoUrl ? <img src={theme.logoUrl} alt="" className="h-7 w-7 object-contain" /> : monogram}</span>
        )}
        <nav className="mt-4 flex flex-col items-center gap-1.5" aria-label="Dashboard pages">
          {pages.map((p) => {
            const on = p.id === activePage;
            return (
              <button key={p.id} type="button" onClick={() => onPage(p.id)} aria-current={on ? "page" : undefined} aria-label={p.title} className={`v3-nav group relative flex h-11 w-11 items-center justify-center rounded-[14px] ${on ? "v3-nav-on" : ""}`}>
                <PageIcon title={p.title} on={on} size={20} />
                <span className="v3-tip pointer-events-none absolute left-[54px] top-1/2 z-[50] -translate-y-1/2 whitespace-nowrap rounded-[9px] px-2.5 py-1 text-[13.5px] font-medium opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{p.title}</span>
              </button>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-3">
          <ThemeToggle defaultMode={theme.mode} scope={scope} iconOnly />
        </div>
      </aside>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="v3-header sticky top-0 z-[30]">
          {/* Phone: compact header + page chips */}
          <div className="flex items-center gap-3 px-3 py-2 lg:hidden">
            <span className="v3-mono num flex h-8 min-w-8 items-center justify-center rounded-[10px] px-1.5 text-[13px] font-bold">{monogram}</span>
            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{name}</span>
            {primary}
            <div className="relative">
              <button type="button" className="btn h-8 px-2.5 py-0 text-[14px]" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">Menu</button>
              {menu && (
                <div role="menu" className="v3-pop absolute right-0 top-10 z-[45] flex w-64 flex-col gap-2 rounded-[14px] p-3 [&_a]:w-full [&_button]:w-full [&_button]:justify-start" onClick={(e) => { if ((e.target as HTMLElement).closest("button,a")) setTimeout(() => setMenu(false), 50); }}>
                  {upload && <div className="num text-[14px] leading-tight text-ink-3"><div><span className="text-ink-2">v{upload.versionNo}</span> · {formatDateTime(upload.uploadedAt)}</div><div>{upload.rowCount} rows</div></div>}
                  {actions}
                  <ThemeToggle defaultMode={theme.mode} scope={scope} />
                </div>
              )}
            </div>
          </div>
          <nav className="flex items-stretch gap-1 overflow-x-auto px-2 pb-2 lg:hidden" aria-label="Dashboard pages">
            {pages.map((p) => <button key={p.id} type="button" onClick={() => onPage(p.id)} className={`chip shrink-0 ${p.id === activePage ? "chip-on" : ""}`} aria-current={p.id === activePage ? "page" : undefined}>{p.title}</button>)}
          </nav>
          {/* Laptop: page title, filters, actions */}
          <div className="hidden items-center gap-4 px-5 py-2.5 lg:flex">
            <div className="min-w-0 shrink-0">
              <div className="truncate text-[20px] font-semibold leading-tight tracking-[-0.01em] text-ink">{active?.title ?? name}</div>
              <div className="num truncate text-[13px] leading-tight text-ink-3">{name}{upload ? <> · updated {formatDateTime(upload.uploadedAt)} · v{upload.versionNo}</> : null}</div>
            </div>
            <div className="min-w-0 flex-1">{filters}</div>
            <div className="flex shrink-0 items-center gap-2">
              {actions && (
                <div ref={moreRef} className="relative">
                  <button type="button" className="btn h-9 px-3 py-0 text-[14px]" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-haspopup="menu">More ▾</button>
                  {more && (
                    <div role="menu" className="v3-pop absolute right-0 top-11 z-[45] flex w-60 flex-col gap-1.5 rounded-[14px] p-2 [&_a]:w-full [&_button]:w-full [&_button]:justify-start" onClick={(e) => { if ((e.target as HTMLElement).closest("button,a")) setTimeout(() => setMore(false), 50); }}>
                      {actions}
                    </div>
                  )}
                </div>
              )}
              {primary}
            </div>
          </div>
        </header>
        {banner}
        <main className="flex-1">{children}</main>
        {description && <div className="px-5 pb-1 text-[13px] text-ink-3">{description}</div>}
        {footer}
      </div>
    </div>
  );
}

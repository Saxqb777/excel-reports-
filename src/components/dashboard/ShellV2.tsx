"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Theme } from "@/lib/dashboard/types";
import type { UploadSummary } from "@/lib/data/projects";
import { formatDateTime } from "@/lib/engine/format";
import { ThemeToggle } from "./ThemeToggle";

/**
 * The card look: pages down a left sidebar, filters and actions in a header, tiles as soft cards. Switched on per
 * project (settings.ui = "v2"); the terminal look stays the default for the others.
 */
export function ShellV2({ theme, name, description, pages, activePage, onPage, upload, primary, actions, homeHref = "/projects", scope, filters, banner, children, footer }: {
  theme: Theme; name: string; description?: string | null; pages: { id: string; title: string }[]; activePage: string; onPage: (id: string) => void; upload: UploadSummary | null;
  /** The main button (Add October / Update data). */
  primary?: ReactNode;
  /** Secondary actions (Ask, Edit layout, Export…): shown behind "More" in the header. */
  actions?: ReactNode;
  homeHref?: string | null; scope?: string; filters?: ReactNode; banner?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  const monogram = theme.monogram ?? name.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  const [more, setMore] = useState(false);
  const [menu, setMenu] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!more) return; const h = (e: MouseEvent) => { if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMore(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [more]);
  return (
    <div className="flex min-h-screen bg-bg" data-ui="v2">
      {/* Sidebar (laptop and up) */}
      <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r border-line bg-bg-elev lg:flex" aria-label="Pages">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          {theme.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={theme.logoUrl} alt="" className="h-7 w-auto max-w-[120px] object-contain" />
          ) : (
            <span className="num flex h-8 min-w-8 items-center justify-center rounded-[9px] px-1.5 text-[14px] font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{monogram}</span>
          )}
          <div className="min-w-0">
            <div className="truncate text-[14.5px] font-semibold leading-tight text-ink">{name}</div>
            {homeHref ? <Link href={homeHref} className="label block truncate hover:text-ink">Reports and analytics</Link> : <span className="label block truncate">Reports and analytics</span>}
          </div>
        </div>
        <nav className="flex flex-col gap-0.5 px-2 pt-1">
          {pages.map((p) => {
            const on = p.id === activePage;
            return (
              <button key={p.id} type="button" onClick={() => onPage(p.id)} aria-current={on ? "page" : undefined}
                className={`flex items-center gap-2.5 rounded-[9px] px-2.5 py-[7px] text-left text-[14.5px] transition-colors ${on ? "bg-[var(--accent-wash)] font-semibold text-ink" : "text-ink-2 hover:bg-bg-hover hover:text-ink"}`}>
                <PageIcon title={p.title} on={on} />
                <span className="truncate">{p.title}</span>
              </button>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-2 border-t border-line px-4 py-3">
          {upload && (
            <div className="num text-[13.5px] leading-snug text-ink-3" title={upload.fileName}>
              <div><span className="text-ink-2">Updated</span> {formatDateTime(upload.uploadedAt)}</div>
              <div>Version {upload.versionNo} · {upload.rowCount} rows</div>
            </div>
          )}
          {description && <div className="text-[13px] leading-snug text-ink-3">{description}</div>}
          <ThemeToggle defaultMode={theme.mode} scope={scope} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header: filters left, actions right */}
        <header className="sticky top-0 z-[30] border-b border-line bg-[color-mix(in_oklab,var(--bg)_88%,transparent)] backdrop-blur">
          <div className="flex items-center gap-3 px-3 py-2 lg:hidden">
            <span className="num flex h-7 min-w-7 items-center justify-center rounded-[8px] px-1.5 text-[13px] font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{monogram}</span>
            <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-ink">{name}</span>
            {primary}
            <div className="relative">
              <button type="button" className="btn h-7 px-2.5 py-0 text-[14px]" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu">Menu</button>
              {menu && (
                <div role="menu" className="absolute right-0 top-9 z-[45] flex w-64 flex-col gap-2 rounded-[12px] border border-line bg-bg-elev p-3 shadow-[var(--shadow-pop)] [&_a]:w-full [&_button]:w-full [&_button]:justify-start" onClick={(e) => { if ((e.target as HTMLElement).closest("button,a")) setTimeout(() => setMenu(false), 50); }}>
                  {upload && <div className="num text-[14px] leading-tight text-ink-3"><div><span className="text-ink-2">v{upload.versionNo}</span> · {formatDateTime(upload.uploadedAt)}</div><div>{upload.rowCount} rows</div></div>}
                  {actions}
                  <ThemeToggle defaultMode={theme.mode} scope={scope} />
                </div>
              )}
            </div>
          </div>
          <nav className="flex items-stretch gap-1 overflow-x-auto px-2 pb-1 lg:hidden" aria-label="Dashboard pages">
            {pages.map((p) => <button key={p.id} type="button" onClick={() => onPage(p.id)} className={`chip shrink-0 ${p.id === activePage ? "chip-on" : ""}`} aria-current={p.id === activePage ? "page" : undefined}>{p.title}</button>)}
          </nav>
          <div className="hidden items-center gap-3 px-4 py-2 lg:flex">
            <div className="min-w-0 flex-1">{filters}</div>
            <div className="flex shrink-0 items-center gap-2">
              {actions && (
                <div ref={moreRef} className="relative">
                  <button type="button" className="btn h-8 px-3 py-0 text-[14px]" onClick={() => setMore((m) => !m)} aria-expanded={more} aria-haspopup="menu">More ▾</button>
                  {more && (
                    <div role="menu" className="absolute right-0 top-10 z-[45] flex w-60 flex-col gap-1.5 rounded-[12px] border border-line bg-bg-elev p-2 shadow-[var(--shadow-pop)] [&_a]:w-full [&_button]:w-full [&_button]:justify-start" onClick={(e) => { if ((e.target as HTMLElement).closest("button,a")) setTimeout(() => setMore(false), 50); }}>
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
        {footer}
      </div>
    </div>
  );
}

export function PageIcon({ title, on, size = 16 }: { title: string; on: boolean; size?: number }) {
  const t = title.toLowerCase();
  const stroke = on ? "var(--accent)" : "currentColor";
  const common = { width: size, height: size, viewBox: "0 0 16 16", fill: "none", stroke, strokeWidth: size > 16 ? 1.4 : 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, className: "shrink-0" };
  if (/overview|executive|summary/.test(t)) return <svg {...common}><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>;
  if (/month|time|timing|trend/.test(t)) return <svg {...common}><rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 7h12M5 1.5v3M11 1.5v3" /></svg>;
  if (/destination|countr|map|lane|shipment|vessel/.test(t)) return <svg {...common}><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c2 2 2 10 0 12M8 2c-2 2-2 10 0 12" /></svg>;
  if (/^pending/.test(t)) return <svg {...common}><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></svg>;
  if (/^issued/.test(t)) return <svg {...common}><path d="M4 2h6l3 3v9H4z" /><path d="M6.5 9.5l1.5 1.5 3-3" /></svg>;
  if (/link|→/.test(t)) return <svg {...common}><path d="M6.5 9.5l3-3" /><path d="M7 4.5l1.2-1.2a2.5 2.5 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.2 1.2a2.5 2.5 0 0 1-3.5-3.5L5.5 8" /></svg>;
  if (/^checks?$/.test(t)) return <svg {...common}><path d="M8 2l6 11H2z" /><path d="M8 6.5v3M8 11.5v.01" /></svg>;
  if (/charge|cost|spend|payment|value|money|fee/.test(t)) return <svg {...common}><circle cx="8" cy="8" r="6" /><path d="M8 4.5v7M6 6.5h3a1.25 1.25 0 0 1 0 2.5H6.5a1.25 1.25 0 0 0 0 2.5H10" /></svg>;
  if (/supplier|origin|vendor|source/.test(t)) return <svg {...common}><path d="M2 5.5l6-3 6 3-6 3-6-3z" /><path d="M2 5.5v5l6 3 6-3v-5M8 8.5v5" /></svg>;
  if (/shipping line|carrier|line/.test(t)) return <svg {...common}><path d="M2 11l1.2 2.5h9.6L14 11H2z" /><path d="M4 11V6h8v5M6 6V3.5h4V6M8 3.5V2" /></svg>;
  if (/follow|alert|remind|action|check|pending/.test(t)) return <svg {...common}><path d="M4 14V2M4 2h8l-2 3 2 3H4" /></svg>;
  if (/reconcil|quality/.test(t)) return <svg {...common}><path d="M3 8.5l3 3 7-7" /></svg>;
  if (/register|all|table|list|po|vendor|customer/.test(t)) return <svg {...common}><path d="M3 4h10M3 8h10M3 12h10" /></svg>;
  return <svg {...common}><circle cx="8" cy="8" r="2.5" /></svg>;
}

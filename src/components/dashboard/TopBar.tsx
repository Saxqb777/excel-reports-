"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import type { Theme } from "@/lib/dashboard/types";
import type { UploadSummary } from "@/lib/data/projects";
import { formatDateTime } from "@/lib/engine/format";
import { ThemeToggle } from "./ThemeToggle";

export function TopBar({ theme, name, clientName, pages, activePage, onPage, upload, actions, homeHref = "/" }: { theme: Theme; name: string; clientName?: string | null; pages: { id: string; title: string }[]; activePage: string; onPage: (id: string) => void; upload: UploadSummary | null; actions?: ReactNode; homeHref?: string | null }) {
  const monogram = theme.monogram ?? name.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  return (
    <header className="flex h-11 shrink-0 items-center justify-between border-b border-line bg-bg px-3">
      <div className="flex min-w-0 items-center gap-3">
        {homeHref && <Link href={homeHref} className="label hover:text-ink" aria-label="All projects">Meridian</Link>}
        {homeHref && <span className="h-4 w-px bg-line" />}
        <div className="flex items-center gap-2.5">
          {theme.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={theme.logoUrl} alt="" className="h-5 w-auto max-w-[96px] object-contain" />
          ) : (
            <span className="num flex h-5 min-w-5 items-center justify-center px-1 text-[10px] font-semibold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{monogram}</span>
          )}
          <span className="truncate text-[13px] font-semibold text-ink">{name}</span>
          {clientName && <span className="hidden truncate text-[12px] text-ink-3 sm:inline">{clientName}</span>}
        </div>
      </div>
      <nav className="flex h-full items-stretch gap-1" aria-label="Dashboard pages">
        {pages.map((p) => (
          <button key={p.id} type="button" onClick={() => onPage(p.id)} className={`label relative px-3 transition-colors hover:text-ink ${activePage === p.id ? "text-ink" : ""}`} aria-current={activePage === p.id ? "page" : undefined}>
            {p.title}
            {activePage === p.id && <span className="absolute inset-x-3 bottom-0 h-[2px]" style={{ background: "var(--accent)" }} />}
          </button>
        ))}
      </nav>
      <div className="flex items-center gap-2">
        {upload && (
          <div className="num hidden text-right text-[11px] leading-tight text-ink-3 md:block" title={upload.fileName}>
            <div><span className="text-ink-2">v{upload.versionNo}</span> · {formatDateTime(upload.uploadedAt)}</div>
            <div>by {upload.uploadedBy} · {upload.rowCount} rows</div>
          </div>
        )}
        {actions}
        <ThemeToggle defaultMode={theme.mode} />
      </div>
    </header>
  );
}

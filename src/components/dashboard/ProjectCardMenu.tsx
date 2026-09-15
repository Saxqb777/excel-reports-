"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** The small menu on a project card: settings, share, delete with confirmation. */
export function ProjectCardMenu({ projectId, slug, name }: { projectId: string; slug: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setArmed(false); } }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, [open]);
  const del = async () => {
    setBusy(true);
    const res = await fetch(`/api/projects/${projectId}?confirm=yes`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) { setOpen(false); router.refresh(); } else alert((await res.json().catch(() => ({}))).error ?? "Could not delete.");
  };
  return (
    <div ref={ref} className="absolute right-2 top-2 z-[5]">
      <button type="button" className="chip h-[22px] bg-bg px-2 opacity-70 hover:opacity-100" onClick={() => { setOpen((o) => !o); setArmed(false); }} aria-label={`Options for ${name}`}>⋯</button>
      {open && (
        <div className="absolute right-0 top-7 w-56 border border-line bg-bg-elev py-1 text-[14.5px] shadow-[var(--shadow-pop)]">
          <Link href={`/p/${slug}`} className="block px-3 py-1.5 text-ink-2 hover:bg-bg-hover hover:text-ink">Open dashboard</Link>
          <Link href={`/p/${slug}/settings`} className="block px-3 py-1.5 text-ink-2 hover:bg-bg-hover hover:text-ink">Settings</Link>
          <div className="my-1 border-t border-line" />
          {!armed ? (
            <button type="button" className="block w-full px-3 py-1.5 text-left text-ink-2 hover:bg-bg-hover hover:text-neg" onClick={() => setArmed(true)}>Delete project…</button>
          ) : (
            <div className="px-3 py-1.5">
              <div className="mb-1.5 text-ink">Delete <span className="font-semibold">{name}</span> and all versions?</div>
              <div className="flex gap-2">
                <button type="button" className="btn h-6 border-neg px-2 py-0 text-[14px] text-neg" disabled={busy} onClick={del}>{busy ? "Deleting…" : "Yes, delete"}</button>
                <button type="button" className="btn h-6 px-2 py-0 text-[14px]" onClick={() => setArmed(false)}>Keep</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

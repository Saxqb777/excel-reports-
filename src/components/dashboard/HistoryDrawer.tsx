"use client";
import { useEffect, useState } from "react";
import type { UploadSummary } from "@/lib/data/projects";
import { formatDateTime } from "@/lib/engine/format";

export function HistoryDrawer({ projectId, currentUploadId, open, onClose, onRestored, refreshKey }: { projectId: string; currentUploadId: string | null; open: boolean; onClose: () => void; onRestored: (u: UploadSummary) => void; refreshKey: number }) {
  const [uploads, setUploads] = useState<UploadSummary[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/uploads`).then((r) => r.json()).then((j) => { if (!cancelled) setUploads(j.uploads ?? []); });
    return () => { cancelled = true; };
  }, [open, projectId, refreshKey]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; if (open) window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [open, onClose]);
  const [armed, setArmed] = useState<string | null>(null);
  if (!open) return null;
  const remove = async (u: UploadSummary) => {
    setBusy(u.id);
    const res = await fetch(`/api/projects/${projectId}/uploads/${u.id}`, { method: "DELETE" });
    setBusy(null); setArmed(null);
    if (res.ok) { setUploads((list) => (list ?? []).filter((x) => x.id !== u.id)); onRestored(u); }
    else alert((await res.json().catch(() => ({}))).error ?? "Could not delete this version.");
  };
  const restore = async (u: UploadSummary) => {
    setBusy(u.id);
    const res = await fetch(`/api/projects/${projectId}/uploads/${u.id}/activate`, { method: "POST" });
    setBusy(null);
    if (res.ok) onRestored(u);
  };
  return (
    <div className="fixed inset-0 z-[65]" onClick={onClose}>
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-line bg-bg shadow-[var(--shadow-pop)]" onClick={(e) => e.stopPropagation()} aria-label="Upload history">
        <div className="flex h-11 items-center justify-between border-b border-line px-4"><span className="label-strong">Upload history</span><button type="button" className="text-ink-3 hover:text-ink" onClick={onClose} aria-label="Close">×</button></div>
        <div className="min-h-0 flex-1 overflow-auto">
          {uploads === null ? <div className="p-4 text-[14.5px] text-ink-3">Loading…</div> : uploads.length === 0 ? <div className="p-4 text-[14.5px] text-ink-3">No uploads yet.</div> : (
            <ul className="divide-y divide-line">
              {uploads.map((u) => {
                const current = u.id === currentUploadId;
                return (
                  <li key={u.id} className={`px-4 py-3 ${current ? "bg-[var(--accent-wash)]" : ""}`}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="num text-[14px] font-medium text-ink">v{u.versionNo} {current && <span className="label ml-1 text-accent">live</span>}</span>
                      <span className="num text-[14px] text-ink-3">{formatDateTime(u.uploadedAt)}</span>
                    </div>
                    <div className="num mt-0.5 text-[14px] text-ink-2">{u.rowCount} rows · {u.excludedCount} excluded · by {u.uploadedBy}</div>
                    <div className="num mt-0.5 truncate text-[14px] text-ink-3" title={u.fileName}>{u.fileName} · {(u.fileSize / 1024).toFixed(1)} KB</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {!current && <button type="button" className="btn h-6 px-2 py-0 text-[14px]" disabled={busy === u.id} onClick={() => restore(u)}>{busy === u.id ? "Restoring…" : "Restore this version"}</button>}
                      <a className="btn h-6 px-2 py-0 text-[14px] leading-6" href={`/api/projects/${projectId}/uploads/${u.id}/file`}>Download file</a>
                      {(uploads?.length ?? 0) > 1 && (armed === u.id ? (
                        <>
                          <button type="button" className="btn h-6 border-neg px-2 py-0 text-[14px] text-neg" disabled={busy === u.id} onClick={() => remove(u)}>{busy === u.id ? "Deleting…" : "Confirm delete"}</button>
                          <button type="button" className="btn h-6 px-2 py-0 text-[14px]" onClick={() => setArmed(null)}>Cancel</button>
                        </>
                      ) : (
                        <button type="button" className="btn h-6 px-2 py-0 text-[14px] hover:border-neg hover:text-neg" onClick={() => setArmed(u.id)}>Delete</button>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t border-line px-4 py-2 text-[14px] text-ink-3">Restoring makes an older version live again. Nothing is deleted.</div>
      </aside>
    </div>
  );
}

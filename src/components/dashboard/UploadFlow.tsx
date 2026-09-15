"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DiffPayload } from "@/lib/data/uploads";

export interface UploadOutcome { uploadId: string; versionNo: number; rows: number; excluded: number; schemaChanged: boolean }

interface Props { projectId: string; onDone: (outcome: UploadOutcome) => void; children: (api: { openPicker: () => void; busy: boolean }) => React.ReactNode }

/** Drag-anywhere upload with schema-change confirmation. Wraps the dashboard so the drop zone is the whole page. */
export function UploadFlow({ projectId, onDone, children }: Props) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ file: File; diff: DiffPayload } | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [askName, setAskName] = useState<File | null>(null);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const depth = useRef(0);
  useEffect(() => { try { setName(localStorage.getItem("meridian-user") ?? ""); } catch {} }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 5000); return () => clearTimeout(t); }, [toast]);

  const send = useCallback(async (file: File, uploadedBy: string, confirm: boolean, map?: Record<string, string>) => {
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.set("file", file); fd.set("uploadedBy", uploadedBy);
    if (confirm) fd.set("confirm", "1");
    if (map) fd.set("mapping", JSON.stringify(map));
    const res = await fetch(`/api/projects/${projectId}/uploads`, { method: "POST", body: fd });
    const json = await res.json();
    setBusy(false);
    if (res.status === 409) { setPending({ file, diff: json.diff }); setMapping(Object.fromEntries((json.diff as DiffPayload).added.map((a) => [a.header, "new"]))); return; }
    if (!res.ok) { setError(json.error ?? "Upload failed"); return; }
    setPending(null);
    setToast(`Version ${json.versionNo} loaded · ${json.rows} rows${json.schemaChanged ? " · schema updated" : ""}`);
    onDone(json as UploadOutcome);
  }, [projectId, onDone]);

  const start = useCallback((file: File) => {
    if (!/\.(xlsx|xlsm|xls|csv)$/i.test(file.name)) { setError("Drop an Excel or CSV file."); return; }
    if (!name.trim()) { setAskName(file); return; }
    void send(file, name.trim(), false);
  }, [name, send]);

  useEffect(() => {
    const onEnter = (e: DragEvent) => { if (!e.dataTransfer?.types.includes("Files")) return; depth.current++; setDragging(true); };
    const onLeave = () => { depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setDragging(false); };
    const onOver = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); };
    const onDrop = (e: DragEvent) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); depth.current = 0; setDragging(false); start(e.dataTransfer.files[0]); };
    window.addEventListener("dragenter", onEnter); window.addEventListener("dragleave", onLeave); window.addEventListener("dragover", onOver); window.addEventListener("drop", onDrop);
    return () => { window.removeEventListener("dragenter", onEnter); window.removeEventListener("dragleave", onLeave); window.removeEventListener("dragover", onOver); window.removeEventListener("drop", onDrop); };
  }, [start]);

  return (
    <>
      <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) start(f); e.target.value = ""; }} />
      {children({ openPicker: () => inputRef.current?.click(), busy })}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-[color-mix(in_oklab,var(--bg)_82%,transparent)]">
          <div className="border border-accent bg-bg px-8 py-6 text-center">
            <div className="label mb-1 text-accent">Update data</div>
            <div className="text-[15px] font-medium">Drop the new workbook to refresh every visual</div>
            <div className="mt-1 text-[11.5px] text-ink-3">The previous version stays in history. Columns are checked against the known schema first.</div>
          </div>
        </div>
      )}
      {busy && (
        <div className="fixed inset-x-0 top-0 z-[70] h-[2px] overflow-hidden bg-line"><div className="h-full w-1/3 animate-[slide_1.1s_linear_infinite] bg-accent" /></div>
      )}
      {askName && (
        <Modal title="Who is uploading?" onClose={() => setAskName(null)}>
          <p className="text-[12.5px] text-ink-2">Shown next to the version as the uploader.</p>
          <input autoFocus className="field mt-3 w-full" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) { try { localStorage.setItem("meridian-user", name.trim()); } catch {} const f = askName; setAskName(null); void send(f, name.trim(), false); } }} />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setAskName(null)}>Cancel</button>
            <button type="button" className="btn btn-accent" disabled={!name.trim()} onClick={() => { try { localStorage.setItem("meridian-user", name.trim()); } catch {} const f = askName; setAskName(null); void send(f, name.trim(), false); }}>Continue</button>
          </div>
        </Modal>
      )}
      {pending && (
        <Modal title="The columns changed" onClose={() => setPending(null)} wide>
          <SchemaDiffView diff={pending.diff} mapping={mapping} setMapping={setMapping} />
          <div className="mt-5 flex items-center justify-between gap-3">
            <span className="text-[11.5px] text-ink-3">Confirming records the decisions in the project&rsquo;s schema, so future uploads with the same headers load without asking.</span>
            <div className="flex shrink-0 gap-2">
              <button type="button" className="btn" onClick={() => setPending(null)}>Cancel</button>
              <button type="button" className="btn btn-accent" disabled={busy} onClick={() => void send(pending.file, name.trim() || "Unknown", true, mapping)}>{busy ? "Loading…" : "Confirm and load"}</button>
            </div>
          </div>
        </Modal>
      )}
      {error && (
        <div role="alert" className="fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 border border-neg bg-bg px-4 py-2 text-[12px] text-ink shadow-[var(--shadow-pop)]">
          <span className="text-neg">Upload failed.</span> {error} <button type="button" className="ml-3 text-ink-3 hover:text-ink" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}
      {toast && (
        <div role="status" className="fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 border border-line bg-bg-elev px-4 py-2 text-[12px] text-ink shadow-[var(--shadow-pop)]">
          <span className="num text-pos">●</span> {toast}
        </div>
      )}
    </>
  );
}

export function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-[color-mix(in_oklab,var(--bg-sunk)_70%,transparent)] p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`w-full ${wide ? "max-w-3xl" : "max-w-md"} border border-line bg-bg shadow-[var(--shadow-pop)]`} onClick={(e) => e.stopPropagation()}>
        <div className="flex h-10 items-center justify-between border-b border-line px-4"><span className="label-strong">{title}</span><button type="button" className="text-ink-3 hover:text-ink" onClick={onClose} aria-label="Close">×</button></div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function SchemaDiffView({ diff, mapping, setMapping }: { diff: DiffPayload; mapping: Record<string, string>; setMapping: (m: Record<string, string>) => void }) {
  const renamed = diff.matched.filter((m) => m.how !== "exact");
  return (
    <div className="space-y-4 text-[12px]">
      <p className="text-ink-2">The new file has <span className="num text-ink">{diff.rows}</span> rows on sheet <span className="num text-ink">{diff.sheet}</span>. Review what changed before it replaces the dashboard data.</p>
      {renamed.length > 0 && (
        <section>
          <div className="label mb-1.5">Renamed columns · matched automatically</div>
          <ul className="divide-y divide-line border border-line">
            {renamed.map((m) => <li key={m.fieldId} className="flex items-center justify-between gap-3 px-3 py-1.5"><span className="text-ink">{m.label}</span><span className="num text-ink-3">now reads from “{m.header}” <span className="text-ink-4">· {m.how}</span></span></li>)}
          </ul>
        </section>
      )}
      {diff.missing.length > 0 && (
        <section>
          <div className="label mb-1.5 text-warn">Missing columns · visuals using these will show empty values</div>
          <ul className="divide-y divide-line border border-line">
            {diff.missing.map((m) => <li key={m.fieldId} className="flex items-center justify-between gap-3 px-3 py-1.5"><span className="text-ink">{m.label}</span><span className="num text-ink-3">was “{m.source}”</span></li>)}
          </ul>
        </section>
      )}
      {diff.added.length > 0 && (
        <section>
          <div className="label mb-1.5">New columns · choose what to do</div>
          <ul className="divide-y divide-line border border-line">
            {diff.added.map((a) => (
              <li key={a.header} className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-1.5">
                <div className="min-w-0"><div className="text-ink">{a.header} <span className="num text-ink-4">· {a.suggestedType}</span></div><div className="num truncate text-ink-3">{a.samples.join(" · ") || "no values yet"}</div></div>
                <select className="field h-7 text-[11px]" value={mapping[a.header] ?? "new"} onChange={(e) => setMapping({ ...mapping, [a.header]: e.target.value })}>
                  <option value="new">Add as a new field</option>
                  <option value="ignore">Ignore this column</option>
                  {diff.missing.map((m) => <option key={m.fieldId} value={m.fieldId}>This is “{m.label}” renamed</option>)}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

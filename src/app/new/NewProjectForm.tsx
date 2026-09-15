"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function NewProjectForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [uploadedBy, setUploadedBy] = useState("");
  const [primary, setPrimary] = useState("#4d8dff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { try { setUploadedBy(localStorage.getItem("meridian-user") ?? ""); } catch {} }, []);
  const pick = (f: File | null) => { setFile(f); if (f && !name) setName(f.name.replace(/\.(xlsx|xlsm|xls|csv)$/i, "")); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return setError("Choose a workbook first.");
    setBusy(true); setError(null);
    try { localStorage.setItem("meridian-user", uploadedBy); } catch {}
    const fd = new FormData();
    fd.set("file", file); fd.set("name", name); fd.set("clientName", clientName); fd.set("uploadedBy", uploadedBy); fd.set("primary", primary);
    const res = await fetch("/api/projects", { method: "POST", body: fd });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? "Upload failed"); setBusy(false); return; }
    router.push(`/p/${json.slug}`);
  };
  return (
    <form onSubmit={submit} className="mt-8 space-y-5">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0] ?? null); }}
        onClick={() => inputRef.current?.click()}
        className={`flex h-36 cursor-pointer flex-col items-center justify-center border border-dashed text-center transition-colors ${over ? "border-accent bg-[var(--accent-wash)]" : "border-line-strong hover:border-accent"}`}>
        <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.xls,.csv" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        {file ? (
          <><div className="num text-[13px] text-ink">{file.name}</div><div className="num mt-1 text-[11px] text-ink-3">{(file.size / 1024).toFixed(1)} KB · click to change</div></>
        ) : (
          <><div className="text-[13px] text-ink">Drop the workbook here</div><div className="mt-1 text-[11px] text-ink-3">xlsx, xlsm or csv · or click to browse</div></>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block"><span className="label">Project name</span><input className="field mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Agthia RFQ pipeline" required /></label>
        <label className="block"><span className="label">Client</span><input className="field mt-1 w-full" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Agthia Group" /></label>
        <label className="block"><span className="label">Your name</span><input className="field mt-1 w-full" value={uploadedBy} onChange={(e) => setUploadedBy(e.target.value)} placeholder="Shown as the uploader" required /></label>
        <label className="block"><span className="label">Brand colour</span><div className="mt-1 flex items-center gap-2"><input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-7 w-10 cursor-pointer border border-line bg-bg p-0.5" aria-label="Brand colour" /><span className="num text-[12px] text-ink-2">{primary}</span></div></label>
      </div>
      {error && <div className="border border-neg/40 bg-[color-mix(in_oklab,var(--neg)_10%,transparent)] px-3 py-2 text-[12px] text-neg">{error}</div>}
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-accent" disabled={busy}>{busy ? "Reading workbook…" : "Create dashboard"}</button>
        <span className="text-[11.5px] text-ink-3">Takes a few seconds. You land on the dashboard when it is ready.</span>
      </div>
    </form>
  );
}

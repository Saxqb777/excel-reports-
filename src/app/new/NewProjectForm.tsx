"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Role = "id" | "dimension" | "measure" | "date" | "text" | "ignore";
interface PreviewField { id: string; label: string; source: string | null; type: string; role: Role; semantic: string | null; derived: boolean; samples: string[] }
interface Preview { fileName: string; template: string; sheet: { name: string; rows: number; headers: string[]; sheets: { name: string; rows: number }[] }; fields: PreviewField[]; pages: { id: string; title: string; widgets: { id: string; type: string; title: string }[] }[]; rows: number; excluded: number; fixes: number }

const ROLES: Role[] = ["id", "dimension", "measure", "date", "text", "ignore"];

export function NewProjectForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fields, setFields] = useState<PreviewField[]>([]);
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [primary, setPrimary] = useState("#4d8dff");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = async (f: File | null) => {
    setFile(f); setPreview(null); setError(null);
    if (!f) return;
    if (!name) setName(f.name.replace(/\.(xlsx|xlsm|xls|csv)$/i, ""));
    setBusy(true);
    const fd = new FormData(); fd.set("file", f);
    const res = await fetch("/api/projects/preview", { method: "POST", body: fd });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) { setError(json.error ?? "Could not read the workbook"); return; }
    setPreview(json); setFields(json.fields);
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !preview) return setError("Choose a workbook first.");
    setBusy(true); setError(null);
    const overrides = fields.filter((f) => { const o = preview.fields.find((x) => x.id === f.id)!; return o.label !== f.label || o.role !== f.role; }).map((f) => ({ id: f.id, label: f.label, role: f.role }));
    const fd = new FormData();
    fd.set("file", file); fd.set("name", name); fd.set("clientName", clientName); fd.set("primary", primary); fd.set("overrides", JSON.stringify(overrides));
    const res = await fetch("/api/projects", { method: "POST", body: fd });
    const json = await res.json();
    if (!res.ok) { setError(json.error ?? "Upload failed"); setBusy(false); return; }
    router.push(`/p/${json.slug}`);
  };
  const step = !file ? 1 : !preview ? 1 : 2;
  return (
    <form onSubmit={submit} className="mt-8 space-y-6">
      <ol className="flex items-center gap-3 text-[14px]">
        {["Drop the workbook", "Confirm what was found", "Name it and create"].map((t, i) => <li key={t} className={`flex items-center gap-2 ${i < step ? "text-ink" : "text-ink-4"}`}><span className={`num flex h-4 w-4 items-center justify-center border text-[14px] ${i < step ? "border-accent text-accent" : "border-line"}`}>{i + 1}</span>{t}{i < 2 && <span className="h-px w-6 bg-line" />}</li>)}
      </ol>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); void pick(e.dataTransfer.files[0] ?? null); }}
        onClick={() => inputRef.current?.click()}
        className={`flex h-32 cursor-pointer flex-col items-center justify-center border border-dashed text-center transition-colors ${over ? "border-accent bg-[var(--accent-wash)]" : "border-line-strong hover:border-accent"}`}>
        <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.xls,.csv" className="hidden" onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
        {file ? (
          <><div className="num text-[14px] text-ink">{file.name}</div><div className="num mt-1 text-[14px] text-ink-3">{(file.size / 1024).toFixed(1)} KB · {busy && !preview ? "reading…" : "click to change"}</div></>
        ) : (
          <><div className="text-[14px] text-ink">Drop the workbook here</div><div className="mt-1 text-[14px] text-ink-3">xlsx, xlsm or csv · or click to browse</div></>
        )}
      </div>

      {preview && (
        <section className="border border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div className="text-[14px] text-ink">Sheet <span className="num">{preview.sheet.name}</span> · <span className="num">{preview.rows}</span> rows kept, <span className="num">{preview.excluded}</span> excluded, <span className="num">{preview.fixes}</span> corrected · {preview.fields.length} fields</div>
            <div className="label">{preview.template === "agthia" ? "Curated template matched" : "Generic proposal"}</div>
          </div>
          <div className="grid grid-cols-1 gap-px bg-line lg:grid-cols-[1fr_280px]">
            <div className="bg-bg p-4">
              <div className="label mb-2">Fields · adjust labels and how each is used</div>
              <div className="max-h-80 overflow-auto">
                <table className="w-full table-fixed text-[14.5px]">
                  <thead><tr className="label text-left"><th className="py-1 pr-2">Column</th><th className="py-1 pr-2">Label</th><th className="py-1 pr-2">Used as</th><th className="py-1">Sample</th></tr></thead>
                  <tbody>
                    {fields.map((f, i) => (
                      <tr key={f.id} className="border-t border-line">
                        <td className="num py-1 pr-2 text-ink-3">{f.source ?? <span className="text-ink-4">derived</span>}</td>
                        <td className="py-1 pr-2"><input className="field h-7 w-40" value={f.label} onChange={(e) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></td>
                        <td className="py-1 pr-2"><select className="field h-7" value={f.role} disabled={f.derived} onChange={(e) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, role: e.target.value as Role } : x)))}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></td>
                        <td className="py-1"><span className="num block max-w-[260px] truncate text-ink-3" title={f.samples.join(" · ")}>{f.samples.join(" · ")}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="bg-bg p-4">
              <div className="label mb-2">Proposed dashboard</div>
              <ul className="space-y-2 text-[14.5px]">
                {preview.pages.map((p) => <li key={p.id}><div className="text-ink">{p.title} <span className="num text-ink-3">· {p.widgets.length}</span></div><div className="text-[14px] text-ink-3">{p.widgets.map((w) => w.title).join(" · ")}</div></li>)}
              </ul>
              <p className="mt-3 text-[14px] text-ink-3">Everything stays editable after creation: drag, resize, hide, pin answers from the question box.</p>
            </div>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block"><span className="label">Project name</span><input className="field mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Agthia RFQ pipeline" required /></label>
        <label className="block"><span className="label">Client</span><input className="field mt-1 w-full" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Agthia Group" /></label>
        <label className="block"><span className="label">Brand colour</span><div className="mt-1 flex items-center gap-2"><input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-7 w-10 cursor-pointer border border-line bg-bg p-0.5" aria-label="Brand colour" /><span className="num text-[14.5px] text-ink-2">{primary}</span></div></label>
      </div>
      {error && <div className="border border-neg px-3 py-2 text-[14.5px] text-ink"><span className="text-neg">Problem.</span> {error}</div>}
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-accent" disabled={busy || !preview}>{busy && preview ? "Creating…" : "Create dashboard"}</button>
        <span className="text-[14px] text-ink-3">{preview ? "Review the fields above, then create." : "Drop a file to see what Meridian proposes."}</span>
      </div>
    </form>
  );
}

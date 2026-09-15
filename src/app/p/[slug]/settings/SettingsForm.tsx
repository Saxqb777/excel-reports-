"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectSummary, UploadSummary } from "@/lib/data/projects";
import type { Field, FieldRole } from "@/lib/schema/types";
import { formatDateTime } from "@/lib/engine/format";

const ROLES: FieldRole[] = ["id", "dimension", "measure", "date", "text", "ignore"];

export function SettingsForm({ project, uploads }: { project: ProjectSummary; uploads: UploadSummary[] }) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [clientName, setClientName] = useState(project.clientName ?? "");
  const [description, setDescription] = useState(project.description ?? "");
  const [primary, setPrimary] = useState(project.theme.primary);
  const [mode, setMode] = useState(project.theme.mode);
  const [monogram, setMonogram] = useState(project.theme.monogram ?? "");
  const [logoUrl, setLogoUrl] = useState(project.theme.logoUrl ?? null);
  const [fields, setFields] = useState<Field[]>(project.schemaMap.fields);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");

  const patch = async (body: Record<string, unknown>, ok: string) => {
    setBusy(true); setStatus(null);
    const res = await fetch(`/api/projects/${project.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    setStatus(res.ok ? ok : `Could not save (${res.status}).`);
    if (res.ok) router.refresh();
  };
  const saveIdentity = () => patch({ name, clientName: clientName || null, description: description || null, theme: { primary, mode, monogram: monogram || undefined } }, "Saved. The dashboard uses the new identity on next load.");
  const saveSchema = () => patch({ schemaFields: fields.map((f) => ({ id: f.id, label: f.label, role: f.role, hidden: f.hidden ?? false })) }, "Schema saved. The snapshot rebuilds automatically.");
  const uploadLogo = async (file: File) => {
    setBusy(true); setStatus(null);
    const fd = new FormData(); fd.set("file", file);
    const res = await fetch(`/api/projects/${project.id}/logo`, { method: "POST", body: fd });
    const j = await res.json();
    setBusy(false);
    if (res.ok) { setLogoUrl(j.logoUrl); setStatus("Logo updated."); router.refresh(); } else setStatus(j.error ?? "Logo upload failed.");
  };
  const removeLogo = async () => { setBusy(true); await fetch(`/api/projects/${project.id}/logo`, { method: "DELETE" }); setBusy(false); setLogoUrl(null); router.refresh(); };
  const del = async () => {
    setBusy(true);
    const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm }) });
    setBusy(false);
    if (res.ok) router.push("/"); else setStatus((await res.json()).error ?? "Delete failed.");
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      {status && <div role="status" className="mb-4 border border-line bg-bg-elev px-3 py-2 text-[12px] text-ink">{status}</div>}
      <div className="grid grid-cols-1 gap-px bg-line lg:grid-cols-2">
        <section className="bg-bg p-5">
          <h2 className="label-strong mb-3">Identity and theme</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">Project name</span><input className="field mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="block"><span className="label">Client</span><input className="field mt-1 w-full" value={clientName} onChange={(e) => setClientName(e.target.value)} /></label>
            <label className="block sm:col-span-2"><span className="label">Description</span><input className="field mt-1 w-full" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
            <label className="block"><span className="label">Brand colour</span><div className="mt-1 flex items-center gap-2"><input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} className="h-7 w-10 cursor-pointer border border-line bg-bg p-0.5" /><input className="field num w-28" value={primary} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && setPrimary(e.target.value)} /></div></label>
            <label className="block"><span className="label">Default theme</span><select className="field mt-1 w-full" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="dark">Dark</option><option value="light">Light</option><option value="system">Follow the viewer&rsquo;s system</option></select></label>
            <label className="block"><span className="label">Monogram (no logo)</span><input className="field num mt-1 w-24 uppercase" maxLength={3} value={monogram} onChange={(e) => setMonogram(e.target.value.toUpperCase())} placeholder="AG" /></label>
            <div className="block">
              <span className="label">Logo</span>
              <div className="mt-1 flex items-center gap-3">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Logo" className="h-8 max-w-[140px] object-contain" />
                ) : <span className="text-[11.5px] text-ink-3">None yet</span>}
                <label className="btn cursor-pointer">Upload<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); }} /></label>
                {logoUrl && <button type="button" className="btn" onClick={removeLogo} disabled={busy}>Remove</button>}
              </div>
            </div>
          </div>
          <div className="mt-4"><button type="button" className="btn btn-accent" disabled={busy} onClick={saveIdentity}>Save identity</button></div>
        </section>

        <section className="bg-bg p-5">
          <h2 className="label-strong mb-3">Versions</h2>
          <ul className="divide-y divide-line text-[12px]">
            {uploads.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="num text-ink">v{u.versionNo} {u.id === project.currentUploadId && <span className="label ml-1 text-accent">live</span>}</span>
                <span className="num text-ink-3">{u.rowCount} rows · {u.uploadedBy} · {formatDateTime(u.uploadedAt)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] text-ink-3">Restore and download live in the dashboard&rsquo;s History drawer.</p>
        </section>

        <section className="bg-bg p-5 lg:col-span-2">
          <h2 className="label-strong mb-1">Fields</h2>
          <p className="mb-3 text-[11.5px] text-ink-3">Rename how a column reads on the dashboard, change what it is used for, or hide it. Visuals bind to the stable id, so renames never break anything. Derived fields are computed by the system.</p>
          <div className="overflow-auto">
            <table className="w-full text-[12px]">
              <thead><tr className="label text-left"><th className="py-1 pr-3">Source column</th><th className="py-1 pr-3">Label</th><th className="py-1 pr-3">Type</th><th className="py-1 pr-3">Used as</th><th className="py-1 pr-3">Meaning</th><th className="py-1">Hidden</th></tr></thead>
              <tbody>
                {fields.map((f, i) => (
                  <tr key={f.id} className="border-t border-line">
                    <td className="num py-1 pr-3 text-ink-3">{f.source ?? <span className="text-ink-4">derived</span>}</td>
                    <td className="py-1 pr-3"><input className="field h-7 w-44" value={f.label} onChange={(e) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></td>
                    <td className="num py-1 pr-3 text-ink-3">{f.type}</td>
                    <td className="py-1 pr-3"><select className="field h-7" value={f.role} onChange={(e) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, role: e.target.value as FieldRole } : x)))} disabled={Boolean(f.derived)}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></td>
                    <td className="num py-1 pr-3 text-ink-3">{f.semantic ?? "·"}</td>
                    <td className="py-1"><input type="checkbox" checked={Boolean(f.hidden)} onChange={(e) => setFields((fs) => fs.map((x, j) => (j === i ? { ...x, hidden: e.target.checked } : x)))} aria-label={`Hide ${f.label}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4"><button type="button" className="btn btn-accent" disabled={busy} onClick={saveSchema}>Save fields</button></div>
        </section>

        <section className="bg-bg p-5 lg:col-span-2">
          <h2 className="label-strong mb-1 text-neg">Delete project</h2>
          <p className="mb-3 text-[11.5px] text-ink-3">Removes the dashboard, every uploaded version and the share link. This cannot be undone. Type the project name to confirm.</p>
          <div className="flex gap-2"><input className="field w-72" placeholder={project.name} value={confirm} onChange={(e) => setConfirm(e.target.value)} /><button type="button" className="btn hover:border-neg hover:text-neg" disabled={busy || confirm !== project.name} onClick={del}>Delete permanently</button></div>
        </section>
      </div>
    </div>
  );
}

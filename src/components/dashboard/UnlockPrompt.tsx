"use client";
import { useEffect, useState } from "react";
import { Modal } from "./Modal";

interface UnlockRequest { projectId: string; resolve: (ok: boolean) => void }
let host: ((req: UnlockRequest) => void) | null = null;
const unlocked = new Set<string>();

/** Resolves true once the update password has been accepted for this project on this page; false when the prompt is cancelled. */
export function requestUnlock(projectId: string): Promise<boolean> {
  if (unlocked.has(projectId)) return Promise.resolve(true);
  return new Promise((resolve) => { if (!host) return resolve(false); host({ projectId, resolve }); });
}

/** fetch() that, when the server answers "locked", asks for the update password and retries once. */
export async function guardedFetch(projectId: string, input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;
  const body = (await res.clone().json().catch(() => ({}))) as { locked?: boolean };
  if (!body.locked) return res;
  unlocked.delete(projectId);
  return (await requestUnlock(projectId)) ? fetch(input, init) : res;
}

/** Mount once on every page that changes data; it renders the password prompt whenever a guarded call needs one. */
export function UnlockHost() {
  const [req, setReq] = useState<UnlockRequest | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { host = (r) => { setPassword(""); setError(null); setReq(r); }; return () => { host = null; }; }, []);
  if (!req) return null;
  const close = (ok: boolean) => { req.resolve(ok); setReq(null); };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch(`/api/projects/${req.projectId}/unlock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) { setError(json.error ?? "Could not unlock."); return; }
    unlocked.add(req.projectId);
    close(true);
  };
  return (
    <Modal title="Update password" onClose={() => close(false)}>
      <form onSubmit={submit}>
        <p className="mb-3 text-[14.5px] text-ink-2">Changing the data of this dashboard needs the update password. Viewing stays open to everyone with the link.</p>
        <input autoFocus type="password" className="field w-full" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Update password" autoComplete="current-password" />
        {error && <div className="mt-2 text-[14.5px] text-neg">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => close(false)} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-accent" disabled={busy || !password}>{busy ? "Checking…" : "Unlock"}</button>
        </div>
      </form>
    </Modal>
  );
}

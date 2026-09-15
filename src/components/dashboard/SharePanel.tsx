"use client";
import { useEffect, useState } from "react";
import { Modal } from "./UploadFlow";

export function SharePanel({ projectId, token, enabled, hasPassword, open, onClose, onChanged }: { projectId: string; token: string; enabled: boolean; hasPassword: boolean; open: boolean; onClose: () => void; onChanged: (s: { enabled: boolean; hasPassword: boolean }) => void }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setOrigin(window.location.origin); }, []);
  if (!open) return null;
  const link = `${origin}/s/${token}`;
  const copy = async (text: string, what: string) => { try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(null), 1600); } catch {} };
  const patch = async (share: { enabled?: boolean; password?: string | null }) => {
    setBusy(true);
    const res = await fetch(`/api/projects/${projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ share }) });
    setBusy(false);
    if (res.ok) { const j = await res.json(); onChanged({ enabled: j.project.shareEnabled, hasPassword: j.project.hasSharePassword }); setPassword(""); }
  };
  return (
    <Modal title="Share this dashboard" onClose={onClose}>
      <div className="space-y-4 text-[14px]">
        <div>
          <div className="label mb-1">View-only link</div>
          <div className="flex gap-2">
            <input readOnly className="field num flex-1 text-[14px]" value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
            <button type="button" className="btn" onClick={() => copy(link, "link")}>{copied === "link" ? "Copied" : "Copy"}</button>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[14px] text-ink-3">
            <button type="button" className="hover:text-ink" onClick={() => copy(`${link}?board=1`, "board")}>{copied === "board" ? "Copied boardroom link" : "Copy boardroom (TV) link"}</button>
            <span>·</span>
            <span>Viewers see the live data, filters and Ask are hidden for them, no upload or history.</span>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-line pt-3">
          <div><div className="text-ink">Link active</div><div className="text-[14px] text-ink-3">Turn off to revoke access instantly. Turning it back on keeps the same link.</div></div>
          <button type="button" className={`chip ${enabled ? "chip-on" : ""}`} disabled={busy} onClick={() => patch({ enabled: !enabled })}>{enabled ? "on" : "off"}</button>
        </div>
        <div className="border-t border-line pt-3">
          <div className="text-ink">Password</div>
          <div className="text-[14px] text-ink-3">{hasPassword ? "A password is set. Viewers enter it once per browser." : "Optional. Anyone with the link can view until you set one."}</div>
          <div className="mt-2 flex gap-2">
            <input type="password" className="field flex-1" placeholder={hasPassword ? "New password" : "Set a password"} value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Share password" />
            <button type="button" className="btn btn-accent" disabled={busy || !password} onClick={() => patch({ password })}>{hasPassword ? "Change" : "Set"}</button>
            {hasPassword && <button type="button" className="btn" disabled={busy} onClick={() => patch({ password: null })}>Remove</button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

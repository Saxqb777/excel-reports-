"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function PasswordGate({ token, name, clientName, primary }: { token: string; name: string; clientName: string | null; primary: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await fetch(`/api/share/${token}/unlock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) { setError(json.error ?? "Could not unlock."); return; }
    router.refresh();
  };
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-6">
      <form onSubmit={submit} className="w-full max-w-sm border border-line bg-bg-elev p-6">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="num flex h-5 min-w-5 items-center justify-center px-1 text-[14px] font-semibold" style={{ background: primary, color: "#fff" }}>{name.slice(0, 2).toUpperCase()}</span>
          <div><div className="text-[14px] font-semibold text-ink">{name}</div>{clientName && <div className="text-[14px] text-ink-3">{clientName}</div>}</div>
        </div>
        <div className="label mb-1">Password</div>
        <input autoFocus type="password" className="field w-full" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password" />
        {error && <div className="mt-2 text-[14.5px] text-neg">{error}</div>}
        <button type="submit" className="btn btn-accent mt-4 w-full" disabled={busy || !password}>{busy ? "Checking…" : "Open dashboard"}</button>
        <p className="mt-3 text-[14px] text-ink-3">This dashboard is shared privately. Ask the owner for the password.</p>
      </form>
    </main>
  );
}

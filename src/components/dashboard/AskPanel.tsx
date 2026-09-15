"use client";
import { useEffect, useRef, useState } from "react";
import type { Widget } from "@/lib/dashboard/types";
import type { FilterExpr } from "@/lib/schema/types";
import { useDashboard } from "@/lib/ui/dashboard-state";
import { WidgetRenderer } from "@/components/widgets/WidgetRenderer";

interface AskResponse { answer: { kind: string; title: string; explanation: string }; widget: Widget | null; filters: FilterExpr[]; model: string; error?: string }

const EXAMPLES = ["Top 5 origins by number of RFQs", "Win rate by freight type", "Weekly RFQs received this quarter", "Which open items are older than 14 days?", "Business unit by lane"];

export function AskPanel({ projectId, open, onClose, onPin }: { projectId: string; open: boolean; onClose: () => void; onPin?: (w: Widget) => void }) {
  const { dispatch } = useDashboard();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [history, setHistory] = useState<{ q: string; r: AskResponse }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; if (open) window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [open, onClose]);
  if (!open) return null;

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
      const json = (await res.json()) as AskResponse;
      if (!res.ok) { setError(json.error ?? "The question could not be answered."); return; }
      setResult(json);
      setHistory((h) => [{ q: question, r: json }, ...h].slice(0, 6));
      if (json.filters.length) dispatch({ type: "toggle", selection: { widgetId: "ask", field: "__ask__", values: [], label: `Question: ${json.answer.title}`, extra: { and: json.filters } } });
      else dispatch({ type: "clearSelection", widgetId: "ask" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[65]" onClick={onClose}>
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-line bg-bg shadow-[var(--shadow-pop)]" onClick={(e) => e.stopPropagation()} aria-label="Ask the data">
        <div className="flex h-11 items-center justify-between border-b border-line px-4"><span className="label-strong">Ask the data</span><button type="button" className="text-ink-3 hover:text-ink" onClick={onClose} aria-label="Close">×</button></div>
        <form className="flex items-center gap-2 border-b border-line px-4 py-3" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
          <span className="num text-accent" aria-hidden>▸</span>
          <input ref={inputRef} className="field h-8 flex-1 num text-[14px]" placeholder="show me top 5 clients by margin this quarter" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Question" />
          <button type="submit" className="btn btn-accent h-8 px-3 py-0 text-[14px]" disabled={busy || !q.trim()}>{busy ? "Thinking…" : "Ask"}</button>
        </form>
        <div className="min-h-0 flex-1 overflow-auto">
          {!result && !error && !busy && (
            <div className="px-4 py-3">
              <div className="label mb-2">Try</div>
              <div className="flex flex-wrap gap-1.5">{EXAMPLES.map((e) => <button key={e} type="button" className="chip" onClick={() => { setQ(e); void ask(e); }}>{e}</button>)}</div>
              <p className="mt-4 text-[14px] leading-relaxed text-ink-3">Claude translates the question into a chart specification. Every number is then computed here, from the same data as the dashboard, so the answer respects your current filters and cross-filters the other tiles.</p>
            </div>
          )}
          {busy && <div className="px-4 py-6 text-[14.5px] text-ink-3">Working out which fields and filters answer that…</div>}
          {error && <div className="m-4 border border-neg px-3 py-2 text-[14.5px] text-ink"><span className="text-neg">Could not answer.</span> {error}</div>}
          {result && (
            <div className="flex flex-col">
              {result.widget ? (
                <div className="h-[360px] border-b border-line bg-line"><div className="h-full w-full bg-bg"><WidgetRenderer w={result.widget} /></div></div>
              ) : (
                <div className="border-b border-line px-4 py-4 text-[14px] text-ink-2">{result.answer.explanation}</div>
              )}
              <div className="flex items-center justify-between gap-3 px-4 py-2 text-[14px] text-ink-3">
                <span className="num">via {result.model}</span>
                <div className="flex gap-2">
                  {result.filters.length > 0 && <button type="button" className="btn h-6 px-2 py-0 text-[14px]" onClick={() => dispatch({ type: "clearSelection", widgetId: "ask" })}>Release filter</button>}
                  {result.widget && onPin && <button type="button" className="btn btn-accent h-6 px-2 py-0 text-[14px]" onClick={() => onPin(result.widget!)}>Pin to dashboard</button>}
                </div>
              </div>
            </div>
          )}
          {history.length > 1 && (
            <div className="border-t border-line px-4 py-3">
              <div className="label mb-1.5">Earlier</div>
              <ul className="space-y-1">{history.slice(1).map((h, i) => <li key={i}><button type="button" className="text-left text-[14.5px] text-ink-2 hover:text-ink" onClick={() => { setQ(h.q); setResult(h.r); setError(null); }}>{h.q}</button></li>)}</ul>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

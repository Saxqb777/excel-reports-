"use client";
import { useEffect } from "react";

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

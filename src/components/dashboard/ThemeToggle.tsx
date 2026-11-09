"use client";
import { useEffect, useState } from "react";
import { readSaved, setMode, systemMode, type Mode } from "@/lib/ui/theme";

export { setMode as applyTheme };

/**
 * Light / dark switch. Priority: the viewer's saved choice for this project, then their global choice,
 * then the project's default, then the system preference.
 */
export function ThemeToggle({ defaultMode = "system", scope, compact = false, iconOnly = false }: { defaultMode?: "dark" | "light" | "system"; scope?: string; compact?: boolean; /** A square icon button (sun / moon) for icon rails. */ iconOnly?: boolean }) {
  const [mode, set] = useState<Mode>("dark");
  useEffect(() => {
    const initial: Mode = (scope ? readSaved(scope) : null) ?? readSaved() ?? (defaultMode === "system" ? systemMode() : defaultMode);
    set(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, [defaultMode, scope]);
  const next: Mode = mode === "dark" ? "light" : "dark";
  if (iconOnly) {
    return (
      <button type="button" className="v3-nav flex h-11 w-11 items-center justify-center rounded-[14px]" onClick={() => { set(next); setMode(next, scope); }} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
        {mode === "dark"
          ? <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" /></svg>
          : <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" /></svg>}
      </button>
    );
  }
  return (
    <button type="button" className={`btn h-7 whitespace-nowrap py-0 text-[14px] ${compact ? "px-2" : "px-2.5"}`} onClick={() => { set(next); setMode(next, scope); }} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      <span className="mr-1.5 inline-block h-[9px] w-[9px] rounded-full border border-current align-[-1px]" style={{ background: mode === "dark" ? "transparent" : "currentColor" }} aria-hidden />
      {compact ? (mode === "dark" ? "Light" : "Dark") : mode === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}

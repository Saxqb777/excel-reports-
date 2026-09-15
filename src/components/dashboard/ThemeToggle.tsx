"use client";
import { useEffect, useState } from "react";
import { readSaved, setMode, systemMode, type Mode } from "@/lib/ui/theme";

export { setMode as applyTheme };

/**
 * Light / dark switch. Priority: the viewer's saved choice for this project, then their global choice,
 * then the project's default, then the system preference.
 */
export function ThemeToggle({ defaultMode = "system", scope, compact = false }: { defaultMode?: "dark" | "light" | "system"; scope?: string; compact?: boolean }) {
  const [mode, set] = useState<Mode>("dark");
  useEffect(() => {
    const initial: Mode = (scope ? readSaved(scope) : null) ?? readSaved() ?? (defaultMode === "system" ? systemMode() : defaultMode);
    set(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, [defaultMode, scope]);
  const next: Mode = mode === "dark" ? "light" : "dark";
  return (
    <button type="button" className={`btn h-7 whitespace-nowrap py-0 text-[14px] ${compact ? "px-2" : "px-2.5"}`} onClick={() => { set(next); setMode(next, scope); }} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      <span className="mr-1.5 inline-block h-[9px] w-[9px] rounded-full border border-current align-[-1px]" style={{ background: mode === "dark" ? "transparent" : "currentColor" }} aria-hidden />
      {compact ? (mode === "dark" ? "Light" : "Dark") : mode === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}

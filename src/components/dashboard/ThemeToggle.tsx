"use client";
import { useEffect, useState } from "react";

export function applyTheme(mode: "dark" | "light") {
  document.documentElement.setAttribute("data-theme", mode);
  try { localStorage.setItem("meridian-theme", mode); } catch {}
}

export function ThemeToggle({ defaultMode }: { defaultMode: "dark" | "light" | "system" }) {
  const [mode, setMode] = useState<"dark" | "light">(defaultMode === "light" ? "light" : "dark");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("meridian-theme") as "dark" | "light" | null;
      const initial = saved ?? (defaultMode === "system" ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : defaultMode);
      setMode(initial);
      document.documentElement.setAttribute("data-theme", initial);
    } catch {}
  }, [defaultMode]);
  const next = mode === "dark" ? "light" : "dark";
  return (
    <button type="button" className="btn h-7 px-2 py-0 text-[11px]" onClick={() => { setMode(next); applyTheme(next); }} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      {mode === "dark" ? "Light" : "Dark"}
    </button>
  );
}

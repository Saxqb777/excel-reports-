"use client";
import { useEffect, useState } from "react";

export type Mode = "dark" | "light";

const KEY = "meridian-theme";

export function currentMode(): Mode {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

export function systemMode(): Mode {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function readSaved(scope?: string): Mode | null {
  try {
    const v = localStorage.getItem(scope ? `${KEY}:${scope}` : KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch { return null; }
}

/** Sets the theme on the document and remembers it (globally, and per project when a scope is given). */
export function setMode(mode: Mode, scope?: string) {
  document.documentElement.setAttribute("data-theme", mode);
  try { localStorage.setItem(KEY, mode); if (scope) localStorage.setItem(`${KEY}:${scope}`, mode); } catch {}
  window.dispatchEvent(new CustomEvent("meridian-theme", { detail: mode }));
}

/** Current mode, kept in sync with the document attribute. */
export function useMode(): Mode {
  const [mode, set] = useState<Mode>("dark");
  useEffect(() => {
    set(currentMode());
    const obs = new MutationObserver(() => set(currentMode()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return mode;
}

// ---------- brand colour adaptation ----------

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbToHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrast(a: string, b: string): number {
  const la = luminance(hexToRgb(a) ?? [0, 0, 0]), lb = luminance(hexToRgb(b) ?? [255, 255, 255]);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}
function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0); else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

const SURFACE: Record<Mode, string> = { dark: "#0d0e10", light: "#f4f4f2" };

/**
 * Adapts a brand colour to a theme: keeps the hue, moves lightness until the colour reads on that surface
 * (at least 4.5:1 for text use). A light-blue chosen on a dark screen becomes a deeper blue on paper, and vice versa.
 */
export function adaptBrand(hex: string, mode: Mode): { accent: string; accentInk: string } {
  const rgb = hexToRgb(hex);
  if (!rgb) return { accent: mode === "dark" ? "#4d8dff" : "#0f5fd7", accentInk: mode === "dark" ? "#0b0c0e" : "#ffffff" };
  const surface = SURFACE[mode];
  const [h, s] = rgbToHsl(rgb);
  let [, , l] = rgbToHsl(rgb);
  let out = rgbToHex(...rgb);
  let guard = 0;
  while (contrast(out, surface) < 4.5 && guard++ < 60) {
    l += mode === "light" ? -0.015 : 0.015;
    if (l <= 0.05 || l >= 0.95) break;
    out = rgbToHex(...hslToRgb([h, s, l]));
  }
  const ink = contrast(out, "#ffffff") >= contrast(out, "#0b0c0e") ? "#ffffff" : "#0b0c0e";
  return { accent: out, accentInk: ink };
}

/** Writes the adapted brand tokens onto an element (the document root by default). */
export function applyBrand(primary: string, mode: Mode, el: HTMLElement = document.documentElement) {
  const { accent, accentInk } = adaptBrand(primary, mode);
  el.style.setProperty("--accent", accent);
  el.style.setProperty("--accent-ink", accentInk);
}

/** Keeps the brand tokens in step with the active theme. */
export function useBrand(primary: string, el?: HTMLElement | null) {
  const mode = useMode();
  useEffect(() => {
    const target = el === undefined ? document.documentElement : el;
    if (!target) return;
    applyBrand(primary, mode, target);
    if (target === document.documentElement) return () => { target.style.removeProperty("--accent"); target.style.removeProperty("--accent-ink"); };
  }, [primary, mode, el]);
}

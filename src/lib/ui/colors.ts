export type Tone = "pos" | "neg" | "warn" | "neutral" | "accent";

export const toneVar = (t: Tone) => (t === "warn" ? "var(--warn-mark)" : t === "neutral" ? "var(--neutral-mark)" : `var(--${t})`);
/** Text-safe tone colour (meets text contrast). */
export const toneText = (t: Tone) => `var(--${t})`;
export const catVar = (i: number) => `var(--c${(i % 6) + 1})`;
export const seqVar = (step: number) => `var(--seq-${Math.max(1, Math.min(7, step))})`;

/** Status tone for a category value: won/good -> pos, lost/bad -> neg, pending/waiting -> warn, quoted/open -> accent. */
export function statusTone(value: string): Tone {
  const v = value.toLowerCase();
  if (/\b(won|win|closed won|approved|complete|completed|delivered|success|active|paid)\b/.test(v)) return "pos";
  if (/\b(lost|loss|rejected|cancel|cancelled|failed|overdue|declined|churn)\b/.test(v)) return "neg";
  if (/\b(pending|waiting|on hold|hold|late|not yet|todo|backlog|draft)\b/.test(v)) return "warn";
  if (/\b(quoted|open|awaiting|in progress|progress|submitted|sent|review)\b/.test(v)) return "accent";
  return "neutral";
}

export function stackColor(value: string, index: number, mode: "status" | "categorical" | "single"): string {
  if (mode === "single") return "var(--accent)";
  if (mode === "status") {
    const t = statusTone(value);
    return t === "neutral" ? catVar(index) : toneVar(t);
  }
  return catVar(index);
}

export function deltaTone(delta: number | null, good: "up" | "down" | "none" = "up"): Tone {
  if (delta === null || delta === 0 || good === "none") return "neutral";
  const up = delta > 0;
  return (up && good === "up") || (!up && good === "down") ? "pos" : "neg";
}

/** Converts a hex colour to an OKLCH-ish lightness estimate (0..1) using sRGB luminance. */
export function isLight(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45;
}

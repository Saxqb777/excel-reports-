import type { Field } from "@/lib/schema/types";

const nf = new Map<string, Intl.NumberFormat>();
function numFmt(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(opts);
  let f = nf.get(key);
  if (!f) { f = new Intl.NumberFormat("en-GB", opts); nf.set(key, f); }
  return f;
}

export type ValueFormat = "integer" | "decimal" | "currency" | "percent" | "days" | "date" | "text" | "compact";

export function formatNumber(v: number | null | undefined, format: ValueFormat = "integer", currency = "AED", compact = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  switch (format) {
    case "percent": return numFmt({ style: "percent", maximumFractionDigits: Math.abs(v) < 0.1 ? 1 : 0 }).format(v);
    case "days": return `${numFmt({ maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 }).format(v)}d`;
    case "currency":
      return compact && Math.abs(v) >= 10000
        ? `${currency} ${numFmt({ notation: "compact", maximumFractionDigits: 1 }).format(v)}`
        : `${currency} ${numFmt({ maximumFractionDigits: 0 }).format(v)}`;
    case "decimal": return numFmt({ maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(v);
    case "compact": return numFmt({ notation: "compact", maximumFractionDigits: 1 }).format(v);
    case "date": return formatDate(v);
    default:
      return compact && Math.abs(v) >= 10000 ? numFmt({ notation: "compact", maximumFractionDigits: 1 }).format(v) : numFmt({ maximumFractionDigits: 0 }).format(v);
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(t: number | null | undefined, style: "short" | "long" | "month" | "week" | "iso" = "short"): string {
  if (t === null || t === undefined || !Number.isFinite(t)) return "–";
  const d = new Date(t);
  const day = d.getUTCDate(), mon = MONTHS[d.getUTCMonth()], yr = d.getUTCFullYear();
  if (style === "iso") return d.toISOString().slice(0, 10);
  if (style === "month") return `${mon} ${yr}`;
  if (style === "week") return `${day} ${mon}`;
  if (style === "long") return `${day} ${mon} ${yr}`;
  return `${String(day).padStart(2, "0")} ${mon} ${String(yr).slice(2)}`;
}

export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "–";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
}

export function formatValue(v: string | number | null | undefined, field?: Field): string {
  if (v === null || v === undefined) return "–";
  if (typeof v === "string") return v;
  if (!field) return formatNumber(v);
  if (field.type === "date") return formatDate(v);
  if (field.type === "boolean") return v ? "Yes" : "No";
  return formatNumber(v, field.format === "date" || field.format === "text" ? "integer" : (field.format ?? "integer"), field.currency);
}

export function formatDelta(delta: number | null, format: ValueFormat = "integer"): string {
  if (delta === null || !Number.isFinite(delta) || delta === 0) return delta === 0 ? "±0" : "–";
  const sign = delta > 0 ? "+" : "−";
  const abs = Math.abs(delta);
  if (format === "percent") return `${sign}${numFmt({ maximumFractionDigits: 1 }).format(abs * 100)} pts`;
  if (format === "days") return `${sign}${numFmt({ maximumFractionDigits: 1 }).format(abs)}d`;
  return `${sign}${numFmt({ maximumFractionDigits: 1 }).format(abs)}`;
}

export function pct(n: number, d: number): string {
  if (!d) return "–";
  return numFmt({ style: "percent", maximumFractionDigits: 0 }).format(n / d);
}

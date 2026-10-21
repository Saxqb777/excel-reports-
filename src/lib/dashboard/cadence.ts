/**
 * Monthly cadence: a project whose sheet owner adds one month at a time. Shared by the server (merging an upload into
 * the rows already there) and the client (the "Add October" button). Pure: no database here.
 */
export interface Cadence {
  unit: "month";
  /** Snapshot field holding each row's month as a date (the first of the month). */
  dateField: string;
  /** The prepared sheet's header for that date, read when merging stored rows. */
  dateHeader: string;
  /** The prepared sheet's month label header ("Oct 2026"). */
  monthHeader: string;
}

export function cadenceOf(settings: Record<string, unknown> | undefined): Cadence | null {
  const c = settings?.cadence as Partial<Cadence> | undefined;
  return c && c.unit === "month" && typeof c.dateHeader === "string" && typeof c.monthHeader === "string" && typeof c.dateField === "string" ? (c as Cadence) : null;
}

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 2026" for a timestamp. */
export const monthLabelOf = (t: number) => `${SHORT[new Date(t).getUTCMonth()]} ${new Date(t).getUTCFullYear()}`;
/** "October" (with the year when it is not this year). */
export function monthWord(label: string | null, now = new Date()): string | null {
  if (!label) return null;
  const [m, y] = label.split(" ");
  const i = SHORT.indexOf(m);
  if (i < 0) return label;
  return Number(y) === now.getUTCFullYear() ? MONTH_NAMES[i] : `${MONTH_NAMES[i]} ${y}`;
}

/** The month after the latest one present, as a label; null when there is no month yet. */
export function nextMonthLabel(latest: number | null): string | null {
  if (latest === null) return null;
  const d = new Date(latest);
  return monthLabelOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/** Latest month (first-of-month timestamp) in a column of month dates. */
export function latestMonth(values: (number | string | null)[]): number | null {
  let latest = -Infinity;
  for (const v of values) {
    const t = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
    if (!Number.isNaN(t)) latest = Math.max(latest, Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), 1));
  }
  return latest === -Infinity ? null : latest;
}

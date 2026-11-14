import { catVar, statusTone, toneVar } from "@/lib/ui/colors";

/** Colour for one part of a whole (a cost group, a stack): catch-alls grey, the avoidable money amber, the rest categorical. */
export function segmentColor(label: string, index: number): string {
  const v = label.trim().toLowerCase();
  if (/^(other|not set|not recorded|uncoded|unknown)\b/.test(v)) return "var(--neutral-mark)";
  if (/demurrage|detention|penalt|fine/.test(v)) return "var(--warn-mark)";
  // A status (PO issued / PO pending…) keeps its status colour, as on the bar charts.
  if (/^(po issued|po pending|waiting for po|pr to raise|new po needed)$/.test(v)) return toneVar(statusTone(v));
  return catVar(index);
}

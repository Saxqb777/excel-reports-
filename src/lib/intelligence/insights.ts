import type { ColumnValue, Field, FilterExpr, SchemaMap, Snapshot } from "@/lib/schema/types";
import type { KpiWidget, Layout } from "@/lib/dashboard/types";
import { computeMetric, type MetricSpec } from "@/lib/engine/metrics";
import { buildMask, rowMatches } from "@/lib/engine/filters";
import { formatDate, formatNumber } from "@/lib/engine/format";

export type InsightTone = "pos" | "neg" | "warn" | "neutral";

export interface Insight {
  id: string;
  kind: "baseline" | "kpi" | "rows" | "dimension" | "aging" | "anomaly";
  headline: string;
  detail?: string;
  delta?: number | null;
  tone: InsightTone;
  score: number;
  /** Applying this filter on the dashboard shows the rows behind the insight. */
  filter?: FilterExpr;
  ids?: string[];
}

const DAY = 86_400_000;

function fullMask(s: Snapshot): Uint8Array { return buildMask(s.columns, s.n, []); }

function kpiWidgets(layout: Layout): KpiWidget[] {
  return layout.pages.flatMap((p) => p.widgets.filter((w): w is KpiWidget => w.type === "kpi"));
}

function idsOf(s: Snapshot, idField: string | undefined): (string | null)[] {
  if (!idField) return Array.from({ length: s.n }, (_, i) => `row ${s.rowRefs[i]}`);
  return (s.columns[idField] ?? []).map((v) => (v === null ? null : String(v)));
}

function listIds(ids: string[], max = 4): string {
  if (ids.length <= max) return ids.join(", ");
  return `${ids.slice(0, max).join(", ")} and ${ids.length - max} more`;
}

function fmt(v: number | null, m: MetricSpec): string { return formatNumber(v, m.format ?? "integer", m.currency, true); }

function rowsMatching(s: Snapshot, expr: FilterExpr | undefined): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < s.n; i++) if (!expr || rowMatches(s.columns, i, expr)) out.add(i);
  return out;
}

/** Rows that satisfy a KPI's filter (or all rows for unfiltered metrics). */
function kpiRowFilter(w: KpiWidget): FilterExpr | undefined {
  return w.metric.filter ?? (w.metric.agg === "rate" ? w.metric.numerator : undefined);
}

export interface InsightInput {
  current: Snapshot;
  previous: Snapshot | null;
  schema: SchemaMap;
  layout: Layout;
  now?: number;
}

export function computeInsights({ current, previous, schema, layout, now = Date.now() }: InsightInput): Insight[] {
  const idField = schema.idField;
  const out: Insight[] = [];
  const curMask = fullMask(current);
  const kpis = kpiWidgets(layout);
  const fieldsById = new Map(current.fields.map((f) => [f.id, f]));
  const dateField = layout.dateField ? fieldsById.get(layout.dateField) : undefined;

  if (!previous) {
    const dateCol = dateField ? current.columns[dateField.id] : undefined;
    let min = Infinity, max = -Infinity;
    if (dateCol) for (const v of dateCol) if (typeof v === "number") { if (v < min) min = v; if (v > max) max = v; }
    out.push({ id: "base_rows", kind: "baseline", tone: "neutral", score: 1, headline: `First version: ${formatNumber(current.n)} rows loaded`, detail: Number.isFinite(min) ? `${dateField?.label ?? "Dates"} from ${formatDate(min, "long")} to ${formatDate(max, "long")}. Upload a newer file and this strip shows what changed.` : "Upload a newer file and this strip shows what changed." });
    for (const w of kpis.slice(0, 4)) {
      const v = computeMetric(current, curMask, w.metric);
      if (v === null) continue;
      const sec = w.secondary ? computeMetric(current, curMask, w.secondary.metric) : null;
      out.push({ id: `base_${w.id}`, kind: "baseline", tone: "neutral", score: 0.8, headline: `${w.title}: ${fmt(v, w.metric)}`, detail: w.secondary && sec !== null ? `${formatNumber(sec, w.secondary.metric.format ?? "integer", w.secondary.metric.currency)} ${w.secondary.label}` : undefined, filter: w.onClick });
    }
    return out.slice(0, 3);
  }

  const prevMask = fullMask(previous);
  const curIds = idsOf(current, idField);
  const prevIds = idsOf(previous, idField);
  const prevIndex = new Map<string, number>();
  prevIds.forEach((id, i) => { if (id) prevIndex.set(id, i); });
  const curIndex = new Map<string, number>();
  curIds.forEach((id, i) => { if (id) curIndex.set(id, i); });
  const added = curIds.filter((id): id is string => Boolean(id) && !prevIndex.has(id!));
  const removed = prevIds.filter((id): id is string => Boolean(id) && !curIndex.has(id!));

  // 1. KPI deltas with driven-by attribution.
  for (const w of kpis) {
    const cur = computeMetric(current, curMask, w.metric);
    const prev = computeMetric(previous, prevMask, w.metric);
    if (cur === null || prev === null) continue;
    const delta = cur - prev;
    if (Math.abs(delta) < 1e-9) continue;
    const isRate = w.metric.format === "percent";
    let rel = prev !== 0 ? Math.abs(delta) / Math.abs(prev) : Math.min(1, Math.abs(delta) / Math.max(1, Math.abs(cur)));
    if (w.metric.format === "days" && Math.abs(delta) < 1) rel *= 0.25;
    const good = w.good ?? "up";
    const tone: InsightTone = good === "none" ? "neutral" : (delta > 0) === (good === "up") ? "pos" : "neg";
    const filter = kpiRowFilter(w);
    let detail: string | undefined;
    const ids: string[] = [];
    if (w.metric.agg === "rate" && w.metric.numerator) {
      const num = w.metric.numerator, den = w.metric.denominator;
      const enteredNum: string[] = [], enteredBase: string[] = [];
      for (let i = 0; i < current.n; i++) {
        const id = curIds[i]; if (!id) continue;
        const pi = prevIndex.get(id);
        const inNumNow = rowMatches(current.columns, i, num), inNumBefore = pi !== undefined && rowMatches(previous.columns, pi, num);
        const inDenNow = den ? rowMatches(current.columns, i, den) : true, inDenBefore = pi !== undefined && (den ? rowMatches(previous.columns, pi, den) : true);
        if (inNumNow && !inNumBefore) enteredNum.push(id);
        else if (inDenNow && !inDenBefore && !inNumNow) enteredBase.push(id);
      }
      const parts: string[] = [];
      if (enteredNum.length) parts.push(`Now counting: ${listIds(enteredNum)}`);
      if (enteredBase.length) parts.push(`Added to the base without counting: ${listIds(enteredBase)}`);
      detail = parts.length ? parts.join(". ") + "." : undefined;
      ids.push(...enteredNum, ...enteredBase);
    } else if (filter) {
      const nowIn = rowsMatching(current, filter);
      const entered: string[] = [];
      for (const i of nowIn) { const id = curIds[i]; if (!id) continue; const pi = prevIndex.get(id); if (pi === undefined || !rowMatches(previous.columns, pi, filter)) entered.push(id); }
      const left: string[] = [];
      for (const i of rowsMatching(previous, filter)) { const id = prevIds[i]; if (!id) continue; const ci = curIndex.get(id); if (ci === undefined || !rowMatches(current.columns, ci, filter)) left.push(id); }
      if (entered.length && left.length) detail = `In: ${listIds(entered)}. Out: ${listIds(left)}.`;
      else if (entered.length) detail = `Driven by ${listIds(entered)}.`;
      else if (left.length) detail = `${listIds(left)} no longer count.`;
      ids.push(...entered, ...left);
    } else if (w.metric.agg === "count" && added.length) detail = `${added.length} new: ${listIds(added)}.`;
    const verb = delta > 0 ? (isRate ? "rose" : "up") : (isRate ? "fell" : "down");
    const headline = isRate
      ? `${w.title} ${verb} to ${fmt(cur, w.metric)} from ${fmt(prev, w.metric)}`
      : `${w.title} ${verb} ${formatNumber(Math.abs(delta), w.metric.format ?? "integer", w.metric.currency, true)} to ${fmt(cur, w.metric)}`;
    out.push({ id: `kpi_${w.id}`, kind: "kpi", tone, delta, score: Math.min(1.5, rel) + (isRate ? 0.25 : 0) + (good !== "none" ? 0.1 : 0), headline, detail, filter: w.onClick ?? filter, ids });
  }

  // 2. Row additions and removals.
  if (added.length) {
    const dimField = current.fields.find((f) => f.semantic === "mode") ?? current.fields.find((f) => f.role === "dimension" && !f.derived);
    let mix = "";
    if (dimField) {
      const counts = new Map<string, number>();
      for (const id of added) { const v = current.columns[dimField.id]?.[curIndex.get(id)!]; if (v !== null && v !== undefined) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1); }
      mix = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n} ${k}`).join(", ");
    }
    out.push({ id: "rows_added", kind: "rows", tone: "neutral", delta: added.length, score: Math.min(1.2, added.length / Math.max(3, previous.n * 0.1)), headline: `${added.length} new ${added.length === 1 ? "row" : "rows"} since the last upload`, detail: `${listIds(added)}${mix ? ` · ${mix}` : ""}`, filter: idField ? { field: idField, op: "in", value: added } : undefined, ids: added });
  }
  if (removed.length) out.push({ id: "rows_removed", kind: "rows", tone: "warn", delta: -removed.length, score: Math.min(1.2, removed.length / Math.max(3, previous.n * 0.1)) + 0.2, headline: `${removed.length} ${removed.length === 1 ? "row" : "rows"} disappeared from the sheet`, detail: `${listIds(removed)} were in the previous version but not this one.`, ids: removed });

  // 3. Stage and outcome transitions on rows present in both versions.
  const transitionFields = current.fields.filter((f) => f.role === "dimension" && ["status", "outcome", "lane"].includes(f.semantic ?? "") && previous.columns[f.id]);
  const transitions: { id: string; field: Field; from: ColumnValue; to: ColumnValue }[] = [];
  for (const [id, ci] of curIndex) {
    const pi = prevIndex.get(id);
    if (pi === undefined) continue;
    for (const f of transitionFields) {
      const a = previous.columns[f.id][pi], b = current.columns[f.id][ci];
      if (a !== b && !(a === null && b === null)) transitions.push({ id, field: f, from: a, to: b });
    }
  }
  const outcomeField = current.fields.find((f) => f.semantic === "outcome");
  if (outcomeField) {
    const decided = transitions.filter((t) => t.field.id === outcomeField.id && t.to !== null);
    if (decided.length) {
      const won = decided.filter((t) => /won|win/i.test(String(t.to)));
      const lost = decided.filter((t) => /lost|loss/i.test(String(t.to)));
      const reasonField = current.fields.find((f) => f.semantic === "reason");
      const lostDetail = lost.map((t) => { const r = reasonField ? current.columns[reasonField.id]?.[curIndex.get(t.id)!] : null; return `${t.id}${r ? ` (${r})` : ""}`; });
      out.push({ id: "decided", kind: "rows", tone: lost.length > won.length ? "neg" : won.length ? "pos" : "neutral", delta: won.length - lost.length, score: 0.9 + decided.length * 0.1, headline: `${decided.length} ${decided.length === 1 ? "quote was" : "quotes were"} decided: ${won.length} won, ${lost.length} lost`, detail: [won.length ? `Won: ${listIds(won.map((t) => t.id))}` : "", lost.length ? `Lost: ${listIds(lostDetail)}${lost.length && lostDetail.every((d) => !d.includes("(")) ? " · no reason recorded" : ""}` : ""].filter(Boolean).join(". "), filter: { field: outcomeField.id, op: "in", value: [...new Set(decided.map((t) => String(t.to)))] }, ids: decided.map((t) => t.id) });
    }
  }
  const stageMoves = transitions.filter((t) => t.field.semantic === "status" || (t.field.semantic === "lane" && t.field.id === "stage"));
  if (stageMoves.length) {
    const byMove = new Map<string, string[]>();
    for (const t of stageMoves) { const k = `${t.from ?? "blank"} → ${t.to ?? "blank"}`; (byMove.get(k) ?? byMove.set(k, []).get(k)!).push(t.id); }
    const top = [...byMove.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    const movedRows = new Set(stageMoves.map((t) => t.id)).size;
    out.push({ id: "stage_moves", kind: "rows", tone: "neutral", delta: movedRows, score: 0.5 + movedRows * 0.08, headline: `${movedRows} ${movedRows === 1 ? "row moved" : "rows moved"} stage`, detail: [...byMove.entries()].slice(0, 3).map(([k, ids]) => `${k}: ${listIds(ids, 3)}`).join(" · "), ids: top[1] });
  }

  // 4. Dimension shifts.
  for (const f of current.fields.filter((x) => x.role === "dimension" && previous.columns[x.id])) {
    const cur = new Map<string, number>(), prev = new Map<string, number>();
    for (const v of current.columns[f.id]) if (v !== null) cur.set(String(v), (cur.get(String(v)) ?? 0) + 1);
    for (const v of previous.columns[f.id]) if (v !== null) prev.set(String(v), (prev.get(String(v)) ?? 0) + 1);
    let best: { k: string; d: number; c: number; p: number } | null = null;
    for (const k of new Set([...cur.keys(), ...prev.keys()])) {
      const c = cur.get(k) ?? 0, p = prev.get(k) ?? 0, d = c - p;
      if (!best || Math.abs(d) > Math.abs(best.d)) best = { k, d, c, p };
    }
    if (!best || best.d === 0) continue;
    const score = Math.min(1, Math.abs(best.d) / Math.max(2, previous.n * 0.15)) * 0.7;
    if (score < 0.2) continue;
    const contributors = added.filter((id) => String(current.columns[f.id][curIndex.get(id)!]) === best!.k);
    out.push({ id: `dim_${f.id}`, kind: "dimension", tone: "neutral", delta: best.d, score, headline: `${f.label} · ${best.k} ${best.d > 0 ? "up" : "down"} ${Math.abs(best.d)} to ${best.c}`, detail: contributors.length ? `Driven by new rows ${listIds(contributors)}.` : `Was ${best.p} in the previous version.`, filter: { field: f.id, op: "eq", value: best.k } });
  }

  // 5. Aging: open rows that crossed 14 days since the previous version.
  const ageField = current.fields.find((f) => f.semantic === "age");
  if (ageField && idField) {
    const prevBuilt = Date.parse(previous.builtAt);
    const crossed: { id: string; age: number }[] = [];
    for (let i = 0; i < current.n; i++) {
      const age = current.columns[ageField.id][i];
      if (typeof age !== "number" || age < 14) continue;
      const id = curIds[i];
      if (!id) continue;
      const pi = prevIndex.get(id);
      const prevAge = pi !== undefined ? previous.columns[ageField.id]?.[pi] : null;
      const prevAgeAtBuild = typeof prevAge === "number" ? prevAge : null;
      if (prevAgeAtBuild === null || prevAgeAtBuild < 14) crossed.push({ id, age });
    }
    void prevBuilt; void now;
    if (crossed.length) {
      crossed.sort((a, b) => b.age - a.age);
      out.push({ id: "aging", kind: "aging", tone: "warn", delta: crossed.length, score: 0.6 + crossed.length * 0.1, headline: `${crossed.length} open ${crossed.length === 1 ? "item" : "items"} now older than two weeks`, detail: crossed.slice(0, 4).map((c) => `${c.id} ${c.age}d`).join(" · "), filter: { field: idField, op: "in", value: crossed.map((c) => c.id) }, ids: crossed.map((c) => c.id) });
    }
  }

  if (out.length === 0) out.push({ id: "nochange", kind: "baseline", tone: "neutral", score: 1, headline: "No material change since the previous upload", detail: `${formatNumber(current.n)} rows, same as before.` });
  return out.sort((a, b) => b.score - a.score);
}

/** Top-N insights with light de-duplication so three tiles do not tell the same story. */
export function topInsights(all: Insight[], n = 3): Insight[] {
  const picked: Insight[] = [];
  const seenIds = new Set<string>();
  for (const ins of all) {
    const overlap = ins.ids && ins.ids.length > 0 && ins.ids.every((id) => seenIds.has(id));
    if (overlap && picked.length > 0) continue;
    picked.push(ins);
    ins.ids?.forEach((id) => seenIds.add(id));
    if (picked.length === n) break;
  }
  return picked;
}

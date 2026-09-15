import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Field, FilterExpr, Snapshot } from "@/lib/schema/types";
import type { Widget } from "@/lib/dashboard/types";
import type { MetricSpec } from "@/lib/engine/metrics";
import { distinctValues } from "@/lib/engine/metrics";
import { formatDate } from "@/lib/engine/format";

/**
 * Natural-language questions become widget configs. Claude only chooses fields, aggregations and filters;
 * every number is computed by the deterministic engine in the browser.
 */

const FilterZ = z.object({
  field: z.string(),
  op: z.enum(["eq", "neq", "in", "nin", "isNull", "notNull", "gt", "gte", "lt", "lte", "between", "contains"]),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()])), z.null()]),
});

const MetricZ = z.object({
  agg: z.enum(["count", "sum", "avg", "median", "min", "max", "distinct", "rate"]),
  field: z.union([z.string(), z.null()]),
  /** Only rows matching these filters count towards the metric (AND). For rate, this is the numerator. */
  filters: z.array(FilterZ),
});

export const AnswerZ = z.object({
  kind: z.enum(["bar", "line", "kpi", "table", "heatmap", "cannot_answer"]),
  title: z.string(),
  /** One plain sentence telling the reader what the visual shows or why the question cannot be answered from this sheet. */
  explanation: z.string(),
  metric: MetricZ,
  /** Category field for bar and heatmap rows. */
  dimension: z.union([z.string(), z.null()]),
  /** Optional second category for stacked bars or heatmap columns. */
  stackBy: z.union([z.string(), z.null()]),
  /** Date field and unit for line charts. */
  dateField: z.union([z.string(), z.null()]),
  unit: z.union([z.enum(["day", "week", "month"]), z.null()]),
  /** Filters applied to all rows before aggregation (AND). */
  filters: z.array(FilterZ),
  topN: z.union([z.number(), z.null()]),
  /** For tables: the columns to show and the sort. */
  columns: z.array(z.string()),
  sortField: z.union([z.string(), z.null()]),
  sortDir: z.union([z.enum(["asc", "desc"]), z.null()]),
});

export type Answer = z.infer<typeof AnswerZ>;

function describeFields(snapshot: Snapshot, dateField?: string): string {
  const lines: string[] = [];
  for (const f of snapshot.fields) {
    let extra = "";
    if (f.role === "dimension") {
      const top = distinctValues(snapshot, f.id).slice(0, 12).map((d) => `${d.value} (${d.count})`);
      extra = ` values: ${top.join(", ")}${distinctValues(snapshot, f.id).length > 12 ? ", …" : ""}`;
    } else if (f.type === "date") {
      const col = snapshot.columns[f.id] ?? [];
      let min = Infinity, max = -Infinity;
      for (const v of col) if (typeof v === "number") { if (v < min) min = v; if (v > max) max = v; }
      if (Number.isFinite(min)) extra = ` range: ${formatDate(min, "iso")} to ${formatDate(max, "iso")}`;
    } else if (f.type === "number") {
      const col = snapshot.columns[f.id] ?? [];
      const vals = col.filter((v): v is number => typeof v === "number");
      if (vals.length) extra = ` min ${Math.min(...vals)} max ${Math.max(...vals)}, ${vals.length} non-empty${f.format === "currency" ? `, currency ${f.currency}` : f.format === "days" ? ", unit days" : ""}`;
    }
    lines.push(`- ${f.id} · "${f.label}" · ${f.type} · ${f.role}${f.semantic ? ` · meaning: ${f.semantic}` : ""}${dateField === f.id ? " · primary date" : ""}${extra}`);
  }
  return lines.join("\n");
}

export function buildSystemPrompt(snapshot: Snapshot, projectName: string, dateField?: string, now = new Date()): string {
  return `You translate questions about a dataset into a chart specification. You never compute numbers yourself; a deterministic engine computes them from the specification.

Dataset: "${projectName}", ${snapshot.n} rows. Today is ${now.toISOString().slice(0, 10)}.
Fields (use the id exactly as written):
${describeFields(snapshot, dateField)}

Rules:
- kind "kpi": a single number. Use metric only. dimension, dateField null.
- kind "bar": one category (dimension) with a metric per category; stackBy optional. Use topN for "top N".
- kind "line": trend over time; set dateField and unit; dimension null.
- kind "heatmap": two categories (dimension rows, stackBy columns).
- kind "table": list rows; set columns (field ids) and a sort; metric is ignored.
- kind "cannot_answer": the sheet has no field that carries what is asked (for example revenue or margin when no money field exists). Say what is missing in the explanation.
- Dates: "this quarter", "last month", "this week" become filters on the primary date with op "between" and values as ISO date strings [from, to]. "Recent" means the last 30 days.
- Rates ("win rate", "share of"): agg "rate" with metric.filters as the numerator; put the population in the top-level filters.
- Prefer existing category values verbatim. Match user words to values case-insensitively (won, Won).
- Keep titles short, like a chart title on a board report. Explanation is one sentence, no marketing language.`;
}

function toFilter(f: z.infer<typeof FilterZ>): FilterExpr {
  const v = f.value;
  const isoToMs = (x: unknown) => (typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x) ? Date.UTC(+x.slice(0, 4), +x.slice(5, 7) - 1, +x.slice(8, 10)) : x);
  if (f.op === "between" && Array.isArray(v)) {
    const [a, b] = v.map(isoToMs) as [number | null, number | null];
    const end = typeof b === "number" ? b + 86_400_000 - 1 : b;
    return { field: f.field, op: "between", value: [a, end] };
  }
  if (Array.isArray(v)) return { field: f.field, op: f.op, value: v };
  return { field: f.field, op: f.op, value: isoToMs(v) };
}

function toMetric(m: z.infer<typeof MetricZ>, fields: Map<string, Field>, population: FilterExpr[]): MetricSpec {
  const field = m.field && fields.has(m.field) ? m.field : undefined;
  const fdef = field ? fields.get(field) : undefined;
  const format = fdef?.format === "currency" ? "currency" : fdef?.format === "days" ? "days" : fdef?.format === "percent" ? "percent" : m.agg === "avg" ? "decimal" : "integer";
  const filters = m.filters.map(toFilter);
  if (m.agg === "rate") return { agg: "rate", numerator: filters.length ? { and: filters } : { and: [] }, denominator: population.length ? { and: population } : undefined, format: "percent" };
  const spec: MetricSpec = { agg: m.agg === "count" || m.agg === "distinct" ? m.agg : field ? m.agg : "count", field, format, currency: fdef?.currency };
  if (filters.length) spec.filter = { and: filters };
  return spec;
}

/** Turn a validated answer into a widget the dashboard can render. Throws when a referenced field does not exist. */
export function answerToWidget(a: Answer, snapshot: Snapshot, id = "ask"): { widget: Widget | null; filters: FilterExpr[] } {
  const fields = new Map(snapshot.fields.map((f) => [f.id, f]));
  const check = (fid: string | null | undefined, what: string) => { if (fid && !fields.has(fid)) throw new Error(`${what} refers to an unknown field: ${fid}`); };
  check(a.dimension, "dimension"); check(a.stackBy, "stackBy"); check(a.dateField, "dateField"); check(a.metric.field, "metric");
  for (const f of [...a.filters, ...a.metric.filters]) check(f.field, "filter");
  const filters = a.filters.map(toFilter);
  const metric = toMetric(a.metric, fields, filters);
  const base = { id, title: a.title, subtitle: a.explanation };
  switch (a.kind) {
    case "cannot_answer": return { widget: null, filters };
    case "kpi": return { widget: { ...base, type: "kpi", metric, good: "none" }, filters };
    case "bar": {
      if (!a.dimension) throw new Error("A bar chart needs a dimension");
      const dim = fields.get(a.dimension)!;
      return { widget: { ...base, type: "bar", dimension: a.dimension, metric, stackBy: a.stackBy ?? undefined, orientation: "horizontal", topN: a.topN ?? (dim.order ? undefined : 10), sort: dim.order ? "order" : "value", colorBy: a.stackBy ? "status" : "single" }, filters };
    }
    case "line": {
      const dateField = a.dateField ?? snapshot.fields.find((f) => f.role === "date")?.id;
      if (!dateField) throw new Error("No date field available for a trend");
      return { widget: { ...base, type: "line", dateField, unit: a.unit ?? "week", series: [{ label: a.title, metric, kind: "bar" }] }, filters };
    }
    case "heatmap": {
      if (!a.dimension || !a.stackBy) throw new Error("A heatmap needs two categories");
      return { widget: { ...base, type: "heatmap", rowDim: a.dimension, colDim: a.stackBy, metric }, filters };
    }
    case "table": {
      const cols = a.columns.filter((c) => fields.has(c));
      const columns = cols.length ? cols : snapshot.fields.filter((f) => !f.derived).slice(0, 8).map((f) => f.id);
      return { widget: { ...base, type: "table", columns, sort: a.sortField && fields.has(a.sortField) ? { field: a.sortField, dir: a.sortDir ?? "desc" } : undefined, filter: filters.length ? { and: filters } : undefined, pageSize: 25, search: false }, filters };
    }
  }
}

export interface AskResult { answer: Answer; widget: Widget | null; filters: FilterExpr[]; model: string }

export async function askClaude(question: string, snapshot: Snapshot, projectName: string, dateField?: string): Promise<AskResult> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured in Vercel.");
  const client = new Anthropic();
  const system = buildSystemPrompt(snapshot, projectName, dateField);
  const ask = async (extra?: string) => {
    const response = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 4096,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: "claude-opus-4-8" }],
      output_config: { effort: "medium", format: zodOutputFormat(AnswerZ) },
      system,
      messages: [{ role: "user", content: extra ? `${question}\n\nYour previous specification failed validation: ${extra}. Fix it.` : question }],
    });
    if (response.stop_reason === "refusal") throw new Error("The question was declined by the model's safety system.");
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") throw new Error("No specification was returned.");
    return { parsed: AnswerZ.parse(JSON.parse(text.text)), model: response.model };
  };
  let { parsed, model } = await ask();
  try {
    const built = answerToWidget(parsed, snapshot);
    return { answer: parsed, ...built, model };
  } catch (e) {
    ({ parsed, model } = await ask(e instanceof Error ? e.message : String(e)));
    const built = answerToWidget(parsed, snapshot);
    return { answer: parsed, ...built, model };
  }
}

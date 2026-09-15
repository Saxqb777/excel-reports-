import { readFileSync } from "node:fs";
import { ingestNew } from "@/lib/ingest";
import { buildMask } from "@/lib/engine/filters";
import { computeMetric, groupBy, timeSeries } from "@/lib/engine/metrics";

async function main() {
  const file = process.argv[2];
  const buf = readFileSync(file);
  const res = await ingestNew(buf, file.split("/").pop()!);
  const s = res.snapshot;
  console.log("template:", res.template, "| sheet:", res.workbook.sheets[res.workbook.primary].name, "| headers:", res.workbook.sheets[res.workbook.primary].headers.length, "| raw rows:", res.workbook.sheets[res.workbook.primary].rows.length);
  console.log("validations:", JSON.stringify(res.workbook.sheets[res.workbook.primary].validations));
  console.log("fields:", s.fields.map((f) => `${f.id}:${f.type}/${f.role}${f.semantic ? "@" + f.semantic : ""}${f.derived ? "*" : ""}`).join("  "));
  console.log("n =", s.n, "| excluded:", JSON.stringify(s.excluded), "| fixes:", JSON.stringify(s.fixes));
  const show = ["tracking_no", "origin", "destination", "freight_type", "date_received", "date_quoted", "quotation_status", "outcome", "stage", "turnaround_days", "age_days", "lane_type", "business_unit", "equipment"];
  for (let i = 0; i < s.n; i++) console.log(show.map((k) => { const v = s.columns[k]?.[i]; return k.includes("date") && typeof v === "number" ? new Date(v).toISOString().slice(0, 10) : String(v ?? "·"); }).join(" | "));
  const mask = buildMask(s.columns, s.n, []);
  console.log("count", computeMetric(s, mask, { agg: "count" }), "| win rate", computeMetric(s, mask, { agg: "rate", numerator: { field: "outcome", op: "eq", value: "Won" }, denominator: { field: "outcome", op: "in", value: ["Won", "Lost"] } }), "| median turnaround", computeMetric(s, mask, { agg: "median", field: "turnaround_days" }));
  console.log("by stage", JSON.stringify(groupBy(s, mask, "freight_type", { agg: "count" }, { stackBy: "stage", sort: "order", order: ["Land", "Air", "Sea", "Multimodal"] })));
  console.log("weekly", JSON.stringify(timeSeries(s, mask, "date_received", "week", { agg: "count" }).map((p) => [new Date(p.t).toISOString().slice(0, 10), p.value])));
  console.log("layout pages:", res.layout?.pages.map((p) => `${p.title}(${p.widgets.length})`).join(", "));
}
main().catch((e) => { console.error(e); process.exit(1); });

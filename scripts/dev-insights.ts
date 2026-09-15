import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { ingestNew } from "@/lib/ingest";
import { parseWorkbook } from "@/lib/excel/parse";
import { buildSnapshot } from "@/lib/schema/normalize";
import { computeInsights, topInsights } from "@/lib/intelligence/insights";
import { computeAnomalies, kpiValues } from "@/lib/intelligence/anomalies";
import { logicChecks } from "@/lib/intelligence/quality";

async function main() {
  const buf = readFileSync(process.argv[2]);
  const v1 = await ingestNew(buf, "Aghtia.xlsx", "u1");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  // v2: AG013 gets quoted, AG009 lost on price, AG002 won, 3 new RFQs, AG011 removed
  ws.getCell("G14").value = new Date(Date.UTC(2026, 8, 12)); ws.getCell("H14").value = "Quoted";
  ws.getCell("G10").value = new Date(Date.UTC(2026, 8, 11)); ws.getCell("H10").value = "Quoted"; ws.getCell("I10").value = "Lost"; ws.getCell("J10").value = "High Price";
  ws.getCell("I3").value = "Won";
  ws.spliceRows(12, 1);
  const add = (r: number, id: string, desc: string, o: string, d: string, ft: string, day: number, status: string) => { ws.getCell(`A${r}`).value = id; ws.getCell(`B${r}`).value = desc; ws.getCell(`C${r}`).value = o; ws.getCell(`D${r}`).value = d; ws.getCell(`E${r}`).value = ft; ws.getCell(`F${r}`).value = new Date(Date.UTC(2026, 8, day)); ws.getCell(`H${r}`).value = status; };
  add(19, "AG019", "Reefer to Kizad", "Al Ain", "Kizad", "Land", 14, "Pending");
  add(20, "AG020", "Flour export to Oman", "GMFF (Mina Zayed)", "Oman", "Land", 14, "Pending");
  add(21, "AG021", "Air freight samples to UK", "Al Ain", "UK", "Air", 15, "Pending");
  const out = Buffer.from(await wb.xlsx.writeBuffer());
  const parsed = await parseWorkbook(out, "Aghtia-v2.xlsx");
  const sheet = parsed.sheets[parsed.primary];
  const v2 = buildSnapshot(v1.schema, sheet, { uploadId: "u2", version: 2 });
  const all = computeInsights({ current: v2, previous: v1.snapshot, schema: v1.schema, layout: v1.layout! });
  console.log("=== ALL INSIGHTS (ranked)");
  for (const i of all) console.log(`[${i.score.toFixed(2)}] ${i.tone.padEnd(7)} ${i.headline}\n         ${i.detail ?? ""}`);
  console.log("=== TOP 3");
  for (const i of topInsights(all)) console.log(`- ${i.headline} — ${i.detail ?? ""}`);
  console.log("=== BASELINE (no previous)");
  for (const i of computeInsights({ current: v1.snapshot, previous: null, schema: v1.schema, layout: v1.layout! })) console.log(`- ${i.headline} — ${i.detail ?? ""}`);
  console.log("=== ANOMALIES v2 (history of 1)");
  const hist = [{ version: 1, values: kpiValues(v1.snapshot, v1.layout!) }, { version: 2, values: kpiValues(v2, v1.layout!) }];
  for (const a of computeAnomalies({ current: v2, history: hist, schema: v1.schema, layout: v1.layout! })) console.log(`- ${a.scope} ${a.label} z=${a.z.toFixed(1)}: ${a.detail}`);
  console.log("=== LOGIC CHECKS v1");
  for (const l of logicChecks(v1.snapshot)) console.log(`- ${l.severity} ${l.rule}: ${l.rows.join(", ")}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

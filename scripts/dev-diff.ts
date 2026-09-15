import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { ingestNew } from "@/lib/ingest";
import { parseWorkbook } from "@/lib/excel/parse";
import { diffSchema } from "@/lib/schema/infer";
import { describeDiff, applyMapping } from "@/lib/data/uploads";
import { buildSnapshot } from "@/lib/schema/normalize";

async function main() {
  const file = process.argv[2];
  const buf = readFileSync(file);
  const first = await ingestNew(buf, "Aghtia.xlsx", "u1");
  // Build a modified workbook: rename "Won/Lost" -> "Outcome", add "Quote Value (AED)", drop "Reason for Loss", add 2 rows.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  ws.getCell("I1").value = "Outcome";
  ws.getCell("J1").value = "Quote Value (AED)";
  for (let r = 2; r <= 19; r++) ws.getCell(`J${r}`).value = 1000 * r;
  ws.getCell("A20").value = "AG019"; ws.getCell("B20").value = "Reefer to Kizad"; ws.getCell("C20").value = "Al Ain"; ws.getCell("D20").value = "Kizad"; ws.getCell("E20").value = "Land"; ws.getCell("F20").value = new Date(Date.UTC(2026, 8, 14)); ws.getCell("H20").value = "Pending";
  const out = Buffer.from(await wb.xlsx.writeBuffer());
  const parsed = await parseWorkbook(out, "Aghtia-v2.xlsx");
  const sheet = parsed.sheets[parsed.primary];
  const diff = diffSchema(first.schema, sheet);
  const payload = describeDiff(diff, sheet);
  console.log("needsConfirmation:", payload.needsConfirmation);
  console.log("matched non-exact:", payload.matched.filter((m) => m.how !== "exact"));
  console.log("missing:", payload.missing.map((m) => m.label));
  console.log("added:", payload.added);
  const mapped = applyMapping(first.schema, diff, sheet, { "Quote Value (AED)": "new", "Outcome": "outcome" });
  const outcome = mapped.fields.find((f) => f.id === "outcome")!;
  console.log("outcome source/aliases:", outcome.source, outcome.aliases);
  const qv = mapped.fields.find((f) => f.source === "Quote Value (AED)")!;
  console.log("new field:", qv.id, qv.type, qv.role, qv.semantic, qv.format, qv.currency);
  const snap = buildSnapshot(mapped, sheet, { uploadId: "u2", version: 2 });
  console.log("v2 rows:", snap.n, "excluded:", snap.excluded.length, "quote value sum:", snap.columns[qv.id].reduce((a: number, v) => a + (typeof v === "number" ? v : 0), 0), "outcome won count:", snap.columns["outcome"].filter((v) => v === "Won").length, "reason col all null:", snap.columns["reason_for_loss"].every((v) => v === null));
  // Re-diff with the mapped schema should need no confirmation now.
  const diff2 = diffSchema(mapped, sheet);
  console.log("second diff needsConfirmation:", describeDiff(diff2, sheet).needsConfirmation, "(missing:", diff2.missing.map((f) => f.label), ")");
}
main().catch((e) => { console.error(e); process.exit(1); });

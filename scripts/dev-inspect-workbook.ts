import { readFileSync } from "node:fs";
import { ingestNew } from "@/lib/ingest";

async function main() {
  const file = process.argv[2];
  const res = await ingestNew(readFileSync(file), file.split("/").pop()!, "upl_test");
  const sheet = res.workbook.sheets[res.workbook.primary];
  console.log("sheets:", res.workbook.sheets.map((s) => `${s.name} (${s.rows.length} rows x ${s.headers.length} cols)`).join(" | "), "→ primary:", sheet.name, "header row", sheet.headerRow);
  console.log("template:", res.template, "| rows kept:", res.snapshot.n, "excluded:", res.snapshot.excluded.length, "fixes:", res.snapshot.fixes.length);
  console.log("idField:", res.schema.idField, "primaryDate:", res.schema.primaryDate);
  for (const f of res.schema.fields) console.log(`  ${f.id.padEnd(22)} ${f.role.padEnd(9)} ${f.type.padEnd(7)} ${(f.semantic ?? "").padEnd(14)} ${f.derived ? "derived" : ""} ${f.format ?? ""}`);
  for (const p of res.layout?.pages ?? []) console.log("page", p.title, "→", p.widgets.map((w) => `${w.type}:${w.title}`).join(" | "));
  console.log("filters:", (res.layout?.filters ?? []).map((f) => `${f.kind}:${f.field}`).join(" | "));
  if (res.snapshot.excluded.length) console.log("excluded sample:", res.snapshot.excluded.slice(0, 5));
}
main().catch((e) => { console.error(e); process.exit(1); });

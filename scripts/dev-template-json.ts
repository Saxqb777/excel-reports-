import { readFileSync, writeFileSync } from "node:fs";
import { ingestNew } from "@/lib/ingest";

/** Writes the schema map and layout a template produces for a workbook, for applying to an existing project. */
async function main() {
  const [file, outDir] = [process.argv[2], process.argv[3]];
  const res = await ingestNew(readFileSync(file), file.split("/").pop()!, "upl_tmp");
  writeFileSync(`${outDir}/schema.json`, JSON.stringify(res.schema));
  writeFileSync(`${outDir}/layout.json`, JSON.stringify(res.layout));
  console.log("template", res.template, "fields", res.schema.fields.length, "pages", res.layout?.pages.length, "schema bytes", JSON.stringify(res.schema).length, "layout bytes", JSON.stringify(res.layout).length);
}
main().catch((e) => { console.error(e); process.exit(1); });

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ingestNew } from "@/lib/ingest";

async function main() {
  const [file, outDir] = [process.argv[2], process.argv[3] ?? "fixtures"];
  const buf = readFileSync(file);
  const res = await ingestNew(buf, file.split("/").pop()!, "upl_fixture");
  const now = new Date().toISOString();
  const fixture = {
    project: {
      id: "prj_agthia", slug: "agthia", name: "Agthia RFQ pipeline", clientName: "Agthia Group", description: "Freight quotation pipeline for the Agthia account.",
      theme: { name: "Agthia", primary: "#4d8dff", mode: "dark", logoUrl: null, monogram: "AG" }, layout: res.layout, schemaMap: res.schema, settings: {},
      shareToken: "fixture", shareEnabled: true, hasSharePassword: false, currentUploadId: "upl_fixture", updatedAt: now, createdAt: now,
    },
    upload: { id: "upl_fixture", versionNo: 1, fileName: file.split("/").pop(), fileSize: buf.length, uploadedBy: "Saaqib", uploadedAt: now, rowCount: res.snapshot.n, excludedCount: res.snapshot.excluded.length, status: "ready", sheetName: res.workbook.sheets[res.workbook.primary].name, headers: res.workbook.sheets[res.workbook.primary].headers },
    snapshot: res.snapshot,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/agthia.json`, JSON.stringify(fixture));
  console.log("fixture written", `${outDir}/agthia.json`, res.snapshot.n, "rows");
}
main().catch((e) => { console.error(e); process.exit(1); });

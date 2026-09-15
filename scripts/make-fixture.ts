import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ingestNew } from "@/lib/ingest";

async function main() {
  const [file, outDir] = [process.argv[2], process.argv[3] ?? "fixtures"];
  const buf = readFileSync(file);
  const res = await ingestNew(buf, file.split("/").pop()!, "upl_fixture");
  const now = new Date().toISOString();
  // Synthesise the version before this one: the last three rows did not exist yet, one status and one remark differed.
  const snap = res.snapshot;
  const keep = Math.max(1, snap.n - 3);
  const columns: typeof snap.columns = {};
  for (const [k, v] of Object.entries(snap.columns)) columns[k] = v.slice(0, keep);
  const statusField = snap.fields.find((f) => f.semantic === "status" && !f.derived);
  const remarksField = snap.fields.find((f) => f.semantic === "remarks" && !f.derived);
  if (statusField) { const col = columns[statusField.id]; const other = col.find((v) => v !== null && v !== col[0]); if (other !== undefined) col[0] = other; }
  if (remarksField) columns[remarksField.id][1] = "Awaiting rates from the carrier";
  const previousSnapshot = { ...snap, uploadId: "upl_fixture_prev", version: 1, n: keep, columns, rowRefs: snap.rowRefs.slice(0, keep) };
  const earlier = new Date(Date.now() - 3 * 86400_000).toISOString();
  const fixture = {
    project: {
      id: "prj_agthia", slug: "agthia", name: "Agthia RFQ pipeline", clientName: "Agthia Group", description: "Freight quotation pipeline for the Agthia account.",
      theme: { name: "Agthia", primary: "#4d8dff", mode: "dark", logoUrl: null, monogram: "AG" }, layout: res.layout, schemaMap: res.schema, settings: {},
      shareToken: "fixture", shareEnabled: true, hasSharePassword: false, currentUploadId: "upl_fixture", updatedAt: now, createdAt: now,
    },
    upload: { id: "upl_fixture", versionNo: 2, fileName: file.split("/").pop(), fileSize: buf.length, uploadedBy: "Saaqib", uploadedAt: now, rowCount: res.snapshot.n, excludedCount: res.snapshot.excluded.length, status: "ready", sheetName: res.workbook.sheets[res.workbook.primary].name, headers: res.workbook.sheets[res.workbook.primary].headers },
    snapshot: { ...res.snapshot, version: 2 },
    previousUpload: { id: "upl_fixture_prev", versionNo: 1, fileName: file.split("/").pop(), fileSize: buf.length, uploadedBy: "Saaqib", uploadedAt: earlier, rowCount: keep, excludedCount: res.snapshot.excluded.length, status: "ready", sheetName: res.workbook.sheets[res.workbook.primary].name, headers: res.workbook.sheets[res.workbook.primary].headers },
    previousSnapshot,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/agthia.json`, JSON.stringify(fixture));
  console.log("fixture written", `${outDir}/agthia.json`, res.snapshot.n, "rows");
}
main().catch((e) => { console.error(e); process.exit(1); });

/**
 * Generates SQL that seeds a project from a workbook, for environments where the app cannot reach the database directly.
 * Usage: npx tsx scripts/seed-sql.ts <file.xlsx> <slug> <name> <clientName> <uploadedBy> > out.sql
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { ingestNew } from "@/lib/ingest";
import type { Theme } from "@/lib/dashboard/types";

const q = (v: unknown) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const j = (v: unknown) => `${q(JSON.stringify(v))}::jsonb`;
const id = (p: string) => p + "_" + createHash("sha1").update(String(Math.random()) + Date.now()).digest("hex").slice(0, 10);

async function main() {
  const [file, slug, name, clientName, uploadedBy] = process.argv.slice(2);
  const buf = readFileSync(file);
  const fileName = file.split("/").pop()!;
  const projectId = id("prj"), uploadId = id("upl");
  const res = await ingestNew(buf, fileName, uploadId);
  const sheet = res.workbook.sheets[res.workbook.primary];
  const schemaHash = createHash("sha1").update(JSON.stringify(res.schema)).digest("hex").slice(0, 12);
  const snapshot = { ...res.snapshot, schemaHash };
  const theme: Theme = { name, clientName, primary: "#4d8dff", mode: "dark", logoUrl: null, monogram: name.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase() };
  const token = createHash("sha256").update(projectId + Date.now()).digest("base64url").slice(0, 22);
  const stmts: string[] = [];
  stmts.push(`INSERT INTO projects (id, slug, name, client_name, description, theme, schema_map, layout, settings, current_upload_id, share_token, share_enabled) VALUES (${q(projectId)}, ${q(slug)}, ${q(name)}, ${q(clientName)}, ${q(`Freight quotation pipeline for the ${clientName} account.`)}, ${j(theme)}, ${j(res.schema)}, ${j(res.layout)}, '{}'::jsonb, NULL, ${q(token)}, true)`);
  const withBytes = !process.env.NO_BYTES;
  const withSnapshot = !process.env.NO_SNAPSHOT;
  stmts.push(`INSERT INTO uploads (id, project_id, version_no, file_name, file_size, file_sha256, storage_kind, storage_ref, file_bytes, uploaded_by, sheet_name, row_count, excluded_count, headers, schema_snapshot, snapshot, status) VALUES (${q(uploadId)}, ${q(projectId)}, 1, ${q(fileName)}, ${buf.length}, ${q(res.sha256)}, ${withBytes ? "'pg'" : "'none'"}, NULL, ${withBytes ? `decode(${q(buf.toString("base64"))}, 'base64')` : "NULL"}, ${q(uploadedBy)}, ${q(sheet.name)}, ${snapshot.n}, ${snapshot.excluded.length}, ${j(sheet.headers)}, ${j(res.schema)}, ${withSnapshot ? j(snapshot) : "NULL"}, 'ready')`);
  const values = sheet.rows.map((r) => `(${q(uploadId)}, ${r.row}, ${j(r.cells)})`).join(",\n");
  stmts.push(`INSERT INTO upload_rows (upload_id, row_no, cells) VALUES ${values}`);
  stmts.push(`UPDATE projects SET current_upload_id = ${q(uploadId)} WHERE id = ${q(projectId)}`);
  process.stdout.write(JSON.stringify(stmts));
}
main().catch((e) => { console.error(e); process.exit(1); });

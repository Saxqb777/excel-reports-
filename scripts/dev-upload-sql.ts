import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ingestNew } from "@/lib/ingest";

/**
 * Emits the SQL that adds a new version of a workbook to an existing project when the app cannot be reached but the
 * database can (applied through the Neon MCP). The template is re-run on the file, so the project's schema map and
 * layout are refreshed at the same time (new columns picked up, previous versions rebuilt by the app on first load).
 *
 * Usage: npx tsx scripts/dev-upload-sql.ts <file> <projectId> <versionNo> <outDir> [--chunk 10]
 */
const lit = (s: string | null | undefined) => (s === null || s === undefined ? "NULL" : `'${s.replace(/'/g, "''")}'`);
const json = (v: unknown) => { const s = JSON.stringify(v); if (s.includes("$j$")) throw new Error("JSON contains the quote tag"); return `$j$${s}$j$::jsonb`; };

async function main() {
  const [file, projectId, versionArg, outDir] = process.argv.slice(2);
  if (!file || !projectId || !versionArg || !outDir) throw new Error("usage: dev-upload-sql.ts <file> <projectId> <versionNo> <outDir>");
  const chunkAt = process.argv.indexOf("--chunk");
  const chunk = chunkAt >= 0 ? Number(process.argv[chunkAt + 1]) : 10;
  const version = Number(versionArg);
  const buf = readFileSync(file);
  const fileName = file.split("/").pop()!;
  const uploadId = `upl_${randomBytes(8).toString("base64url").slice(0, 10)}`;
  const res = await ingestNew(buf, fileName, uploadId);
  const sheet = res.workbook.sheets[res.workbook.primary];
  const sha = createHash("sha256").update(buf).digest("hex");
  const statements: string[] = [];
  statements.push(`UPDATE projects SET schema_map = ${json(res.schema)}, layout = ${json(res.layout)}, settings = settings || ${json({ template: res.template })}, updated_at = now() WHERE id = ${lit(projectId)}`);
  statements.push(`INSERT INTO uploads (id, project_id, version_no, file_name, file_size, file_sha256, storage_kind, storage_ref, file_bytes, uploaded_by, sheet_name, row_count, excluded_count, headers, schema_snapshot, snapshot, sheets, status) SELECT ${lit(uploadId)}, ${lit(projectId)}, ${version}, ${lit(fileName)}, ${buf.length}, ${lit(sha)}, 'pg', NULL, NULL, '', ${lit(sheet.name)}, ${res.snapshot.n}, ${res.snapshot.excluded.length}, ${json(sheet.headers)}, p.schema_map, NULL, ${json(res.aux)}, 'ready' FROM projects p WHERE p.id = ${lit(projectId)}`);
  const rows = sheet.rows.map((r) => `(${lit(uploadId)}, ${r.row}, ${json(r.cells)})`);
  for (let i = 0; i < rows.length; i += chunk) statements.push(`INSERT INTO upload_rows (upload_id, row_no, cells) VALUES ${rows.slice(i, i + chunk).join(", ")} RETURNING row_no`);
  statements.push(`UPDATE projects SET current_upload_id = ${lit(uploadId)}, updated_at = now() WHERE id = ${lit(projectId)}`);
  mkdirSync(outDir, { recursive: true });
  statements.forEach((s, i) => writeFileSync(`${outDir}/stmt${i + 1}.sql`, s));
  const summary = { projectId, uploadId, version, template: res.template, sheet: sheet.name, rows: res.snapshot.n, excluded: res.snapshot.excluded.length, fixes: res.snapshot.fixes.length, fields: res.schema.fields.length, pages: res.layout?.pages.map((p) => p.title), statements: statements.map((s, i) => ({ file: `stmt${i + 1}.sql`, chars: s.length })) };
  writeFileSync(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });

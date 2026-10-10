import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ingestNew } from "@/lib/ingest";

/**
 * Emits the SQL that refreshes an existing project and its current upload from the template's view of a workbook,
 * without adding a version: the project's schema map and layout, and the upload's secondary sheets.
 *
 * Usage: npx tsx scripts/dev-refresh-sql.ts <file> <projectId> <uploadId> <outDir>
 */
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const json = (v: unknown) => { const s = JSON.stringify(v); if (s.includes("$j$")) throw new Error("JSON contains the quote tag"); return `$j$${s}$j$::jsonb`; };

async function main() {
  const [file, projectId, uploadId, outDir] = process.argv.slice(2);
  if (!file || !projectId || !uploadId || !outDir) throw new Error("usage: dev-refresh-sql.ts <file> <projectId> <uploadId> <outDir>");
  const res = await ingestNew(readFileSync(file), file.split("/").pop()!, uploadId);
  const statements = [
    `UPDATE projects SET schema_map = ${json(res.schema)}, layout = ${json(res.layout)}, settings = settings || ${json({ template: res.template })}, updated_at = now() WHERE id = ${lit(projectId)}`,
    `UPDATE uploads SET sheets = ${json(res.aux)}, schema_snapshot = ${json(res.schema)} WHERE id = ${lit(uploadId)} AND project_id = ${lit(projectId)}`,
  ];
  mkdirSync(outDir, { recursive: true });
  statements.forEach((s, i) => writeFileSync(`${outDir}/stmt${i + 1}.sql`, s));
  console.log(JSON.stringify({ template: res.template, fields: res.schema.fields.length, pages: res.layout?.pages.map((p) => p.title), aux: Object.fromEntries(Object.entries(res.aux).map(([k, v]) => [k, v.rows.length])), statements: statements.map((s, i) => ({ file: `stmt${i + 1}.sql`, chars: s.length })) }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });

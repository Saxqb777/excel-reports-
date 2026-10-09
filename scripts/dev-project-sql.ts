import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ingestNew } from "@/lib/ingest";
import { schemaHash } from "@/lib/data/projects";

/**
 * Emits the SQL statements that create a project from a workbook, for environments where the app itself cannot be
 * reached but the database can (the sandbox applies them through the Neon MCP). Mirrors createProjectFromWorkbook:
 * the file is kept in Postgres (storage_kind "pg") and the snapshot is left for the app to build on first load.
 *
 * Usage: npx tsx scripts/dev-project-sql.ts <file> <outDir> --name "..." --slug ... [--primary #hex] [--monogram XX] [--mode dark|light] [--domains a,b] [--description "..."]
 */
function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const lit = (s: string | null | undefined) => (s === null || s === undefined ? "NULL" : `'${s.replace(/'/g, "''")}'`);
const json = (v: unknown) => { const s = JSON.stringify(v); if (s.includes("$j$")) throw new Error("JSON contains the quote tag"); return `$j$${s}$j$::jsonb`; };

async function main() {
  const [file, outDir] = [process.argv[2], process.argv[3]];
  if (!file || !outDir) throw new Error("usage: dev-project-sql.ts <file> <outDir> --name ... --slug ...");
  const name = arg("name")!, slug = arg("slug")!;
  const primary = arg("primary", "#4d8dff")!, mode = arg("mode", "dark")!;
  const monogram = arg("monogram", name.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase())!;
  const domains = (arg("domains", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const buf = readFileSync(file);
  const fileName = file.split("/").pop()!;
  const projectId = `prj_${randomBytes(8).toString("base64url").slice(0, 10)}`;
  const uploadId = `upl_${randomBytes(8).toString("base64url").slice(0, 10)}`;
  const res = await ingestNew(buf, fileName, uploadId);
  const sheet = res.workbook.sheets[res.workbook.primary];
  const description = arg("description", res.template === "containers" ? "Export containers with documents and vessel schedule." : `Dashboard generated from ${fileName}.`)!;
  const theme = { name, primary, mode, logoUrl: null, monogram };
  const settings: Record<string, unknown> = { template: res.template, ...(domains.length ? { domains, rootView: "dashboard" } : {}) };
  const shareToken = createHash("sha256").update(projectId + randomBytes(16).toString("hex")).digest("base64url").slice(0, 22);
  const schema = { ...res.schema };
  const statements: string[] = [];
  statements.push(`INSERT INTO projects (id, slug, name, client_name, description, theme, schema_map, layout, settings, current_upload_id, share_token, share_enabled) VALUES (${lit(projectId)}, ${lit(slug)}, ${lit(name)}, NULL, ${lit(description)}, ${json(theme)}, ${json(schema)}, ${json(res.layout)}, ${json(settings)}, NULL, ${lit(shareToken)}, true)`);
  statements.push(`INSERT INTO uploads (id, project_id, version_no, file_name, file_size, file_sha256, storage_kind, storage_ref, file_bytes, uploaded_by, sheet_name, row_count, excluded_count, headers, schema_snapshot, snapshot, status) VALUES (${lit(uploadId)}, ${lit(projectId)}, 1, ${lit(fileName)}, ${buf.length}, ${lit(res.sha256)}, 'pg', NULL, decode('${buf.toString("hex")}', 'hex'), '', ${lit(sheet.name)}, ${res.snapshot.n}, ${res.snapshot.excluded.length}, ${json(sheet.headers)}, ${json(schema)}, NULL, 'ready')`);
  const rows = sheet.rows.map((r) => `(${lit(uploadId)}, ${r.row}, ${json(r.cells)})`);
  for (let i = 0; i < rows.length; i += 20) statements.push(`INSERT INTO upload_rows (upload_id, row_no, cells) VALUES ${rows.slice(i, i + 20).join(", ")}`);
  statements.push(`UPDATE projects SET current_upload_id = ${lit(uploadId)}, updated_at = now() WHERE id = ${lit(projectId)}`);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/statements.json`, JSON.stringify(statements));
  writeFileSync(`${outDir}/summary.json`, JSON.stringify({ projectId, uploadId, slug, shareToken, template: res.template, rows: res.snapshot.n, excluded: res.snapshot.excluded.length, fixes: res.snapshot.fixes.length, fields: schema.fields.length, pages: res.layout?.pages.map((p) => p.title), schemaHash: schemaHash(schema), bytes: statements.reduce((a, s) => a + s.length, 0) }, null, 2));
  console.log(readFileSync(`${outDir}/summary.json`, "utf8"));
}
main().catch((e) => { console.error(e); process.exit(1); });

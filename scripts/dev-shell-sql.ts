import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ingestNew } from "@/lib/ingest";

/**
 * Emits the SQL that creates a project shell (schema, layout, theme, settings, no data) from a workbook's template, for
 * workbooks too large to load through the database connection: the first version is then dropped on the live dashboard,
 * whose empty state takes uploads (large files go straight to Blob storage).
 *
 * Usage: npx tsx scripts/dev-shell-sql.ts <file> <outFile> --name "..." --slug ... [--primary #hex] [--monogram XX] [--mode dark|light]
 *        [--domains a,b] [--description "..."] [--reference reference.json]   (reference: settings.referenceSheets, kept out of the repo)
 */
const arg = (name: string, fallback?: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; };
const lit = (s: string | null | undefined) => (s === null || s === undefined ? "NULL" : `'${s.replace(/'/g, "''")}'`);
const json = (v: unknown) => { const s = JSON.stringify(v); if (s.includes("$j$")) throw new Error("JSON contains the quote tag"); return `$j$${s}$j$::jsonb`; };

async function main() {
  const [file, outFile] = [process.argv[2], process.argv[3]];
  if (!file || !outFile) throw new Error("usage: dev-shell-sql.ts <file> <outFile> --name ... --slug ...");
  const name = arg("name")!, slug = arg("slug")!;
  const res = await ingestNew(readFileSync(file), file.split("/").pop()!);
  const domains = (arg("domains", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const reference = arg("reference") ? JSON.parse(readFileSync(arg("reference")!, "utf8")) : undefined;
  const settings: Record<string, unknown> = { template: res.template, ...(domains.length ? { domains, rootView: "dashboard" } : {}), ...(reference ? { referenceSheets: reference } : {}) };
  const theme = { name, primary: arg("primary", "#4d8dff"), mode: arg("mode", "dark"), logoUrl: null, monogram: arg("monogram", name.slice(0, 2).toUpperCase()) };
  const projectId = `prj_${randomBytes(8).toString("base64url").slice(0, 10)}`;
  const shareToken = createHash("sha256").update(projectId + randomBytes(16).toString("hex")).digest("base64url").slice(0, 22);
  const sql = `INSERT INTO projects (id, slug, name, client_name, description, theme, schema_map, layout, settings, current_upload_id, share_token, share_enabled) VALUES (${lit(projectId)}, ${lit(slug)}, ${lit(name)}, NULL, ${lit(arg("description", `Dashboard for ${name}.`))}, ${json(theme)}, ${json(res.schema)}, ${json(res.layout)}, ${json(settings)}, NULL, ${lit(shareToken)}, true) RETURNING id, slug`;
  mkdirSync(outFile.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  writeFileSync(outFile, sql);
  console.log(JSON.stringify({ projectId, slug, template: res.template, rows: res.snapshot.n, pages: res.layout?.pages.map((p) => p.title), chars: sql.length }));
}
main().catch((e) => { console.error(e); process.exit(1); });

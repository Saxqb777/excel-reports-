import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { ingestNew } from "@/lib/ingest";
import { storeFile } from "@/lib/storage/files";
import type { Theme } from "@/lib/dashboard/types";
import { schemaHash } from "./projects";
import { slugify, type FieldRole } from "@/lib/schema/types";
import { buildSnapshot } from "@/lib/schema/normalize";
import { proposeLayout } from "@/lib/dashboard/propose";

export interface FieldOverride { id: string; label?: string; role?: FieldRole; hidden?: boolean }
export interface CreateProjectInput { buffer: Buffer; fileName: string; name: string; clientName?: string; uploadedBy: string; primary?: string; overrides?: FieldOverride[] }

export async function createProjectFromWorkbook(input: CreateProjectInput) {
  const projectId = `prj_${nanoid(10)}`;
  const uploadId = `upl_${nanoid(10)}`;
  const res = await ingestNew(input.buffer, input.fileName, uploadId);
  const sheet = res.workbook.sheets[res.workbook.primary];
  if (input.overrides?.length) {
    const fields = res.schema.fields.map((f) => { const o = input.overrides!.find((x) => x.id === f.id); return o ? { ...f, ...(o.label ? { label: o.label } : {}), ...(o.role ? { role: o.role } : {}), ...(o.hidden !== undefined ? { hidden: o.hidden } : {}) } : f; });
    res.schema = { ...res.schema, fields };
    if (res.template !== "agthia") res.layout = proposeLayout(res.schema);
    res.snapshot = buildSnapshot(res.schema, sheet, { uploadId, version: 1 });
  }
  const base = slugify(input.name).replace(/_/g, "-") || "project";
  let slug = base;
  for (let i = 2; ; i++) {
    const clash = await db().select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.slug, slug)).limit(1);
    if (!clash[0]) break;
    slug = `${base}-${i}`;
  }
  const theme: Theme = { name: input.name, clientName: input.clientName, primary: input.primary ?? "#4d8dff", mode: "dark", logoUrl: null, monogram: input.name.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase() };
  const shareToken = createHash("sha256").update(projectId + nanoid()).digest("base64url").slice(0, 22);
  const stored = await storeFile(input.buffer, projectId, uploadId, input.fileName);
  const snapshot = { ...res.snapshot, schemaHash: schemaHash(res.schema) };
  await db().insert(schema.projects).values({
    id: projectId, slug, name: input.name, clientName: input.clientName ?? null,
    description: res.template === "agthia" ? `Freight quotation pipeline for the ${input.clientName ?? input.name} account.` : `Dashboard generated from ${input.fileName}.`,
    theme, schemaMap: res.schema, layout: res.layout!, settings: { template: res.template }, currentUploadId: null, shareToken, shareEnabled: true,
  });
  await db().insert(schema.uploads).values({
    id: uploadId, projectId, versionNo: 1, fileName: input.fileName, fileSize: input.buffer.length, fileSha256: res.sha256,
    storageKind: stored.kind, storageRef: stored.ref, fileBytes: stored.bytes, uploadedBy: input.uploadedBy, sheetName: sheet.name,
    rowCount: snapshot.n, excludedCount: snapshot.excluded.length, headers: sheet.headers, schemaSnapshot: res.schema, snapshot, status: "ready",
  });
  const rows = sheet.rows.map((r) => ({ uploadId, rowNo: r.row, cells: r.cells }));
  for (let i = 0; i < rows.length; i += 500) await db().insert(schema.uploadRows).values(rows.slice(i, i + 500));
  await db().update(schema.projects).set({ currentUploadId: uploadId, updatedAt: new Date() }).where(eq(schema.projects.id, projectId));
  return { projectId, slug, uploadId, template: res.template, rows: snapshot.n, excluded: snapshot.excluded.length, fields: res.schema.fields.length, pages: res.layout?.pages.length ?? 0 };
}

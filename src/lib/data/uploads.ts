import { nanoid } from "nanoid";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { parseWorkbook } from "@/lib/excel/parse";
import { diffSchema, inferField, buildValueMap, type SchemaDiff } from "@/lib/schema/infer";
import { buildSnapshot } from "@/lib/schema/normalize";
import type { Field, ParsedSheet, SchemaMap } from "@/lib/schema/types";
import { storeFile } from "@/lib/storage/files";
import { sha256 } from "@/lib/ingest";
import { getProjectById, rebuildSnapshot, schemaHash, toUploadSummary, type ProjectSummary } from "./projects";
import { augmentLayoutForNewMeasures } from "@/lib/dashboard/augment";

/** How the user decided to treat each header the schema did not recognise. */
export type HeaderMapping = Record<string, "new" | "ignore" | string>;

export interface DiffPayload {
  matched: { fieldId: string; label: string; header: string; how: SchemaDiff["matched"][number]["how"] }[];
  missing: { fieldId: string; label: string; source: string }[];
  added: { header: string; samples: string[]; suggestedType: string }[];
  sheet: string;
  rows: number;
  needsConfirmation: boolean;
}

export function describeDiff(diff: SchemaDiff, sheet: ParsedSheet): DiffPayload {
  const statsByHeader = new Map(sheet.stats.map((s) => [s.header, s]));
  const added = diff.added.map((h) => {
    const st = statsByHeader.get(h);
    const f = st ? inferField(st, sheet.rows.length, new Set()) : null;
    return { header: h, samples: st?.samples.slice(0, 4) ?? [], suggestedType: f ? `${f.type} · ${f.role}` : "unknown" };
  });
  const needsConfirmation = diff.missing.some((f) => !f.optional) || diff.added.length > 0 || diff.matched.some((m) => m.how === "fuzzy");
  return {
    matched: diff.matched.map((m) => ({ fieldId: m.field.id, label: m.field.label, header: m.header, how: m.how })),
    missing: diff.missing.map((f) => ({ fieldId: f.id, label: f.label, source: f.source ?? "" })),
    added, sheet: sheet.name, rows: sheet.rows.length, needsConfirmation,
  };
}

/** Applies confirmed decisions to a schema map: aliases for renamed headers, new fields for new headers. */
export function applyMapping(schemaMap: SchemaMap, diff: SchemaDiff, sheet: ParsedSheet, mapping: HeaderMapping): SchemaMap {
  const fields: Field[] = schemaMap.fields.map((f) => ({ ...f }));
  const byId = new Map(fields.map((f) => [f.id, f]));
  for (const m of diff.matched) {
    if (m.how === "exact") continue;
    const f = byId.get(m.field.id);
    if (!f) continue;
    const aliases = new Set(f.aliases ?? []);
    if (f.source && f.source !== m.header) aliases.add(f.source);
    f.source = m.header;
    aliases.delete(m.header);
    f.aliases = [...aliases];
  }
  for (const m of diff.missing) { const f = byId.get(m.id); if (f) f.optional = true; }
  const ids = new Set(fields.map((f) => f.id));
  for (const header of diff.added) {
    const decision = mapping[header] ?? "new";
    if (decision === "ignore") continue;
    const st = sheet.stats.find((s) => s.header === header);
    if (!st) continue;
    if (decision === "new") {
      const f = inferField(st, sheet.rows.length, ids);
      if (f.role === "dimension" && f.type === "string") f.valueMap = buildValueMap(sheet.rows.map((r) => r.cells[header]), f.allowedValues);
      fields.push(f);
    } else {
      const target = byId.get(decision);
      if (target) {
        const aliases = new Set(target.aliases ?? []);
        if (target.source) aliases.add(target.source);
        aliases.delete(header);
        target.source = header;
        target.aliases = [...aliases];
        target.optional = false;
      }
    }
  }
  return { ...schemaMap, version: schemaMap.version + 1, fields };
}

export interface AddUploadInput { project: ProjectSummary; buffer: Buffer; fileName: string; uploadedBy: string; mapping?: HeaderMapping; confirm: boolean }

export type AddUploadResult =
  | { status: "needs-confirmation"; diff: DiffPayload }
  | { status: "created"; uploadId: string; versionNo: number; rows: number; excluded: number; schemaChanged: boolean; diff: DiffPayload };

export async function addUpload(input: AddUploadInput): Promise<AddUploadResult> {
  const { project } = input;
  const workbook = await parseWorkbook(input.buffer, input.fileName);
  const sheetIndex = project.schemaMap.sheet ? workbook.sheets.findIndex((s) => s.name === project.schemaMap.sheet) : -1;
  const sheet = workbook.sheets[sheetIndex === -1 ? workbook.primary : sheetIndex];
  const diff = diffSchema(project.schemaMap, sheet);
  const payload = describeDiff(diff, sheet);
  if (payload.needsConfirmation && !input.confirm) return { status: "needs-confirmation", diff: payload };

  const schemaMap = payload.needsConfirmation ? applyMapping(project.schemaMap, diff, sheet, input.mapping ?? {}) : project.schemaMap;
  const schemaChanged = JSON.stringify(schemaMap) !== JSON.stringify(project.schemaMap);
  const before = new Set(project.schemaMap.fields.map((f) => f.id));
  const addedFields = schemaMap.fields.filter((f) => !before.has(f.id));
  const layout = augmentLayoutForNewMeasures(project.layout, schemaMap, addedFields);
  const layoutChanged = layout !== project.layout;
  const last = await db().select({ v: schema.uploads.versionNo }).from(schema.uploads).where(eq(schema.uploads.projectId, project.id)).orderBy(desc(schema.uploads.versionNo)).limit(1);
  const versionNo = (last[0]?.v ?? 0) + 1;
  const uploadId = `upl_${nanoid(10)}`;
  const snapshot = { ...buildSnapshot(schemaMap, sheet, { uploadId, version: versionNo }), schemaHash: schemaHash(schemaMap) };
  const stored = await storeFile(input.buffer, project.id, uploadId, input.fileName);
  await db().insert(schema.uploads).values({
    id: uploadId, projectId: project.id, versionNo, fileName: input.fileName, fileSize: input.buffer.length, fileSha256: sha256(input.buffer),
    storageKind: stored.kind, storageRef: stored.ref, fileBytes: stored.bytes, uploadedBy: input.uploadedBy, sheetName: sheet.name,
    rowCount: snapshot.n, excludedCount: snapshot.excluded.length, headers: sheet.headers, schemaSnapshot: schemaMap, snapshot, status: "ready",
  });
  const rows = sheet.rows.map((r) => ({ uploadId, rowNo: r.row, cells: r.cells }));
  for (let i = 0; i < rows.length; i += 500) await db().insert(schema.uploadRows).values(rows.slice(i, i + 500));
  await db().update(schema.projects).set({ currentUploadId: uploadId, updatedAt: new Date(), ...(schemaChanged ? { schemaMap } : {}), ...(layoutChanged ? { layout } : {}) }).where(eq(schema.projects.id, project.id));
  return { status: "created", uploadId, versionNo, rows: snapshot.n, excluded: snapshot.excluded.length, schemaChanged, diff: payload };
}

/** Roll back (or forward) to a stored version. */
export async function activateUpload(projectId: string, uploadId: string) {
  const rows = await db().select().from(schema.uploads).where(and(eq(schema.uploads.id, uploadId), eq(schema.uploads.projectId, projectId))).limit(1);
  const u = rows[0];
  if (!u) return null;
  await db().update(schema.projects).set({ currentUploadId: u.id, updatedAt: new Date() }).where(eq(schema.projects.id, projectId));
  const project = await getProjectById(projectId);
  if (project) {
    const stored = u.snapshot as ({ schemaHash?: string } | null);
    if (!stored || stored.schemaHash !== schemaHash(project.schemaMap)) await rebuildSnapshot(u, project.schemaMap);
  }
  return toUploadSummary(u);
}

export async function getUploadFile(projectId: string, uploadId: string): Promise<{ fileName: string; bytes: Buffer | null; url: string | null } | null> {
  const rows = await db().select().from(schema.uploads).where(and(eq(schema.uploads.id, uploadId), eq(schema.uploads.projectId, projectId))).limit(1);
  const u = rows[0];
  if (!u) return null;
  return { fileName: u.fileName, bytes: u.fileBytes ?? null, url: u.storageRef };
}

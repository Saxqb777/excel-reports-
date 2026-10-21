import { nanoid } from "nanoid";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { auxSheetsFor, pickSheet, readWorkbook } from "@/lib/ingest";
import { diffSchema, inferField, buildValueMap, type SchemaDiff } from "@/lib/schema/infer";
import { buildSnapshot } from "@/lib/schema/normalize";
import type { Field, ParsedSheet, RawCell, RawRow, SchemaMap } from "@/lib/schema/types";
import { storeFile, type StoredFile } from "@/lib/storage/files";
import { sha256 } from "@/lib/ingest";
import { getProjectById, rebuildSnapshot, schemaHash, toUploadSummary, type ProjectSummary } from "./projects";
import { augmentLayoutForNewMeasures } from "@/lib/dashboard/augment";
import { cadenceOf, monthLabelOf, nextMonthLabel, type Cadence } from "@/lib/dashboard/cadence";
export { cadenceOf, type Cadence };

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

export interface AddUploadInput { project: ProjectSummary; buffer: Buffer; fileName: string; uploadedBy: string; mapping?: HeaderMapping; confirm: boolean; /** Already stored (a large file the browser put into Blob itself). */ stored?: StoredFile }

/** What a monthly upload did: the months it brought, which of those replaced existing rows, and the month the dashboard was expecting. */
export interface MonthMerge { months: string[]; added: string[]; replaced: string[]; kept: string[]; expected: string | null; rows: number; previousRows: number }

export type AddUploadResult =
  | { status: "needs-confirmation"; diff: DiffPayload }
  | { status: "confirm-month"; months: MonthMerge }
  | { status: "created"; uploadId: string; versionNo: number; rows: number; excluded: number; schemaChanged: boolean; diff: DiffPayload; months?: MonthMerge };

const monthKey = (cells: Record<string, RawCell>, header: string): number | null => { const v = cells[header]; const t = typeof v === "string" ? Date.parse(v) : typeof v === "number" ? v : NaN; return Number.isNaN(t) ? null : Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), 1); };
const monthName = monthLabelOf;

/** Rows kept from the current version plus the incoming months, in month order; incoming months replace their existing rows. */
export function mergeByMonth(current: RawRow[], incoming: RawRow[], cadence: Cadence): { rows: RawRow[]; info: MonthMerge } {
  const incomingMonths = new Set(incoming.map((r) => monthKey(r.cells, cadence.dateHeader)).filter((k): k is number => k !== null));
  const kept = current.filter((r) => { const k = monthKey(r.cells, cadence.dateHeader); return k === null ? false : !incomingMonths.has(k); });
  const existingMonths = new Set(current.map((r) => monthKey(r.cells, cadence.dateHeader)).filter((k): k is number => k !== null));
  const latest = existingMonths.size ? Math.max(...existingMonths) : null;
  const sorted = [...kept, ...incoming].sort((a, b) => (monthKey(a.cells, cadence.dateHeader) ?? 0) - (monthKey(b.cells, cadence.dateHeader) ?? 0) || a.row - b.row);
  const rows = sorted.map((r, i) => ({ row: i + 2, cells: r.cells }));
  const months = [...incomingMonths].sort((a, b) => a - b).map(monthName);
  return {
    rows,
    info: {
      months, added: [...incomingMonths].filter((k) => !existingMonths.has(k)).sort((a, b) => a - b).map(monthName), replaced: [...incomingMonths].filter((k) => existingMonths.has(k)).sort((a, b) => a - b).map(monthName),
      kept: [...existingMonths].filter((k) => !incomingMonths.has(k)).sort((a, b) => a - b).map(monthName), expected: nextMonthLabel(latest), rows: rows.length, previousRows: current.length,
    },
  };
}

async function currentRows(project: ProjectSummary): Promise<RawRow[]> {
  if (!project.currentUploadId) return [];
  const raw = await db().select().from(schema.uploadRows).where(eq(schema.uploadRows.uploadId, project.currentUploadId)).orderBy(schema.uploadRows.rowNo);
  return raw.map((r) => ({ row: r.rowNo, cells: r.cells }));
}

export async function addUpload(input: AddUploadInput): Promise<AddUploadResult> {
  const { project } = input;
  const workbook = await readWorkbook(input.buffer, input.fileName);
  let sheet = pickSheet(project.schemaMap, workbook);
  // Monthly projects: the file must be the log the template prepares; its months are merged into the rows already there.
  const cadence = cadenceOf(project.settings);
  let months: MonthMerge | undefined;
  if (cadence) {
    if (sheet.name !== project.schemaMap.sheet) throw new Error(`This file does not look like the ${project.schemaMap.sheet?.toLowerCase() ?? "data"} sheet (expected the same columns as the sheet the dashboard was built from).`);
    const merged = mergeByMonth(await currentRows(project), sheet.rows, cadence);
    months = merged.info;
    if (months.months.length === 0) throw new Error("No month could be read from the file: every row needs a month.");
    if (months.expected && !months.months.includes(months.expected) && !input.confirm) return { status: "confirm-month", months };
    sheet = { ...sheet, rows: merged.rows, totalRowsInSheet: merged.rows.length + 1 };
  }
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
  const stored = input.stored ?? await storeFile(input.buffer, project.id, uploadId, input.fileName);
  await db().insert(schema.uploads).values({
    id: uploadId, projectId: project.id, versionNo, fileName: input.fileName, fileSize: input.buffer.length, fileSha256: sha256(input.buffer),
    storageKind: stored.kind, storageRef: stored.ref, fileBytes: stored.bytes, uploadedBy: input.uploadedBy, sheetName: sheet.name,
    rowCount: snapshot.n, excludedCount: snapshot.excluded.length, headers: sheet.headers, schemaSnapshot: schemaMap, snapshot, status: "ready",
    sheets: auxSheetsFor(typeof project.settings.template === "string" ? project.settings.template : undefined, workbook, schemaMap),
  });
  const rows = sheet.rows.map((r) => ({ uploadId, rowNo: r.row, cells: r.cells }));
  for (let i = 0; i < rows.length; i += 500) await db().insert(schema.uploadRows).values(rows.slice(i, i + 500));
  await db().update(schema.projects).set({ currentUploadId: uploadId, updatedAt: new Date(), ...(schemaChanged ? { schemaMap } : {}), ...(layoutChanged ? { layout } : {}) }).where(eq(schema.projects.id, project.id));
  return { status: "created", uploadId, versionNo, rows: snapshot.n, excluded: snapshot.excluded.length, schemaChanged, diff: payload, ...(months ? { months } : {}) };
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

export async function getUploadFile(projectId: string, uploadId: string): Promise<{ fileName: string; bytes: Buffer | null; url: string | null; kind: string } | null> {
  const rows = await db().select().from(schema.uploads).where(and(eq(schema.uploads.id, uploadId), eq(schema.uploads.projectId, projectId))).limit(1);
  const u = rows[0];
  if (!u) return null;
  return { fileName: u.fileName, bytes: u.fileBytes ?? null, url: u.storageRef, kind: u.storageKind };
}

/** Deletes a stored version. If it was live, the newest remaining version becomes live. */
export async function deleteUpload(projectId: string, uploadId: string): Promise<{ ok: boolean; reason?: string; currentUploadId: string | null }> {
  const all = await db().select({ id: schema.uploads.id, versionNo: schema.uploads.versionNo }).from(schema.uploads).where(eq(schema.uploads.projectId, projectId)).orderBy(desc(schema.uploads.versionNo));
  if (!all.some((u) => u.id === uploadId)) return { ok: false, reason: "Version not found", currentUploadId: null };
  if (all.length === 1) return { ok: false, reason: "This is the only version. Delete the project instead.", currentUploadId: uploadId };
  const project = await getProjectById(projectId);
  await db().delete(schema.uploads).where(and(eq(schema.uploads.id, uploadId), eq(schema.uploads.projectId, projectId)));
  let current = project?.currentUploadId ?? null;
  if (current === uploadId) {
    const next = all.find((u) => u.id !== uploadId)!;
    await db().update(schema.projects).set({ currentUploadId: next.id, updatedAt: new Date() }).where(eq(schema.projects.id, projectId));
    current = next.id;
  }
  return { ok: true, currentUploadId: current };
}

import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { parseWorkbook } from "@/lib/excel/parse";
import { diffSchema, inferSchema } from "@/lib/schema/infer";
import { buildSnapshot } from "@/lib/schema/normalize";
import type { ParsedWorkbook, SchemaMap, Snapshot } from "@/lib/schema/types";
import { AGTHIA_LAYOUT, agthiaSchema, matchesAgthia } from "@/lib/templates/agthia";
import { proposeLayout } from "@/lib/dashboard/propose";
import type { Layout } from "@/lib/dashboard/types";

export interface IngestResult {
  workbook: ParsedWorkbook;
  schema: SchemaMap;
  layout: Layout | null;
  snapshot: Snapshot;
  sha256: string;
  template: "agthia" | "generic";
}

/** First upload for a project: infer schema, apply a curated template when the sheet matches, propose a layout. */
export async function ingestNew(buffer: Buffer, fileName: string, uploadId = nanoid(12)): Promise<IngestResult> {
  const workbook = await parseWorkbook(buffer, fileName);
  const sheet = workbook.sheets[workbook.primary];
  const inferred = inferSchema(sheet);
  const isAgthia = matchesAgthia(sheet.headers);
  const schema = isAgthia ? agthiaSchema(inferred) : inferred;
  const layout = isAgthia ? AGTHIA_LAYOUT : proposeLayout(schema);
  const snapshot = buildSnapshot(schema, sheet, { uploadId, version: 1 });
  return { workbook, schema, layout, snapshot, sha256: sha256(buffer), template: isAgthia ? "agthia" : "generic" };
}

/** Re-upload against a known schema. Returns the diff so the caller can ask for confirmation when headers changed. */
export async function ingestExisting(buffer: Buffer, fileName: string, schema: SchemaMap, version: number, uploadId = nanoid(12)) {
  const workbook = await parseWorkbook(buffer, fileName);
  const sheetIndex = schema.sheet ? Math.max(0, workbook.sheets.findIndex((s) => s.name === schema.sheet)) : workbook.primary;
  const sheet = workbook.sheets[sheetIndex === -1 ? workbook.primary : sheetIndex];
  const diff = diffSchema(schema, sheet);
  const snapshot = buildSnapshot(schema, sheet, { uploadId, version });
  return { workbook, sheet, diff, snapshot, sha256: sha256(buffer) };
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { parseWorkbook } from "@/lib/excel/parse";
import { diffSchema, inferSchema } from "@/lib/schema/infer";
import { buildSnapshot } from "@/lib/schema/normalize";
import type { AuxSheet, ParsedWorkbook, SchemaMap, Snapshot } from "@/lib/schema/types";
import { agthiaLayout, agthiaSchema, matchesAgthia } from "@/lib/templates/agthia";
import { matchesShipments, shipmentsLayout, shipmentsSchema } from "@/lib/templates/shipments";
import { containersAux, containersLayout, containersSchema, matchesContainers } from "@/lib/templates/containers";
import { matchesSavings, prepareSavingsWorkbook, savingsAux, savingsLayout, savingsSchema } from "@/lib/templates/savings";
import { exitCertAux, exitCertLayout, exitCertSchema, matchesExitCert } from "@/lib/templates/exitcert";
import { freightAux, freightLayout, freightSchema, matchesFreight } from "@/lib/templates/freight";
import { proposeLayout } from "@/lib/dashboard/propose";
import type { Layout } from "@/lib/dashboard/types";

export interface IngestResult {
  workbook: ParsedWorkbook;
  schema: SchemaMap;
  layout: Layout | null;
  snapshot: Snapshot;
  sha256: string;
  template: "agthia" | "shipments" | "containers" | "savings" | "exitcert" | "freight" | "generic";
  /** Secondary sheets the template knows how to read (empty for generic sheets). */
  aux: Record<string, AuxSheet>;
}

/** Secondary sheets a template keeps alongside the main table. */
export function auxSheetsFor(template: string | undefined, workbook: ParsedWorkbook): Record<string, AuxSheet> {
  if (template === "containers") return containersAux(workbook);
  if (template === "savings") return savingsAux(workbook);
  if (template === "exitcert") return exitCertAux(workbook);
  if (template === "freight") return freightAux(workbook);
  return {};
}

/**
 * Parses a workbook and lets templates reshape it before the pipeline sees it: a savings report spread over one sheet
 * per stream becomes one merged sheet. Every path that reads an uploaded file goes through here.
 */
export async function readWorkbook(buffer: Buffer, fileName: string): Promise<ParsedWorkbook> {
  return prepareSavingsWorkbook(await parseWorkbook(buffer, fileName));
}

/** First upload for a project: infer schema, apply a curated template when the sheet matches, propose a layout. */
export async function ingestNew(buffer: Buffer, fileName: string, uploadId = nanoid(12)): Promise<IngestResult> {
  const workbook = await readWorkbook(buffer, fileName);
  const sheet = workbook.sheets[workbook.primary];
  const inferred = inferSchema(sheet);
  const template: IngestResult["template"] = matchesSavings(sheet.headers) ? "savings" : matchesExitCert(sheet.headers) ? "exitcert" : matchesFreight(sheet.headers) ? "freight" : matchesAgthia(sheet.headers) ? "agthia" : matchesShipments(sheet.headers) ? "shipments" : matchesContainers(sheet.headers) ? "containers" : "generic";
  const schema = template === "savings" ? savingsSchema(inferred, sheet) : template === "exitcert" ? exitCertSchema(inferred) : template === "freight" ? freightSchema(inferred) : template === "agthia" ? agthiaSchema(inferred) : template === "shipments" ? shipmentsSchema(inferred) : template === "containers" ? containersSchema(inferred) : inferred;
  const layout = template === "savings" ? savingsLayout() : template === "exitcert" ? exitCertLayout(schema) : template === "freight" ? freightLayout(schema) : template === "agthia" ? agthiaLayout(schema) : template === "shipments" ? shipmentsLayout(schema) : template === "containers" ? containersLayout(schema) : proposeLayout(schema);
  const snapshot = buildSnapshot(schema, sheet, { uploadId, version: 1 });
  return { workbook, schema, layout, snapshot, sha256: sha256(buffer), template, aux: auxSheetsFor(template, workbook) };
}

/** Re-upload against a known schema. Returns the diff so the caller can ask for confirmation when headers changed. */
export async function ingestExisting(buffer: Buffer, fileName: string, schema: SchemaMap, version: number, uploadId = nanoid(12)) {
  const workbook = await readWorkbook(buffer, fileName);
  const sheetIndex = schema.sheet ? Math.max(0, workbook.sheets.findIndex((s) => s.name === schema.sheet)) : workbook.primary;
  const sheet = workbook.sheets[sheetIndex === -1 ? workbook.primary : sheetIndex];
  const diff = diffSchema(schema, sheet);
  const snapshot = buildSnapshot(schema, sheet, { uploadId, version });
  return { workbook, sheet, diff, snapshot, sha256: sha256(buffer) };
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

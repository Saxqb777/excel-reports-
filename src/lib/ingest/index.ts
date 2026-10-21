import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { parseWorkbook } from "@/lib/excel/parse";
import { diffSchema, inferSchema } from "@/lib/schema/infer";
import { buildSnapshot } from "@/lib/schema/normalize";
import type { AuxSheet, ParsedSheet, ParsedWorkbook, SchemaMap, Snapshot } from "@/lib/schema/types";
import { agthiaLayout, agthiaSchema, matchesAgthia } from "@/lib/templates/agthia";
import { matchesShipments, shipmentsLayout, shipmentsSchema } from "@/lib/templates/shipments";
import { containersAux, containersLayout, containersSchema, matchesContainers } from "@/lib/templates/containers";
import { matchesSavings, prepareSavingsWorkbook, savingsAux, savingsLayout, savingsSchema } from "@/lib/templates/savings";
import { exitCertAux, exitCertLayout, exitCertSchema, matchesExitCert } from "@/lib/templates/exitcert";
import { freightAux, freightLayout, freightSchema, matchesFreight } from "@/lib/templates/freight";
import { matchesSrn, prepareSrnWorkbook, srnAux, srnLayout, srnSchema } from "@/lib/templates/srn";
import { matchesQuotes, prepareQuotesWorkbook, quotesAux, quotesLayout, quotesSchema } from "@/lib/templates/quotes";
import { proposeLayout } from "@/lib/dashboard/propose";
import type { Layout } from "@/lib/dashboard/types";

export interface IngestResult {
  workbook: ParsedWorkbook;
  schema: SchemaMap;
  layout: Layout | null;
  snapshot: Snapshot;
  sha256: string;
  template: "agthia" | "shipments" | "containers" | "savings" | "exitcert" | "freight" | "srn" | "quotes" | "generic";
  /** Secondary sheets the template knows how to read (empty for generic sheets). */
  aux: Record<string, AuxSheet>;
}

/** Secondary sheets a template keeps alongside the main table. */
export function auxSheetsFor(template: string | undefined, workbook: ParsedWorkbook, schema?: SchemaMap): Record<string, AuxSheet> {
  if (template === "containers") return containersAux(workbook);
  if (template === "savings") return savingsAux(workbook);
  if (template === "exitcert") return exitCertAux(workbook);
  if (template === "freight") return freightAux(workbook);
  if (template === "srn") return srnAux(workbook, schema);
  if (template === "quotes") return quotesAux(workbook);
  return {};
}

/**
 * Parses a workbook and lets templates reshape it before the pipeline sees it: a savings report spread over one sheet
 * per stream becomes one merged sheet, a hand-typed SRN log becomes one clean line per SRN, and a freight quote log
 * becomes one tidy row per request. Every path that reads an uploaded file goes through here.
 */
export async function readWorkbook(buffer: Buffer, fileName: string): Promise<ParsedWorkbook> {
  return prepareQuotesWorkbook(prepareSrnWorkbook(prepareSavingsWorkbook(await parseWorkbook(buffer, fileName))));
}

/** First upload for a project: infer schema, apply a curated template when the sheet matches, propose a layout. */
export async function ingestNew(buffer: Buffer, fileName: string, uploadId = nanoid(12)): Promise<IngestResult> {
  const workbook = await readWorkbook(buffer, fileName);
  const sheet = workbook.sheets[workbook.primary];
  const inferred = inferSchema(sheet);
  const template: IngestResult["template"] = matchesQuotes(sheet.headers) ? "quotes" : matchesSavings(sheet.headers) ? "savings" : matchesSrn(sheet.headers) ? "srn" : matchesExitCert(sheet.headers) ? "exitcert" : matchesFreight(sheet.headers) ? "freight" : matchesAgthia(sheet.headers) ? "agthia" : matchesShipments(sheet.headers) ? "shipments" : matchesContainers(sheet.headers) ? "containers" : "generic";
  const schema = template === "quotes" ? quotesSchema() : template === "savings" ? savingsSchema(inferred, sheet) : template === "srn" ? srnSchema(inferred) : template === "exitcert" ? exitCertSchema(inferred) : template === "freight" ? freightSchema(inferred) : template === "agthia" ? agthiaSchema(inferred) : template === "shipments" ? shipmentsSchema(inferred) : template === "containers" ? containersSchema(inferred) : inferred;
  const layout = template === "quotes" ? quotesLayout() : template === "savings" ? savingsLayout() : template === "srn" ? srnLayout() : template === "exitcert" ? exitCertLayout(schema) : template === "freight" ? freightLayout(schema) : template === "agthia" ? agthiaLayout(schema) : template === "shipments" ? shipmentsLayout(schema) : template === "containers" ? containersLayout(schema) : proposeLayout(schema);
  const snapshot = buildSnapshot(schema, sheet, { uploadId, version: 1 });
  return { workbook, schema, layout, snapshot, sha256: sha256(buffer), template, aux: auxSheetsFor(template, workbook, schema) };
}

/** Re-upload against a known schema. Returns the diff so the caller can ask for confirmation when headers changed. */
export async function ingestExisting(buffer: Buffer, fileName: string, schema: SchemaMap, version: number, uploadId = nanoid(12)) {
  const workbook = await readWorkbook(buffer, fileName);
  const sheet = pickSheet(schema, workbook);
  const diff = diffSchema(schema, sheet);
  const snapshot = buildSnapshot(schema, sheet, { uploadId, version });
  return { workbook, sheet, diff, snapshot, sha256: sha256(buffer) };
}

/**
 * The sheet a new version is read from: the one the project was built on, by name; when the workbook names it
 * differently, the sheet whose headers match most of the project's columns (the main sheet wins ties).
 */
export function pickSheet(schema: SchemaMap, workbook: ParsedWorkbook): ParsedSheet {
  const named = schema.sheet ? workbook.sheets.find((s) => s.name === schema.sheet) : undefined;
  if (named) return named;
  let best = workbook.sheets[workbook.primary], score = diffSchema(schema, best).matched.length;
  for (const s of workbook.sheets) {
    const k = diffSchema(schema, s).matched.length;
    if (k > score) { best = s; score = k; }
  }
  return best;
}

export function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

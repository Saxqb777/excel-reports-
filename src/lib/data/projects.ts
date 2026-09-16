import { createHash } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { db, hasDatabase, schema } from "@/lib/db/client";
import type { ProjectRow, UploadRow } from "@/lib/db/schema";
import type { Layout, Theme } from "@/lib/dashboard/types";
import type { ParsedSheet, SchemaMap, Snapshot } from "@/lib/schema/types";
import { buildSnapshot } from "@/lib/schema/normalize";

export interface ProjectSummary {
  id: string;
  slug: string;
  name: string;
  clientName: string | null;
  description: string | null;
  theme: Theme;
  layout: Layout;
  schemaMap: SchemaMap;
  settings: Record<string, unknown>;
  shareToken: string;
  shareEnabled: boolean;
  hasSharePassword: boolean;
  currentUploadId: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface UploadSummary {
  id: string;
  versionNo: number;
  fileName: string;
  fileSize: number;
  uploadedBy: string;
  uploadedAt: string;
  rowCount: number;
  excludedCount: number;
  status: string;
  sheetName: string | null;
  headers: string[];
}

export function schemaHash(s: SchemaMap): string {
  return createHash("sha1").update(JSON.stringify(s)).digest("hex").slice(0, 12);
}

function toSummary(p: ProjectRow): ProjectSummary {
  return {
    id: p.id, slug: p.slug, name: p.name, clientName: p.clientName, description: p.description,
    theme: p.theme, layout: p.layout, schemaMap: p.schemaMap, settings: p.settings,
    shareToken: p.shareToken, shareEnabled: p.shareEnabled, hasSharePassword: Boolean(p.sharePasswordHash),
    currentUploadId: p.currentUploadId, updatedAt: p.updatedAt.toISOString(), createdAt: p.createdAt.toISOString(),
  };
}

export function toUploadSummary(u: UploadRow): UploadSummary {
  return {
    id: u.id, versionNo: u.versionNo, fileName: u.fileName, fileSize: u.fileSize, uploadedBy: u.uploadedBy,
    uploadedAt: u.uploadedAt.toISOString(), rowCount: u.rowCount, excludedCount: u.excludedCount, status: u.status,
    sheetName: u.sheetName, headers: u.headers,
  };
}

// ---------- Fixture mode (local development without a database) ----------

const FIXTURE_DIR = process.env.MERIDIAN_FIXTURE_DIR ? path.resolve(process.env.MERIDIAN_FIXTURE_DIR) : null;

function fixtureMode(): boolean {
  return !hasDatabase() && FIXTURE_DIR !== null && existsSync(FIXTURE_DIR);
}

interface Fixture { project: ProjectSummary; upload: UploadSummary; snapshot: Snapshot; previousUpload?: UploadSummary; previousSnapshot?: Snapshot }

function readFixtures(): Fixture[] {
  if (!FIXTURE_DIR) return [];
  return readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(path.join(FIXTURE_DIR, f), "utf8")) as Fixture);
}

/** Fixture mode only: the version before the current one, so insights and change markers can be checked locally. */
export function getFixturePreviousSnapshot(projectId: string): Snapshot | null {
  if (!fixtureMode()) return null;
  return readFixtures().find((f) => f.project.id === projectId)?.previousSnapshot ?? null;
}

// ---------- Queries ----------

export async function listProjects(): Promise<(ProjectSummary & { upload: UploadSummary | null })[]> {
  if (fixtureMode()) return readFixtures().map((f) => ({ ...f.project, upload: f.upload }));
  if (!hasDatabase()) return [];
  const rows = await db().select().from(schema.projects).orderBy(desc(schema.projects.updatedAt));
  const out = [] as (ProjectSummary & { upload: UploadSummary | null })[];
  for (const p of rows) {
    let upload: UploadSummary | null = null;
    if (p.currentUploadId) {
      const u = await db().select().from(schema.uploads).where(eq(schema.uploads.id, p.currentUploadId)).limit(1);
      if (u[0]) upload = toUploadSummary(u[0]);
    }
    out.push({ ...toSummary(p), upload });
  }
  return out;
}

/**
 * Looks a project up by its slug. A slug that was renamed still resolves through `settings.previousSlugs`,
 * so old bookmarks keep working; pages compare `project.slug` with the requested one and redirect.
 */
export async function getProjectBySlug(slug: string): Promise<ProjectSummary | null> {
  if (fixtureMode()) return readFixtures().find((f) => f.project.slug === slug)?.project ?? null;
  if (!hasDatabase()) return null;
  const rows = await db().select().from(schema.projects).where(eq(schema.projects.slug, slug)).limit(1);
  if (rows[0]) return toSummary(rows[0]);
  const old = await db().select().from(schema.projects).where(sql`${schema.projects.settings} -> 'previousSlugs' @> to_jsonb(${slug}::text)`).limit(1);
  return old[0] ? toSummary(old[0]) : null;
}

export async function getProjectById(id: string): Promise<ProjectSummary | null> {
  if (fixtureMode()) return readFixtures().find((f) => f.project.id === id)?.project ?? null;
  if (!hasDatabase()) return null;
  const rows = await db().select().from(schema.projects).where(eq(schema.projects.id, id)).limit(1);
  return rows[0] ? toSummary(rows[0]) : null;
}

export async function getProjectByShareToken(token: string): Promise<ProjectSummary | null> {
  if (fixtureMode()) return readFixtures().find((f) => f.project.shareToken === token)?.project ?? null;
  if (!hasDatabase()) return null;
  const rows = await db().select().from(schema.projects).where(eq(schema.projects.shareToken, token)).limit(1);
  return rows[0] ? toSummary(rows[0]) : null;
}

export async function getCurrentUpload(project: ProjectSummary): Promise<UploadSummary | null> {
  if (fixtureMode()) return readFixtures().find((f) => f.project.id === project.id)?.upload ?? null;
  if (!project.currentUploadId) return null;
  const rows = await db().select().from(schema.uploads).where(eq(schema.uploads.id, project.currentUploadId)).limit(1);
  return rows[0] ? toUploadSummary(rows[0]) : null;
}

export async function listUploads(projectId: string): Promise<UploadSummary[]> {
  if (fixtureMode()) { const f = readFixtures().find((x) => x.project.id === projectId); return f ? [f.upload, ...(f.previousUpload ? [f.previousUpload] : [])] : []; }
  const rows = await db().select().from(schema.uploads).where(eq(schema.uploads.projectId, projectId)).orderBy(desc(schema.uploads.versionNo));
  return rows.map(toUploadSummary);
}

/**
 * Returns the columnar snapshot for the project's current upload. If the project's schema map changed since the
 * snapshot was built, it is rebuilt from the stored raw rows so mapping edits never require a re-upload.
 */
export async function getSnapshot(project: ProjectSummary): Promise<Snapshot | null> {
  if (fixtureMode()) return readFixtures().find((f) => f.project.id === project.id)?.snapshot ?? null;
  if (!project.currentUploadId) return null;
  const rows = await db().select().from(schema.uploads).where(eq(schema.uploads.id, project.currentUploadId)).limit(1);
  const u = rows[0];
  if (!u) return null;
  const wanted = schemaHash(project.schemaMap);
  const stored = u.snapshot as (Snapshot & { schemaHash?: string }) | null;
  if (stored && stored.schemaHash === wanted) return stored;
  const rebuilt = await rebuildSnapshot(u, project.schemaMap);
  return rebuilt;
}

export async function rebuildSnapshot(u: UploadRow, schemaMap: SchemaMap): Promise<Snapshot> {
  const raw = await db().select().from(schema.uploadRows).where(eq(schema.uploadRows.uploadId, u.id)).orderBy(schema.uploadRows.rowNo);
  const sheet: ParsedSheet = {
    name: u.sheetName ?? "Sheet1", headerRow: 1, headers: u.headers, rows: raw.map((r) => ({ row: r.rowNo, cells: r.cells })),
    stats: [], validations: {}, totalRowsInSheet: raw.length,
  };
  const snap = buildSnapshot(schemaMap, sheet, { uploadId: u.id, version: u.versionNo }) as Snapshot & { schemaHash?: string };
  snap.schemaHash = schemaHash(schemaMap);
  await db().update(schema.uploads).set({ snapshot: snap }).where(eq(schema.uploads.id, u.id));
  return snap;
}

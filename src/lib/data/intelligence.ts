import { and, desc, eq, lt } from "drizzle-orm";
import { db, hasDatabase, schema } from "@/lib/db/client";
import type { Snapshot } from "@/lib/schema/types";
import { getFixturePreviousSnapshot, rebuildSnapshot, schemaHash, type ProjectSummary } from "./projects";
import { computeInsights, topInsights, type Insight } from "@/lib/intelligence/insights";
import { computeAnomalies, kpiValues, type Anomaly, type MetricHistoryPoint } from "@/lib/intelligence/anomalies";

export interface Intelligence {
  insights: Insight[];
  anomalies: Anomaly[];
  comparedTo: number | null;
  previousKpis: Record<string, number | null> | null;
  /** Row ids that appeared in this version, and ids whose tracked fields changed. Drives the "new" and "changed" markers. */
  newIds: string[];
  changedIds: string[];
}

/**
 * Insights compare the current version with the one before it; anomalies compare KPI values with all earlier versions.
 * Results are cached on the upload row and recomputed when the layout or schema changes.
 */
export async function getIntelligence(project: ProjectSummary, snapshot: Snapshot): Promise<Intelligence> {
  const key = `${snapshot.uploadId}:${snapshot.version}:${hashLayout(project)}`;
  if (!hasDatabase()) return compute(project, snapshot, getFixturePreviousSnapshot(project.id), []);
  const cur = await db().select({ insights: schema.uploads.insights, anomalies: schema.uploads.anomalies }).from(schema.uploads).where(eq(schema.uploads.id, snapshot.uploadId)).limit(1);
  const cached = cur[0]?.insights as (Intelligence & { key?: string }) | null | undefined;
  if (cached && cached.key === key) return cached;
  const prevRows = await db().select().from(schema.uploads)
    .where(and(eq(schema.uploads.projectId, project.id), lt(schema.uploads.versionNo, snapshot.version))).orderBy(desc(schema.uploads.versionNo)).limit(24);
  // The version we compare with must be built with the current schema, otherwise a merged or renamed column reads as a change.
  const wanted = schemaHash(project.schemaMap);
  let previous = (prevRows[0]?.snapshot as (Snapshot & { schemaHash?: string }) | null) ?? null;
  if (prevRows[0] && (!previous || previous.schemaHash !== wanted)) previous = await rebuildSnapshot(prevRows[0], project.schemaMap);
  const history: MetricHistoryPoint[] = prevRows.filter((r) => r.snapshot).map((r) => ({ version: r.versionNo, values: kpiValues(r.snapshot as Snapshot, project.layout) }));
  const result = compute(project, snapshot, previous, history);
  await db().update(schema.uploads).set({ insights: { ...result, key }, anomalies: { items: result.anomalies } }).where(eq(schema.uploads.id, snapshot.uploadId));
  return result;
}

function compute(project: ProjectSummary, snapshot: Snapshot, previous: Snapshot | null, history: MetricHistoryPoint[]): Intelligence {
  const all = computeInsights({ current: snapshot, previous, schema: project.schemaMap, layout: project.layout });
  const anomalies = computeAnomalies({ current: snapshot, history: [...history, { version: snapshot.version, values: kpiValues(snapshot, project.layout) }], schema: project.schemaMap, layout: project.layout });
  const anomalyInsights: Insight[] = anomalies.filter((a) => a.scope === "metric").slice(0, 1).map((a) => ({ id: `anom_${a.id}`, kind: "anomaly", headline: `${a.label} is unusual: ${a.detail.split(", against")[0].replace(`${a.label} is `, "")}`, detail: a.detail, tone: a.tone, score: 1.3, filter: a.filter }));
  const { newIds, changedIds } = rowDiff(snapshot, previous, project);
  return { insights: topInsights([...anomalyInsights, ...all], 3), anomalies, comparedTo: previous?.version ?? null, previousKpis: previous ? kpiValues(previous, project.layout) : null, newIds, changedIds };
}

function rowDiff(current: Snapshot, previous: Snapshot | null, project: ProjectSummary): { newIds: string[]; changedIds: string[] } {
  const idField = project.schemaMap.idField;
  if (!previous || !idField) return { newIds: [], changedIds: [] };
  const cur = current.columns[idField] ?? [], prev = previous.columns[idField] ?? [];
  const prevIndex = new Map<string, number>();
  prev.forEach((v, i) => { if (v !== null) prevIndex.set(String(v), i); });
  const watched = current.fields.filter((f) => !f.derived && (f.role === "dimension" || f.role === "date" || f.role === "measure" || f.role === "text") && previous.columns[f.id]);
  const newIds: string[] = [], changedIds: string[] = [];
  cur.forEach((v, i) => {
    if (v === null) return;
    const id = String(v);
    const pi = prevIndex.get(id);
    if (pi === undefined) { newIds.push(id); return; }
    for (const f of watched) if (current.columns[f.id][i] !== previous.columns[f.id][pi]) { changedIds.push(id); break; }
  });
  return { newIds, changedIds };
}

function hashLayout(project: ProjectSummary): string {
  let h = 0;
  const s = JSON.stringify(project.layout) + JSON.stringify(project.schemaMap.fields.map((f) => f.id));
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

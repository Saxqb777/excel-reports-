import { boolean, customType, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { Layout, Theme } from "@/lib/dashboard/types";
import type { SchemaMap, Snapshot } from "@/lib/schema/types";

const bytea = customType<{ data: Buffer; driverData: string }>({
  dataType() { return "bytea"; },
  toDriver(value: Buffer) { return `\\x${value.toString("hex")}`; },
  fromDriver(value: unknown) {
    if (Buffer.isBuffer(value)) return value;
    const s = String(value);
    return Buffer.from(s.startsWith("\\x") ? s.slice(2) : s, "hex");
  },
});

export const projects = pgTable("projects", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  clientName: text("client_name"),
  description: text("description"),
  theme: jsonb("theme").$type<Theme>().notNull(),
  schemaMap: jsonb("schema_map").$type<SchemaMap>().notNull(),
  layout: jsonb("layout").$type<Layout>().notNull(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  currentUploadId: text("current_upload_id"),
  shareToken: text("share_token").notNull(),
  sharePasswordHash: text("share_password_hash"),
  shareEnabled: boolean("share_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("projects_slug_idx").on(t.slug), uniqueIndex("projects_share_token_idx").on(t.shareToken)]);

export const uploads = pgTable("uploads", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  versionNo: integer("version_no").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  fileSha256: text("file_sha256").notNull(),
  storageKind: text("storage_kind").notNull(), // 'blob' | 'pg'
  storageRef: text("storage_ref"),
  fileBytes: bytea("file_bytes"),
  uploadedBy: text("uploaded_by").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  sheetName: text("sheet_name"),
  rowCount: integer("row_count").notNull().default(0),
  excludedCount: integer("excluded_count").notNull().default(0),
  headers: jsonb("headers").$type<string[]>().notNull().default([]),
  schemaSnapshot: jsonb("schema_snapshot").$type<SchemaMap>().notNull(),
  snapshot: jsonb("snapshot").$type<Snapshot>(),
  quality: jsonb("quality").$type<Record<string, unknown>>(),
  insights: jsonb("insights").$type<Record<string, unknown>>(),
  anomalies: jsonb("anomalies").$type<Record<string, unknown>>(),
  status: text("status").notNull().default("ready"), // 'ready' | 'processing' | 'failed'
  error: text("error"),
}, (t) => [index("uploads_project_idx").on(t.projectId, t.versionNo)]);

export const uploadRows = pgTable("upload_rows", {
  uploadId: text("upload_id").notNull().references(() => uploads.id, { onDelete: "cascade" }),
  rowNo: integer("row_no").notNull(),
  cells: jsonb("cells").$type<Record<string, string | number | boolean | null>>().notNull(),
}, (t) => [index("upload_rows_upload_idx").on(t.uploadId, t.rowNo)]);

export type ProjectRow = typeof projects.$inferSelect;
export type UploadRow = typeof uploads.$inferSelect;

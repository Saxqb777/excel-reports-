import type { NextRequest } from "next/server";
import { getProjectById, listUploads } from "@/lib/data/projects";
import { addUpload, type HeaderMapping } from "@/lib/data/uploads";
import { hasDatabase } from "@/lib/db/client";
import { hasUpdateAccess, lockedResponse } from "@/lib/share/auth";
import { incomingPrefix, readBlobBuffer, type StoredFile } from "@/lib/storage/files";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/projects/[id]/uploads">) {
  const { id } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  const uploads = await listUploads(project.id);
  return Response.json({ uploads, currentUploadId: project.currentUploadId });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/uploads">) {
  if (!hasDatabase()) return Response.json({ error: "DATABASE_URL is not configured" }, { status: 500 });
  const { id } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  if (!(await hasUpdateAccess(project.id))) return lockedResponse();
  const form = await req.formData();
  const file = form.get("file");
  // Large workbooks arrive as a reference to a blob the browser uploaded itself (see uploads/blob).
  const blobRef = String(form.get("blob") ?? "");
  let upload: { buffer: Buffer; fileName: string; stored?: StoredFile } | null = null;
  if (blobRef) {
    const pathname = blobRef.startsWith("http") ? decodeURIComponent(new URL(blobRef).pathname.slice(1)) : blobRef;
    if (!pathname.startsWith(incomingPrefix(project.id)) || pathname.includes("..")) return Response.json({ error: "That upload belongs to another project." }, { status: 400 });
    const buffer = await readBlobBuffer(blobRef).catch(() => null);
    if (!buffer) return Response.json({ error: "The uploaded file could not be read back. Try again." }, { status: 422 });
    upload = { buffer, fileName: String(form.get("fileName") ?? "") || pathname.split("/").pop()!, stored: { kind: "blob-private", ref: blobRef, bytes: null } };
  } else if (file instanceof File) {
    upload = { buffer: Buffer.from(await file.arrayBuffer()), fileName: file.name };
  }
  if (!upload) return Response.json({ error: "Attach a workbook as the 'file' field" }, { status: 400 });
  const uploadedBy = String(form.get("uploadedBy") ?? "").trim();
  const confirm = String(form.get("confirm") ?? "") === "1";
  let mapping: HeaderMapping | undefined;
  const rawMapping = form.get("mapping");
  if (typeof rawMapping === "string" && rawMapping) { try { mapping = JSON.parse(rawMapping) as HeaderMapping; } catch { return Response.json({ error: "mapping must be JSON" }, { status: 400 }); } }
  try {
    const result = await addUpload({ project, buffer: upload.buffer, fileName: upload.fileName, uploadedBy, mapping, confirm, stored: upload.stored });
    if (result.status === "needs-confirmation") return Response.json(result, { status: 409 });
    return Response.json(result, { status: 201 });
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 422 });
  }
}

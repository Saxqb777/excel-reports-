import type { NextRequest } from "next/server";
import { getProjectById, listUploads } from "@/lib/data/projects";
import { addUpload, type HeaderMapping } from "@/lib/data/uploads";
import { hasDatabase } from "@/lib/db/client";

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
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Attach a workbook as the 'file' field" }, { status: 400 });
  const uploadedBy = String(form.get("uploadedBy") ?? "").trim();
  const confirm = String(form.get("confirm") ?? "") === "1";
  let mapping: HeaderMapping | undefined;
  const rawMapping = form.get("mapping");
  if (typeof rawMapping === "string" && rawMapping) { try { mapping = JSON.parse(rawMapping) as HeaderMapping; } catch { return Response.json({ error: "mapping must be JSON" }, { status: 400 }); } }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await addUpload({ project, buffer, fileName: file.name, uploadedBy, mapping, confirm });
    if (result.status === "needs-confirmation") return Response.json(result, { status: 409 });
    return Response.json(result, { status: 201 });
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 422 });
  }
}

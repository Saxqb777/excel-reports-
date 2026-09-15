import type { NextRequest } from "next/server";
import { getProjectById } from "@/lib/data/projects";
import { getUploadFile } from "@/lib/data/uploads";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/projects/[id]/uploads/[uploadId]/file">) {
  const { id, uploadId } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  const f = await getUploadFile(project.id, uploadId);
  if (!f) return Response.json({ error: "Version not found" }, { status: 404 });
  if (f.url) return Response.redirect(f.url, 302);
  if (!f.bytes) return Response.json({ error: "The original file was not stored for this version" }, { status: 404 });
  return new Response(new Uint8Array(f.bytes), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${f.fileName.replace(/"/g, "")}"` } });
}

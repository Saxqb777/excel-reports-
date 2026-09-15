import type { NextRequest } from "next/server";
import { getProjectById } from "@/lib/data/projects";
import { deleteUpload } from "@/lib/data/uploads";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/projects/[id]/uploads/[uploadId]">) {
  const { id, uploadId } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  const res = await deleteUpload(project.id, uploadId);
  if (!res.ok) return Response.json({ error: res.reason }, { status: 400 });
  return Response.json(res);
}

import type { NextRequest } from "next/server";
import { getProjectById } from "@/lib/data/projects";
import { activateUpload } from "@/lib/data/uploads";
import { hasUpdateAccess, lockedResponse } from "@/lib/share/auth";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/projects/[id]/uploads/[uploadId]/activate">) {
  const { id, uploadId } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  if (!(await hasUpdateAccess(project.id))) return lockedResponse();
  const upload = await activateUpload(project.id, uploadId);
  if (!upload) return Response.json({ error: "Version not found" }, { status: 404 });
  return Response.json({ upload });
}

import type { NextRequest } from "next/server";
import { getProjectById } from "@/lib/data/projects";
import { unlockUpdates } from "@/lib/share/auth";

export const dynamic = "force-dynamic";

/** Enters the update password; a success sets the cookie that lets this browser change the project's data. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/unlock">) {
  const { id } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  return unlockUpdates(project.id, body.password);
}

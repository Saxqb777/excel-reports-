import type { NextRequest } from "next/server";
import { getProjectById, getSnapshot } from "@/lib/data/projects";
import { getIntelligence } from "@/lib/data/intelligence";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/projects/[id]/intelligence">) {
  const { id } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  const snapshot = await getSnapshot(project);
  if (!snapshot) return Response.json({ error: "No data uploaded yet" }, { status: 404 });
  return Response.json(await getIntelligence(project, snapshot), { headers: { "Cache-Control": "private, no-store" } });
}

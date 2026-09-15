import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getProjectById } from "@/lib/data/projects";
import { proposeLayout } from "@/lib/dashboard/propose";
import { AGTHIA_LAYOUT } from "@/lib/templates/agthia";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/projects/[id]/layout/reset">) {
  const { id } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  const layout = project.settings.template === "agthia" ? AGTHIA_LAYOUT : proposeLayout(project.schemaMap);
  await db().update(schema.projects).set({ layout, updatedAt: new Date() }).where(eq(schema.projects.id, project.id));
  return Response.json({ layout });
}

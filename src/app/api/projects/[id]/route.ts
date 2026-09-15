import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db/client";
import { getProjectById } from "@/lib/data/projects";
import { hashPassword } from "@/lib/share/auth";
import type { Layout, Theme } from "@/lib/dashboard/types";
import type { SchemaMap } from "@/lib/schema/types";

export const dynamic = "force-dynamic";

const PatchZ = z.object({
  name: z.string().min(1).max(120).optional(),
  clientName: z.string().max(120).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  theme: z.object({ primary: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), mode: z.enum(["dark", "light", "system"]).optional(), logoUrl: z.string().nullable().optional(), monogram: z.string().max(3).optional(), name: z.string().optional(), clientName: z.string().optional() }).optional(),
  layout: z.custom<Layout>((v) => typeof v === "object" && v !== null && Array.isArray((v as Layout).pages)).optional(),
  schemaFields: z.array(z.object({ id: z.string(), label: z.string().min(1).max(80).optional(), role: z.enum(["id", "dimension", "measure", "date", "text", "ignore"]).optional(), hidden: z.boolean().optional() })).optional(),
  share: z.object({ enabled: z.boolean().optional(), password: z.string().max(200).nullable().optional() }).optional(),
});

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  return Response.json({ project });
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  const parsed = PatchZ.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;
  const set: Partial<typeof schema.projects.$inferInsert> = { updatedAt: new Date() };
  if (b.name !== undefined) set.name = b.name;
  if (b.clientName !== undefined) set.clientName = b.clientName;
  if (b.description !== undefined) set.description = b.description;
  if (b.theme) set.theme = { ...project.theme, ...b.theme, name: b.name ?? project.theme.name } as Theme;
  if (b.layout) set.layout = b.layout;
  if (b.schemaFields) {
    const fields = project.schemaMap.fields.map((f) => {
      const patch = b.schemaFields!.find((p) => p.id === f.id);
      return patch ? { ...f, ...(patch.label !== undefined ? { label: patch.label } : {}), ...(patch.role !== undefined ? { role: patch.role } : {}), ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}) } : f;
    });
    set.schemaMap = { ...project.schemaMap, version: project.schemaMap.version + 1, fields } as SchemaMap;
  }
  if (b.share) {
    if (b.share.enabled !== undefined) set.shareEnabled = b.share.enabled;
    if (b.share.password !== undefined) set.sharePasswordHash = b.share.password ? hashPassword(b.share.password) : null;
  }
  await db().update(schema.projects).set(set).where(eq(schema.projects.id, project.id));
  const updated = await getProjectById(project.id);
  return Response.json({ project: updated });
}

export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/projects/[id]">) {
  const { id } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { confirm?: string };
  const confirm = body.confirm ?? new URL(req.url).searchParams.get("confirm") ?? "";
  if (confirm !== "yes" && confirm.trim().toLowerCase() !== project.name.trim().toLowerCase()) return Response.json({ error: "Confirm the deletion first." }, { status: 400 });
  await db().delete(schema.projects).where(eq(schema.projects.id, project.id));
  return Response.json({ ok: true });
}

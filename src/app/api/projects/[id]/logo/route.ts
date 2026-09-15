import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import { db, schema } from "@/lib/db/client";
import { getProjectById } from "@/lib/data/projects";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/logo">) {
  const { id } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Attach an image as 'file'" }, { status: 400 });
  if (!/^image\/(png|jpeg|svg\+xml|webp)$/.test(file.type)) return Response.json({ error: "Use a PNG, JPEG, SVG or WebP image." }, { status: 400 });
  if (file.size > 512 * 1024) return Response.json({ error: "Keep the logo under 512 KB." }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  let url: string;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const res = await put(`projects/${project.id}/logo-${Date.now()}.${file.type.split("/")[1].replace("+xml", "")}`, buf, { access: "public", addRandomSuffix: false, contentType: file.type });
    url = res.url;
  } else {
    url = `data:${file.type};base64,${buf.toString("base64")}`;
  }
  await db().update(schema.projects).set({ theme: { ...project.theme, logoUrl: url }, updatedAt: new Date() }).where(eq(schema.projects.id, project.id));
  return Response.json({ logoUrl: url });
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/projects/[id]/logo">) {
  const { id } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  await db().update(schema.projects).set({ theme: { ...project.theme, logoUrl: null }, updatedAt: new Date() }).where(eq(schema.projects.id, project.id));
  return Response.json({ ok: true });
}

import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { getProjectByShareToken } from "@/lib/data/projects";
import { shareCookieName, shareSecret, signShare, verifyPassword } from "@/lib/share/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/share/[token]/unlock">) {
  const { token } = await ctx.params;
  const project = await getProjectByShareToken(token);
  if (!project || !project.shareEnabled) return Response.json({ error: "This link is not active." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  const rows = await db().select({ hash: schema.projects.sharePasswordHash }).from(schema.projects).where(eq(schema.projects.id, project.id)).limit(1);
  const stored = rows[0]?.hash;
  if (!stored) return Response.json({ ok: true });
  if (!body.password || !verifyPassword(body.password, stored)) return Response.json({ error: "That password is not right." }, { status: 401 });
  const secret = await shareSecret(project);
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", `${shareCookieName(token)}=${signShare(token, secret)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${60 * 60 * 24 * 30}`);
  return res;
}

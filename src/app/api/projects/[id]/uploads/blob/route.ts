import type { NextRequest } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getProjectById } from "@/lib/data/projects";
import { hasUpdateAccess } from "@/lib/share/auth";
import { incomingPrefix } from "@/lib/storage/files";

export const dynamic = "force-dynamic";

/**
 * Issues a short-lived token so the browser can put a workbook larger than a function request allows (4.5 MB) straight
 * into the private Blob store, under incoming/<projectId>/. The uploads route then reads it from there.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/uploads/blob">) {
  const { id } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as HandleUploadBody | null;
  if (!body) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        if (!(await hasUpdateAccess(project.id))) throw new Error("This dashboard's data is locked. Enter the update password to continue.");
        if (!pathname.startsWith(incomingPrefix(project.id)) || pathname.includes("..")) throw new Error("Uploads go to this project's own folder.");
        if (!/\.(xlsx|xlsm|xlsb|xls|csv)$/i.test(pathname)) throw new Error("Upload an Excel or CSV file.");
        return { maximumSizeInBytes: 100 * 1024 * 1024, addRandomSuffix: true };
      },
      onUploadCompleted: async () => {},
    });
    return Response.json(json);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Upload refused";
    return Response.json({ error: message, locked: /locked/.test(message) }, { status: /locked/.test(message) ? 401 : 400 });
  }
}

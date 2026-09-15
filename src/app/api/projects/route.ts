import { listProjects } from "@/lib/data/projects";
import { createProjectFromWorkbook } from "@/lib/data/create-project";
import { hasDatabase } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const projects = await listProjects();
  return Response.json({ projects });
}

export async function POST(req: Request) {
  if (!hasDatabase()) return Response.json({ error: "DATABASE_URL is not configured" }, { status: 500 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Attach a workbook as the 'file' field" }, { status: 400 });
  const name = String(form.get("name") ?? "").trim() || file.name.replace(/\.(xlsx|xlsm|xls|csv)$/i, "");
  const clientName = String(form.get("clientName") ?? "").trim() || undefined;
  const uploadedBy = String(form.get("uploadedBy") ?? "").trim() || "Unknown";
  const primary = String(form.get("primary") ?? "").trim() || undefined;
  let overrides: { id: string; label?: string; role?: "id" | "dimension" | "measure" | "date" | "text" | "ignore"; hidden?: boolean }[] | undefined;
  const rawOverrides = form.get("overrides");
  if (typeof rawOverrides === "string" && rawOverrides) { try { overrides = JSON.parse(rawOverrides); } catch { return Response.json({ error: "overrides must be JSON" }, { status: 400 }); } }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await createProjectFromWorkbook({ buffer, fileName: file.name, name, clientName, uploadedBy, primary, overrides });
    return Response.json(result, { status: 201 });
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : "Ingestion failed" }, { status: 422 });
  }
}

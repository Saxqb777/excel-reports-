import { ingestNew } from "@/lib/ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Reads a workbook and returns the proposed schema and dashboard without saving anything. */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Attach a workbook as the 'file' field" }, { status: 400 });
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const res = await ingestNew(buffer, file.name);
    const sheet = res.workbook.sheets[res.workbook.primary];
    return Response.json({
      fileName: file.name,
      template: res.template,
      sheet: { name: sheet.name, rows: sheet.rows.length, headers: sheet.headers, sheets: res.workbook.sheets.map((s) => ({ name: s.name, rows: s.rows.length })) },
      fields: res.schema.fields.map((f) => ({ id: f.id, label: f.label, source: f.source, type: f.type, role: f.role, semantic: f.semantic ?? null, derived: Boolean(f.derived), samples: (sheet.stats.find((s) => s.header === f.source)?.samples.slice(0, 3) ?? []).map((v) => (/^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 10) : v)) })),
      pages: (res.layout?.pages ?? []).map((p) => ({ id: p.id, title: p.title, widgets: p.widgets.map((w) => ({ id: w.id, type: w.type, title: w.title })) })),
      rows: res.snapshot.n, excluded: res.snapshot.excluded.length, fixes: res.snapshot.fixes.length,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not read the workbook" }, { status: 422 });
  }
}

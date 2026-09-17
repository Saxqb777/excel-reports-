import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { getCurrentUpload, getProjectByShareToken, getSnapshot } from "@/lib/data/projects";
import type { KpiWidget } from "@/lib/dashboard/types";
import { buildMask } from "@/lib/engine/filters";
import { computeMetric } from "@/lib/engine/metrics";
import { formatDateTime, formatNumber } from "@/lib/engine/format";

export const dynamic = "force-dynamic";

const FONT_DIR = path.join(process.cwd(), "node_modules/@fontsource/source-sans-3/files");
const font = (weight: 400 | 700) => readFile(path.join(FONT_DIR, `source-sans-3-latin-${weight}-normal.woff`));

const BG = "#0f1114", LINE = "#2a2e35", INK = "#f4f5f7", INK2 = "#b9bdc6", INK3 = "#858b96";

/**
 * Link preview card (1200×630) for a shared dashboard: name, client, the first four KPIs and the last update.
 * Flat colours and small size so WhatsApp, Teams and mail clients show it. Password-protected projects show no numbers.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/og/[token]">) {
  const { token } = await ctx.params;
  const project = await getProjectByShareToken(token);
  if (!project || !project.shareEnabled) return new Response("Not found", { status: 404 });
  const locked = project.hasSharePassword;
  const [snapshot, upload] = locked ? [null, null] : await Promise.all([getSnapshot(project), getCurrentUpload(project)]);
  const accent = /^#[0-9a-f]{6}$/i.test(project.theme.primary) ? project.theme.primary : "#4d8dff";
  const monogram = (project.theme.monogram ?? project.name.slice(0, 2)).toUpperCase();

  const kpis: { label: string; value: string; note: string | null }[] = [];
  if (snapshot) {
    const mask = buildMask(snapshot.columns, snapshot.n, []);
    const widgets = project.layout.pages[0]?.widgets.filter((w): w is KpiWidget => w.type === "kpi") ?? [];
    for (const w of widgets.slice(0, 4)) {
      const v = computeMetric(snapshot, mask, w.metric);
      const sec = w.secondary ? computeMetric(snapshot, mask, w.secondary.metric) : null;
      kpis.push({ label: w.title, value: formatNumber(v, w.metric.format ?? "integer", w.metric.currency, true), note: w.secondary ? `${formatNumber(sec, w.secondary.metric.format ?? "integer", w.secondary.metric.currency)} ${w.secondary.label}` : null });
    }
  }
  const footer = locked ? "Password protected · open the link to view" : upload ? `Updated ${formatDateTime(upload.uploadedAt)} · version ${upload.versionNo} · ${formatNumber(upload.rowCount)} rows` : "No data yet";
  const [f400, f700] = await Promise.all([font(400), font(700)]);

  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", flexDirection: "column", justifyContent: "space-between", background: BG, color: INK, padding: "56px 64px", fontFamily: "Source Sans 3" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, background: accent, color: "#ffffff", fontSize: 30, fontWeight: 700 }}>{monogram}</div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 44, fontWeight: 700, lineHeight: 1.1 }}>{project.name}</div>
              {project.clientName && <div style={{ fontSize: 26, color: INK3, marginTop: 4 }}>{project.clientName}</div>}
            </div>
          </div>
          <div style={{ fontSize: 24, color: INK3 }}>Reports and analytics</div>
        </div>

        {kpis.length > 0 ? (
          <div style={{ display: "flex", gap: 28 }}>
            {kpis.map((k) => (
              <div key={k.label} style={{ display: "flex", flexDirection: "column", flex: 1, borderTop: `1px solid ${LINE}`, paddingTop: 18 }}>
                <div style={{ fontSize: 24, color: INK2, fontWeight: 700 }}>{k.label}</div>
                <div style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.05, marginTop: 8 }}>{k.value}</div>
                {k.note && <div style={{ fontSize: 24, color: INK3, marginTop: 6 }}>{k.note}</div>}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", borderTop: `1px solid ${LINE}`, paddingTop: 22, fontSize: 32, color: INK2 }}>{locked ? "Password protected dashboard" : "Live dashboard"}</div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 24, color: INK3 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}><div style={{ width: 10, height: 10, background: accent }} />{footer}</div>
          <div>Live · opens in the browser</div>
        </div>
      </div>
    ),
    {
      width: 1200, height: 630,
      fonts: [{ name: "Source Sans 3", data: f400, weight: 400, style: "normal" }, { name: "Source Sans 3", data: f700, weight: 700, style: "normal" }],
      headers: { "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600" },
    },
  );
}

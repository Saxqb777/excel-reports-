import type { NextRequest } from "next/server";
import { getProjectById } from "@/lib/data/projects";
import { shareSecret, shareCookieName, signShare } from "@/lib/share/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Renders the share page in headless Chromium and returns a PNG of one page or a PDF of every page.
 * Pixel-identical to the screen because it is the screen.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/export">) {
  const { id } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "pdf" ? "pdf" : "png";
  const theme = url.searchParams.get("theme") === "light" ? "light" : "dark";
  const pageId = url.searchParams.get("page") ?? project.layout.pages[0]?.id ?? "overview";
  const width = Math.min(2560, Math.max(1024, Number(url.searchParams.get("width") ?? 1600)));
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? `${url.protocol}//${url.host}`;
  const target = (p: string) => `${origin}/s/${project.shareToken}?print=1&page=${encodeURIComponent(p)}&theme=${theme}`;

  let browser: import("puppeteer-core").Browser | null = null;
  try {
    const puppeteer = await import("puppeteer-core");
    let executablePath = process.env.CHROME_PATH;
    let args: string[] = ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"];
    if (!executablePath) {
      const chromium = (await import("@sparticuz/chromium")).default;
      executablePath = await chromium.executablePath();
      args = [...chromium.args, "--font-render-hinting=none"];
    }
    browser = await puppeteer.launch({ executablePath, args, headless: true, defaultViewport: { width, height: 900, deviceScaleFactor: format === "png" ? 2 : 1 } });
    const page = await browser.newPage();
    // Pass share access for password-protected links so the renderer is never blocked.
    if (project.hasSharePassword) {
      const secret = await shareSecret(project);
      await page.setCookie({ name: shareCookieName(project.shareToken), value: signShare(project.shareToken, secret), url: origin });
    }
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "-").replace(":", "");
    const safeName = project.name.replace(/[^\w\-]+/g, "_");
    if (format === "png") {
      await page.goto(target(pageId), { waitUntil: "networkidle0", timeout: 45_000 });
      await page.waitForSelector(".react-grid-layout", { timeout: 20_000 });
      await new Promise((r) => setTimeout(r, 700));
      const buf = await page.screenshot({ type: "png", fullPage: true });
      return new Response(new Uint8Array(buf), { headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="${safeName}-${pageId}-${stamp}.png"` } });
    }
    // PDF: one landscape sheet per page, rendered at the same width as the screen.
    const { PDFDocument } = await import("pdf-lib");
    const out = await PDFDocument.create();
    for (const p of project.layout.pages.filter((x) => !x.widgets.every((w) => w.type === "quality"))) {
      await page.goto(target(p.id), { waitUntil: "networkidle0", timeout: 45_000 });
      await page.waitForSelector(".react-grid-layout", { timeout: 20_000 });
      await new Promise((r) => setTimeout(r, 700));
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      const pdf = await page.pdf({ printBackground: true, width: `${width}px`, height: `${Math.max(height, 600)}px`, pageRanges: "1", preferCSSPageSize: false });
      const doc = await PDFDocument.load(pdf);
      const copied = await out.copyPages(doc, doc.getPageIndices());
      copied.forEach((pg) => out.addPage(pg));
    }
    const bytes = await out.save();
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${safeName}-${stamp}.pdf"` } });
  } catch (e) {
    console.error("export failed", e);
    return Response.json({ error: e instanceof Error ? e.message : "Export failed" }, { status: 500 });
  } finally {
    await browser?.close().catch(() => {});
  }
}

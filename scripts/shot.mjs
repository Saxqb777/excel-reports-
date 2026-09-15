import { chromium } from "playwright-core";
const base = process.env.BASE ?? "http://127.0.0.1:3100";
const out = process.env.OUT ?? "/tmp/claude-0/-home-user-excel-reports-/cc6ead6e-ff23-58f3-87a0-cb2891e79954/scratchpad/shots";
import { mkdirSync } from "node:fs";
mkdirSync(out, { recursive: true });
const exe = ["/opt/pw-browsers/chromium", "/opt/pw-browsers/chromium/chrome", "/opt/pw-browsers/chromium-*/chrome-linux/chrome"];
import { existsSync, readdirSync } from "node:fs";
let executablePath = null;
for (const d of readdirSync("/opt/pw-browsers")) {
  for (const cand of [`/opt/pw-browsers/${d}/chrome-linux/chrome`, `/opt/pw-browsers/${d}/chrome-linux64/chrome`, `/opt/pw-browsers/${d}/chrome`]) if (existsSync(cand)) executablePath = cand;
}
if (!executablePath && existsSync("/opt/pw-browsers/chromium")) executablePath = "/opt/pw-browsers/chromium";
const browser = await chromium.launch({ executablePath, args: ["--no-sandbox"] });
const shots = JSON.parse(process.env.SHOTS ?? "[]");
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.w ?? 1600, height: s.h ?? 900 }, deviceScaleFactor: 1, colorScheme: s.theme === "light" ? "light" : "dark" });
  const page = await ctx.newPage();
  await page.addInitScript((t) => { try { localStorage.setItem("meridian-theme", t); } catch {} }, s.theme ?? "dark");
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(base + s.path, { waitUntil: "networkidle" });
  if (s.upload) { await page.locator('input[type="file"]').first().setInputFiles(s.upload); await page.waitForTimeout(2500); }
  if (s.click) { for (const sel of s.click) { await page.locator(sel).first().click({ timeout: 8000 }); await page.waitForTimeout(600); } }
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/${s.name}.png`, fullPage: s.full ?? false });
  console.log("shot", s.name, errors.length ? "ERRORS: " + errors.join(" | ").slice(0, 500) : "ok");
  await ctx.close();
}
await browser.close();

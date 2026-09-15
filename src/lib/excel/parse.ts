import ExcelJS from "exceljs";
import Papa from "papaparse";
import type { ColumnStats, ParsedSheet, ParsedWorkbook, RawCell, RawRow } from "@/lib/schema/types";
import { cleanText, normKey } from "@/lib/schema/types";

const MAX_HEADER_SCAN = 20;

type CellKind = "n" | "s" | "d" | "b" | "e";

function coerce(value: ExcelJS.CellValue): { v: RawCell; k: CellKind } {
  if (value === null || value === undefined) return { v: null, k: "e" };
  if (value instanceof Date) return { v: value.toISOString(), k: "d" };
  if (typeof value === "number") return Number.isFinite(value) ? { v: value, k: "n" } : { v: null, k: "e" };
  if (typeof value === "boolean") return { v: value, k: "b" };
  if (typeof value === "string") {
    const s = cleanText(value);
    return s ? { v: s, k: "s" } : { v: null, k: "e" };
  }
  if (typeof value === "object") {
    const o = value as unknown as Record<string, unknown>;
    if ("richText" in o && Array.isArray(o.richText)) {
      const s = cleanText((o.richText as { text: string }[]).map((r) => r.text).join(""));
      return s ? { v: s, k: "s" } : { v: null, k: "e" };
    }
    if ("result" in o) return coerce(o.result as ExcelJS.CellValue);
    if ("text" in o && typeof o.text === "string") return coerce(o.text);
    if ("hyperlink" in o && typeof o.hyperlink === "string") return coerce(o.hyperlink);
    if ("error" in o) return { v: null, k: "e" };
  }
  return { v: null, k: "e" };
}

function colLetter(ref: string): string {
  const m = /^([A-Z]+)/.exec(ref);
  return m ? m[1] : "";
}

function colIndex(letter: string): number {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function extractValidations(ws: ExcelJS.Worksheet): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  const model = (ws as unknown as { dataValidations?: { model?: Record<string, { type?: string; formulae?: unknown[] }> } })
    .dataValidations?.model;
  if (!model) return out;
  for (const [ref, dv] of Object.entries(model)) {
    if (!dv || dv.type !== "list") continue;
    const f = dv.formulae?.[0];
    if (typeof f !== "string") continue;
    const inner = f.trim().replace(/^"|"$/g, "");
    if (!inner || inner.includes("!") || inner.startsWith("$")) continue; // range references, not literal lists
    const items = inner.split(",").map((s) => cleanText(s)).filter(Boolean);
    if (items.length < 2) continue;
    const ci = colIndex(colLetter(ref));
    if (!out[ci]) out[ci] = items;
  }
  return out;
}

function pickHeaderRow(grid: { v: RawCell; k: CellKind }[][]): number {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(grid.length, MAX_HEADER_SCAN);
  for (let r = 0; r < limit; r++) {
    const row = grid[r];
    const nonEmpty = row.filter((c) => c.v !== null);
    if (nonEmpty.length < 2) continue;
    const strings = nonEmpty.filter((c) => c.k === "s").length;
    const next = grid[r + 1];
    const nextHasData = next ? next.some((c) => c.v !== null) : false;
    const score = strings / nonEmpty.length + nonEmpty.length / 100 + (nextHasData ? 0.2 : 0) - r * 0.01;
    if (strings >= nonEmpty.length * 0.6 && score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

function buildSheet(name: string, grid: { v: RawCell; k: CellKind }[][], validations: Record<number, string[]>): ParsedSheet | null {
  if (grid.length === 0) return null;
  const headerRow = pickHeaderRow(grid);
  const headerCells = grid[headerRow];
  const width = Math.max(...grid.map((r) => r.length));
  const headers: string[] = [];
  const seen = new Map<string, number>();
  for (let c = 0; c < width; c++) {
    const raw = headerCells[c]?.v;
    let h = raw === null || raw === undefined ? "" : cleanText(raw);
    if (!h) h = `Column ${String.fromCharCode(65 + (c % 26))}${c >= 26 ? Math.floor(c / 26) : ""}`;
    const key = normKey(h);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    headers.push(n > 1 ? `${h} (${n})` : h);
  }
  // Drop trailing headers that are auto-named and have no data at all.
  const rows: RawRow[] = [];
  const stats: ColumnStats[] = headers.map((header, index) => ({
    header, index, nonEmpty: 0, numbers: 0, dates: 0, booleans: 0, strings: 0, distinct: 0, avgLength: 0, samples: [],
  }));
  const distinctSets = headers.map(() => new Set<string>());
  const lengthSum = headers.map(() => 0);
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row.some((c) => c.v !== null)) continue;
    const cells: Record<string, RawCell> = {};
    for (let c = 0; c < width; c++) {
      const cell = row[c] ?? { v: null, k: "e" };
      cells[headers[c]] = cell.v;
      if (cell.v === null) continue;
      const st = stats[c];
      st.nonEmpty++;
      if (cell.k === "n") st.numbers++;
      else if (cell.k === "d") st.dates++;
      else if (cell.k === "b") st.booleans++;
      else st.strings++;
      const key = normKey(cell.v);
      distinctSets[c].add(key);
      lengthSum[c] += String(cell.v).length;
      if (st.samples.length < 8 && !st.samples.includes(String(cell.v))) st.samples.push(String(cell.v));
    }
    rows.push({ row: r + 1, cells });
  }
  stats.forEach((st, c) => {
    st.distinct = distinctSets[c].size;
    st.avgLength = st.nonEmpty ? lengthSum[c] / st.nonEmpty : 0;
    const av = validations[c + 1];
    if (av) st.allowedValues = av;
  });
  // Remove fully empty auto-named columns.
  const keep = headers.map((h, i) => stats[i].nonEmpty > 0 || !/^Column [A-Z]/.test(h));
  const keptHeaders = headers.filter((_, i) => keep[i]);
  const keptStats = stats.filter((_, i) => keep[i]).map((s, i) => ({ ...s, index: i }));
  for (const row of rows) for (const h of headers) if (!keptHeaders.includes(h)) delete row.cells[h];
  const vmap: Record<string, string[]> = {};
  keptStats.forEach((s) => { if (s.allowedValues) vmap[s.header] = s.allowedValues; });
  return { name, headerRow: headerRow + 1, headers: keptHeaders, rows, stats: keptStats, validations: vmap, totalRowsInSheet: grid.length };
}

export async function parseWorkbook(buffer: ArrayBuffer | Buffer, fileName: string): Promise<ParsedWorkbook> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".txt")) return parseCsv(buffer, fileName);
  const wb = new ExcelJS.Workbook();
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheets: ParsedSheet[] = [];
  for (const ws of wb.worksheets) {
    if (ws.state && ws.state !== "visible") continue;
    const grid: { v: RawCell; k: CellKind }[][] = [];
    const rowCount = ws.actualRowCount || ws.rowCount;
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const arr: { v: RawCell; k: CellKind }[] = [];
      const colCount = Math.max(row.cellCount, ws.columnCount);
      for (let c = 1; c <= colCount; c++) arr.push(coerce(row.getCell(c).value));
      grid.push(arr);
    }
    const parsed = buildSheet(ws.name, grid, extractValidations(ws));
    if (parsed && parsed.rows.length > 0) sheets.push(parsed);
  }
  if (sheets.length === 0) throw new Error("No sheet with data was found in the workbook.");
  let primary = 0;
  let best = -1;
  sheets.forEach((s, i) => {
    const score = s.rows.length * s.headers.length;
    if (score > best) { best = score; primary = i; }
  });
  return { fileName, sheets, primary };
}

function parseCsv(buffer: ArrayBuffer | Buffer, fileName: string): ParsedWorkbook {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : Buffer.from(buffer).toString("utf8");
  const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const grid = res.data.map((row) => row.map((cell) => {
    const s = cleanText(cell);
    if (!s) return { v: null, k: "e" as CellKind };
    if (/^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(s)) return { v: Number(s.replace(/,/g, "")), k: "n" as CellKind };
    const d = parseLooseDate(s);
    if (d !== null) return { v: new Date(d).toISOString(), k: "d" as CellKind };
    if (/^(true|false)$/i.test(s)) return { v: s.toLowerCase() === "true", k: "b" as CellKind };
    return { v: s, k: "s" as CellKind };
  }));
  const sheet = buildSheet("CSV", grid, {});
  if (!sheet) throw new Error("The CSV file is empty.");
  return { fileName, sheets: [sheet], primary: 0 };
}

/** Parse ISO, dd/mm/yyyy, dd-mm-yyyy, mm/dd/yyyy (when unambiguous), d MMM yyyy. Returns epoch ms at UTC midnight. */
export function parseLooseDate(s: string): number | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/.exec(t);
  if (m) {
    let a = +m[1], b = +m[2];
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (a > 12 && b <= 12) { /* dd/mm */ } else if (b > 12 && a <= 12) { const tmp = a; a = b; b = tmp; }
    const day = a, month = b;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return Date.UTC(y, month - 1, day);
  }
  m = /^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/.exec(t);
  if (m) {
    const month = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"].indexOf(m[2].slice(0, 3).toLowerCase());
    if (month >= 0) return Date.UTC(+m[3], month, +m[1]);
  }
  return null;
}

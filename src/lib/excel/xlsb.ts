import JSZip from "jszip";
import type { RawCell } from "@/lib/schema/types";
import { cleanText } from "@/lib/schema/types";

/**
 * A reader for Excel binary workbooks (.xlsb), which ExcelJS cannot open. It reads cached cell values only (no formulas,
 * no formatting beyond telling dates from numbers) and streams each sheet, stopping once the data has clearly ended.
 *
 * That last part matters: .xlsb files written by hand often carry a serial-number or formula column filled down to row
 * 1,048,576, or a million formatted blank rows, which makes a sheet that holds 1,500 records unpack to 100+ MB. Rows with
 * a single value after the last real record, and blank rows, are not data; reading stops TAIL_GAP rows past the last
 * real record.
 *
 * Format reference: [MS-XLSB] (BIFF12 records: a 7-bit varint type, a 7-bit varint length, then the payload).
 */

export type XCellKind = "n" | "s" | "d" | "b" | "e";
export interface XCell { v: RawCell; k: XCellKind }
export interface XlsbSheet { name: string; hidden: boolean; grid: XCell[][] }

const TAIL_GAP = 1000;
const MAX_ROWS = 200_000;
const MAX_COLS = 400;

// Record types as numbered in [MS-XLSB].
const R = {
  ROW_HDR: 0, CELL_BLANK: 1, CELL_RK: 2, CELL_ERROR: 3, CELL_BOOL: 4, CELL_REAL: 5, CELL_ST: 6, CELL_ISST: 7,
  FMLA_STRING: 8, FMLA_NUM: 9, FMLA_BOOL: 10, FMLA_ERROR: 11,
  SST_ITEM: 19, FMT: 44, XF: 47, WB_PROP: 153, BUNDLE_SH: 156, BEGIN_CELL_XFS: 617, END_CELL_XFS: 618,
} as const;

type OnRecord = (type: number, data: Buffer) => boolean | void;

/** Parses as many complete records as `buf` holds; returns the offset of the first incomplete one, or -1 when told to stop. */
function parseRecords(buf: Buffer, onRecord: OnRecord): number {
  let p = 0;
  while (p < buf.length) {
    const start = p;
    let b = buf[p++];
    let type = b & 0x7f;
    if (b & 0x80) {
      if (p >= buf.length) return start;
      b = buf[p++];
      type |= (b & 0x7f) << 7;
    }
    let size = 0, shift = 0, complete = false;
    for (let i = 0; i < 4 && p < buf.length; i++) {
      b = buf[p++];
      size |= (b & 0x7f) << shift;
      shift += 7;
      if (!(b & 0x80)) { complete = true; break; }
    }
    if (!complete || p + size > buf.length) return start;
    if (onRecord(type, buf.subarray(p, p + size)) === false) return -1;
    p += size;
  }
  return p;
}

/** Streams a zip entry through the record parser; decompression stops as soon as the callback returns false. */
function streamRecords(file: JSZip.JSZipObject, onRecord: OnRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    let pending: Buffer = Buffer.alloc(0);
    let done = false;
    const helper = (file as unknown as { internalStream(t: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream("uint8array");
    helper.on("data", (chunk: Uint8Array) => {
      if (done) return;
      const c = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      pending = pending.length ? Buffer.concat([pending, c]) : c;
      const at = parseRecords(pending, onRecord);
      if (at === -1) { done = true; helper.pause(); resolve(); return; }
      pending = Buffer.from(pending.subarray(at));
    });
    helper.on("end", () => { if (!done) { done = true; resolve(); } });
    helper.on("error", (e: Error) => { if (!done) { done = true; reject(e); } });
    helper.resume();
  });
}

function wideString(data: Buffer, at: number): { s: string | null; next: number } {
  if (at + 4 > data.length) return { s: null, next: data.length };
  const n = data.readUInt32LE(at);
  if (n === 0xffffffff) return { s: null, next: at + 4 };
  const end = Math.min(data.length, at + 4 + n * 2);
  return { s: data.toString("utf16le", at + 4, end), next: end };
}

/** Decodes an RkNumber: a 30-bit integer or the top 30 bits of a double, optionally divided by 100. */
function rk(data: Buffer, at: number): number {
  const raw = data.readInt32LE(at);
  let v: number;
  if (raw & 0x02) v = raw >> 2;
  else { const b = Buffer.alloc(8); b.writeInt32LE(raw & 0xfffffffc, 4); v = b.readDoubleLE(0); }
  return raw & 0x01 ? v / 100 : v;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

export function isDateFormat(id: number, code: string | undefined): boolean {
  if (BUILTIN_DATE_FORMATS.has(id)) return true;
  if (!code) return false;
  const stripped = code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[(?!h\]|m\]|s\]|hh\]|mm\]|ss\])[^\]]*\]/gi, "");
  if (/general/i.test(stripped)) return false;
  return /[dmyhs]/i.test(stripped) && !/^[#0.,%\s;-]*$/.test(stripped);
}

function serialToIso(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2958465) return null;
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(Math.round(epoch + serial * 86400000)).toISOString();
}

function relTargets(xml: string): Map<string, { target: string; type: string }> {
  const out = new Map<string, { target: string; type: string }>();
  for (const m of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = m[0];
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    const type = /\bType="([^"]+)"/.exec(tag)?.[1] ?? "";
    if (id && target) out.set(id, { target, type });
  }
  return out;
}

function resolvePath(target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = `xl/${target}`.split("/");
  const out: string[] = [];
  for (const part of parts) { if (part === "..") out.pop(); else if (part && part !== ".") out.push(part); }
  return out.join("/");
}

export function looksLikeXlsb(buf: Buffer): Promise<boolean> {
  return JSZip.loadAsync(buf).then((zip) => Boolean(zip.file("xl/workbook.bin")), () => false);
}

export async function readXlsb(buf: Buffer): Promise<XlsbSheet[]> {
  const zip = await JSZip.loadAsync(buf);
  const wbFile = zip.file("xl/workbook.bin");
  if (!wbFile) throw new Error("This .xlsb file has no workbook part.");
  const rels = relTargets((await zip.file("xl/_rels/workbook.bin.rels")?.async("string")) ?? "");

  // Workbook: sheet list and date system.
  let date1904 = false;
  const bundles: { name: string; hidden: boolean; relId: string | null }[] = [];
  parseRecords(await wbFile.async("nodebuffer"), (type, d) => {
    if (type === R.WB_PROP && d.length >= 4) date1904 = (d.readUInt32LE(0) & 1) === 1;
    if (type === R.BUNDLE_SH && d.length >= 12) {
      const state = d.readUInt32LE(0);
      const rel = wideString(d, 8);
      const name = wideString(d, rel.next);
      bundles.push({ name: name.s ?? `Sheet${bundles.length + 1}`, hidden: state !== 0, relId: rel.s });
    }
  });

  // Shared strings.
  const strings: string[] = [];
  const sstRel = [...rels.values()].find((r) => /\/sharedStrings$/.test(r.type));
  const sstFile = zip.file(sstRel ? resolvePath(sstRel.target) : "xl/sharedStrings.bin");
  if (sstFile) await streamRecords(sstFile, (type, d) => { if (type === R.SST_ITEM && d.length >= 5) strings.push(wideString(d, 1).s ?? ""); });

  // Styles: which cell formats are dates.
  const dateXf: boolean[] = [];
  const stylesRel = [...rels.values()].find((r) => /\/styles$/.test(r.type));
  const stylesFile = zip.file(stylesRel ? resolvePath(stylesRel.target) : "xl/styles.bin");
  if (stylesFile) {
    const formats = new Map<number, string>();
    const xfFormats: number[] = [];
    let inCellXfs = false;
    parseRecords(await stylesFile.async("nodebuffer"), (type, d) => {
      if (type === R.FMT && d.length >= 6) formats.set(d.readUInt16LE(0), wideString(d, 2).s ?? "");
      else if (type === R.BEGIN_CELL_XFS) inCellXfs = true;
      else if (type === R.END_CELL_XFS) inCellXfs = false;
      else if (type === R.XF && inCellXfs && d.length >= 4) xfFormats.push(d.readUInt16LE(2));
    });
    xfFormats.forEach((id, i) => { dateXf[i] = isDateFormat(id, formats.get(id)); });
  }

  const sheets: XlsbSheet[] = [];
  for (const b of bundles) {
    const rel = b.relId ? rels.get(b.relId) : undefined;
    const file = rel ? zip.file(resolvePath(rel.target)) : null;
    if (!file) continue;
    sheets.push({ name: b.name, hidden: b.hidden, grid: await readSheet(file, strings, dateXf, date1904) });
  }
  return sheets;
}

async function readSheet(file: JSZip.JSZipObject, strings: string[], dateXf: boolean[], date1904: boolean): Promise<XCell[][]> {
  const rows = new Map<number, XCell[]>();
  let row = -1;
  let cells: XCell[] = [];
  let count = 0;
  let maxWidth = 0;
  let lastData = -1;
  const flush = () => {
    if (row < 0 || count === 0) return;
    maxWidth = Math.max(maxWidth, count);
    rows.set(row, cells);
    // A row with one value after wider rows is a filled-down serial number or a stray note, not a record.
    if (count >= Math.min(2, maxWidth)) lastData = row;
  };
  const put = (col: number, cell: XCell) => {
    if (col >= MAX_COLS || cell.v === null) return;
    if (cells[col] === undefined || cells[col].v === null) count++;
    cells[col] = cell;
  };
  await streamRecords(file, (type, d) => {
    if (type === R.ROW_HDR) {
      flush();
      row = d.readUInt32LE(0);
      cells = [];
      count = 0;
      if (lastData >= 0 ? row > lastData + TAIL_GAP : row > 100_000) return false;
      if (rows.size >= MAX_ROWS) return false;
      return;
    }
    if (type < R.CELL_BLANK || type > R.FMLA_ERROR || d.length < 8) return;
    const col = d.readUInt32LE(0);
    const style = d.readUInt32LE(4) & 0xffffff;
    switch (type) {
      case R.CELL_RK: case R.CELL_REAL: case R.FMLA_NUM: {
        const n = type === R.CELL_RK ? rk(d, 8) : d.readDoubleLE(8);
        if (!Number.isFinite(n)) return;
        if (dateXf[style]) { const iso = serialToIso(n, date1904); if (iso) put(col, { v: iso, k: "d" }); return; }
        put(col, { v: n, k: "n" });
        return;
      }
      case R.CELL_ISST: { const s = cleanText(strings[d.readUInt32LE(8)] ?? ""); if (s) put(col, { v: s, k: "s" }); return; }
      case R.CELL_ST: case R.FMLA_STRING: { const s = cleanText(wideString(d, 8).s ?? ""); if (s) put(col, { v: s, k: "s" }); return; }
      case R.CELL_BOOL: case R.FMLA_BOOL: put(col, { v: d[8] !== 0, k: "b" }); return;
      default: return;
    }
  });
  flush();
  const grid: XCell[][] = [];
  for (let r = 0; r <= lastData; r++) {
    const src = rows.get(r);
    const out: XCell[] = [];
    if (src) for (let c = 0; c < src.length; c++) out.push(src[c] ?? { v: null, k: "e" });
    grid.push(out);
  }
  return grid;
}

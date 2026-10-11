import { get, put } from "@vercel/blob";

export interface StoredFile { kind: "blob" | "blob-private" | "pg"; ref: string | null; bytes: Buffer | null }

/**
 * Stores the raw workbook. Prefers a private Vercel Blob (client data should never sit on a public URL),
 * falls back to a public blob on stores that reject private access, and to Postgres when no store exists.
 */
export async function storeFile(buffer: Buffer, projectId: string, uploadId: string, fileName: string): Promise<StoredFile> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const safe = fileName.replace(/[^\w.\-]+/g, "_");
    const pathname = `projects/${projectId}/${uploadId}/${safe}`;
    try {
      const res = await put(pathname, buffer, { access: "private", addRandomSuffix: false, contentType: "application/octet-stream" });
      return { kind: "blob-private", ref: res.pathname ?? pathname, bytes: null };
    } catch (e) {
      console.error("Private blob upload failed, trying public", e);
    }
    try {
      const res = await put(pathname, buffer, { access: "public", addRandomSuffix: false, contentType: "application/octet-stream" });
      return { kind: "blob", ref: res.url, bytes: null };
    } catch (e) {
      console.error("Blob upload failed, falling back to Postgres", e);
    }
  }
  return { kind: "pg", ref: null, bytes: buffer };
}

/** Reads a stored file back as a stream or buffer, whichever storage holds it. */
export async function readStoredFile(kind: string, ref: string | null, bytes: Buffer | null): Promise<{ body: ReadableStream | Uint8Array; redirect?: string } | null> {
  if (kind === "pg") return bytes ? { body: new Uint8Array(bytes) } : null;
  if (kind === "blob" && ref) return { body: new Uint8Array(0), redirect: ref };
  if (kind === "blob-private" && ref) {
    const res = await get(ref, { access: "private" });
    if (!res || res.statusCode !== 200 || !res.stream) return null;
    return { body: res.stream as unknown as ReadableStream };
  }
  return null;
}

/** Browser uploads larger than a function request allows go straight to Blob under this prefix (see uploads/blob). */
export const incomingPrefix = (projectId: string) => `incoming/${projectId}/`;

/** Reads a private blob into memory (a workbook uploaded straight from the browser). */
export async function readBlobBuffer(ref: string): Promise<Buffer | null> {
  const res = await get(ref, { access: "private" });
  if (!res || res.statusCode !== 200 || !res.stream) return null;
  const chunks: Uint8Array[] = [];
  const reader = res.stream.getReader();
  for (;;) { const { done, value } = await reader.read(); if (done) break; if (value) chunks.push(value); }
  return Buffer.concat(chunks);
}

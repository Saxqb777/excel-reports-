import { put } from "@vercel/blob";

export interface StoredFile { kind: "blob" | "pg"; ref: string | null; bytes: Buffer | null }

/** Stores the raw workbook in Vercel Blob when a token exists, otherwise keeps the bytes in Postgres. */
export async function storeFile(buffer: Buffer, projectId: string, uploadId: string, fileName: string): Promise<StoredFile> {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const safe = fileName.replace(/[^\w.\-]+/g, "_");
      const res = await put(`projects/${projectId}/${uploadId}/${safe}`, buffer, { access: "public", addRandomSuffix: false, contentType: "application/octet-stream" });
      return { kind: "blob", ref: res.url, bytes: null };
    } catch (e) {
      console.error("Blob upload failed, falling back to Postgres", e);
    }
  }
  return { kind: "pg", ref: null, bytes: buffer };
}

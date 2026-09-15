import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import type { ProjectSummary } from "@/lib/data/projects";

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/** Per-project secret used to sign share cookies; created on first use and kept in settings. */
export async function shareSecret(project: ProjectSummary): Promise<string> {
  const existing = project.settings.shareSecret;
  if (typeof existing === "string" && existing.length >= 32) return existing;
  const secret = randomBytes(32).toString("hex");
  await db().update(schema.projects).set({ settings: { ...project.settings, shareSecret: secret } }).where(eq(schema.projects.id, project.id));
  return secret;
}

export const shareCookieName = (token: string) => `mshare_${token}`;

export function signShare(token: string, secret: string): string {
  return createHmac("sha256", secret).update(`share:${token}`).digest("hex");
}

export async function hasShareAccess(project: ProjectSummary): Promise<boolean> {
  if (!project.hasSharePassword) return true;
  const jar = await cookies();
  const value = jar.get(shareCookieName(project.shareToken))?.value;
  if (!value) return false;
  const secret = await shareSecret(project);
  const expected = signShare(project.shareToken, secret);
  return value.length === expected.length && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

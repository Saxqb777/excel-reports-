import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { eq, sql } from "drizzle-orm";
import { db, hasDatabase, schema } from "@/lib/db/client";
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

/** Secrets kept inside projects.settings. `toSummary` strips them, so they are only ever read here, straight from the database. */
interface ProjectSecrets { shareSecret: string; updatePasswordHash: string | null }

// Fixture mode (no database): a per-process secret, and MERIDIAN_FIXTURE_LOCK=<password> locks every fixture project for local checks.
const fixtureSecret = randomBytes(32).toString("hex");
const fixtureLockHash = process.env.MERIDIAN_FIXTURE_LOCK ? hashPassword(process.env.MERIDIAN_FIXTURE_LOCK) : null;

/** Merges keys into projects.settings in the database (jsonb ||), never touching keys it does not name. */
async function mergeSettings(projectId: string, patch: Record<string, unknown>): Promise<void> {
  await db().update(schema.projects).set({ settings: sql`${schema.projects.settings} || ${JSON.stringify(patch)}::jsonb` }).where(eq(schema.projects.id, projectId));
}

async function readSecrets(projectId: string): Promise<ProjectSecrets> {
  if (!hasDatabase()) return { shareSecret: fixtureSecret, updatePasswordHash: fixtureLockHash };
  const rows = await db().select({ settings: schema.projects.settings }).from(schema.projects).where(eq(schema.projects.id, projectId)).limit(1);
  const s = rows[0]?.settings ?? {};
  let secret = typeof s.shareSecret === "string" && s.shareSecret.length >= 32 ? s.shareSecret : null;
  if (!secret) {
    secret = randomBytes(32).toString("hex");
    await mergeSettings(projectId, { shareSecret: secret });
  }
  const hash = s.updatePasswordHash;
  return { shareSecret: secret, updatePasswordHash: typeof hash === "string" && hash.length > 0 ? hash : null };
}

/** Per-project secret used to sign share and update cookies; created on first use and kept in settings. */
export async function shareSecret(project: ProjectSummary): Promise<string> {
  return (await readSecrets(project.id)).shareSecret;
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

// ---------- Update lock: a password before the data can be changed ----------
// Viewing stays open. Uploading a version, restoring or deleting one, deleting the project and changing the lock itself
// need the cookie a successful unlock sets. The cookie signs the current password hash, so changing the password
// invalidates every earlier unlock.

export const updateCookieName = (projectId: string) => `mupdate_${projectId}`;
const signUpdate = (projectId: string, secret: string, hash: string) => createHmac("sha256", secret).update(`update:${projectId}:${hash}`).digest("hex");
const updateCookie = (projectId: string, value: string, maxAge = 60 * 60 * 24 * 30) => `${updateCookieName(projectId)}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;

/** True when the project has no update password, or this request carries the cookie of a successful unlock. */
export async function hasUpdateAccess(projectId: string): Promise<boolean> {
  const { shareSecret: secret, updatePasswordHash } = await readSecrets(projectId);
  if (!updatePasswordHash) return true;
  const value = (await cookies()).get(updateCookieName(projectId))?.value;
  if (!value) return false;
  const expected = signUpdate(projectId, secret, updatePasswordHash);
  return value.length === expected.length && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

/** The answer of every data-changing route when the lock is on and the cookie is missing; the client prompts for the password and retries. */
export function lockedResponse(): Response {
  return Response.json({ error: "This dashboard's data is locked. Enter the update password to continue.", locked: true }, { status: 401 });
}

/** Checks the password and answers with the cookie that unlocks data changes on this browser for 30 days. */
export async function unlockUpdates(projectId: string, password: string | undefined): Promise<Response> {
  const { shareSecret: secret, updatePasswordHash } = await readSecrets(projectId);
  if (!updatePasswordHash) return Response.json({ ok: true });
  if (!password || !verifyPassword(password, updatePasswordHash)) return Response.json({ error: "That password is not right." }, { status: 401 });
  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", updateCookie(projectId, signUpdate(projectId, secret, updatePasswordHash)));
  return res;
}

/** Sets the update password, or removes it with null. Returns the Set-Cookie header that keeps the caller unlocked. */
export async function setUpdatePassword(projectId: string, password: string | null): Promise<string> {
  if (!hasDatabase()) throw new Error("The update lock needs a database.");
  const { shareSecret: secret } = await readSecrets(projectId);
  if (!password) {
    await db().update(schema.projects).set({ settings: sql`${schema.projects.settings} - 'updatePasswordHash'` }).where(eq(schema.projects.id, projectId));
    return updateCookie(projectId, "", 0);
  }
  const hash = hashPassword(password);
  await mergeSettings(projectId, { updatePasswordHash: hash });
  return updateCookie(projectId, signUpdate(projectId, secret, hash));
}

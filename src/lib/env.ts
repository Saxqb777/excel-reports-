export type EnvCheck = { key: string; purpose: string; present: boolean };

export function envChecks(): EnvCheck[] {
  const has = (k: string) => Boolean(process.env[k] && process.env[k]!.length > 0);
  return [
    { key: "DATABASE_URL", purpose: "Neon Postgres: projects, uploads, layouts", present: has("DATABASE_URL") },
    { key: "BLOB_READ_WRITE_TOKEN", purpose: "Vercel Blob: raw Excel files (falls back to Postgres until set)", present: has("BLOB_READ_WRITE_TOKEN") },
    { key: "ANTHROPIC_API_KEY", purpose: "Claude API: natural-language questions", present: has("ANTHROPIC_API_KEY") },
  ];
}

export async function pingDatabase(): Promise<{ ok: boolean; detail: string; ms: number }> {
  const url = process.env.DATABASE_URL;
  if (!url) return { ok: false, detail: "DATABASE_URL not set", ms: 0 };
  const t0 = Date.now();
  try {
    const { neon } = await import("@neondatabase/serverless");
    const sql = neon(url);
    const rows = (await sql`select version() as v, now() as t`) as { v: string; t: string }[];
    const v = rows[0]?.v?.split(" on ")[0] ?? "unknown";
    return { ok: true, detail: v, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
}

export function buildInfo() {
  return {
    sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? "local",
    env: process.env.VERCEL_ENV ?? "development",
    region: process.env.VERCEL_REGION ?? "local",
    deployedAt: new Date().toISOString(),
  };
}

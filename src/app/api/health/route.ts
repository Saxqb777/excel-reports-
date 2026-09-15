import { buildInfo, envChecks, pingDatabase } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = await pingDatabase();
  return Response.json({
    ok: true,
    build: buildInfo(),
    env: envChecks().map((c) => ({ key: c.key, present: c.present })),
    database: db,
  });
}

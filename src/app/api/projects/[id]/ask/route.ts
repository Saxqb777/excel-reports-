import type { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getProjectById, getSnapshot } from "@/lib/data/projects";
import { askClaude } from "@/lib/intelligence/ask";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest, ctx: RouteContext<"/api/projects/[id]/ask">) {
  const { id } = await ctx.params;
  const project = await getProjectById(id);
  if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { question?: string };
  const question = String(body.question ?? "").trim().slice(0, 500);
  if (!question) return Response.json({ error: "Ask a question first." }, { status: 400 });
  const snapshot = await getSnapshot(project);
  if (!snapshot) return Response.json({ error: "No data uploaded yet" }, { status: 404 });
  try {
    const result = await askClaude(question, snapshot, project.name, project.layout.dateField);
    return Response.json(result);
  } catch (e) {
    console.error(e);
    if (e instanceof Anthropic.AuthenticationError) return Response.json({ error: "The Claude API key is invalid." }, { status: 500 });
    if (e instanceof Anthropic.RateLimitError) return Response.json({ error: "The Claude API is rate limited. Try again in a moment." }, { status: 429 });
    if (e instanceof Anthropic.APIError) return Response.json({ error: `Claude API error ${e.status}: ${e.message}` }, { status: 502 });
    return Response.json({ error: e instanceof Error ? e.message : "The question could not be answered." }, { status: 422 });
  }
}

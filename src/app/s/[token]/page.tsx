import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getProjectByShareToken } from "@/lib/data/projects";
import { ShareView, shareMetadata } from "./ShareView";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/s/[token]">) {
  const { token } = await props.params;
  const project = await getProjectByShareToken(token);
  return shareMetadata(project, (await headers()).get("host"));
}

export default async function SharePage(props: PageProps<"/s/[token]">) {
  const { token } = await props.params;
  const project = await getProjectByShareToken(token);
  if (!project) notFound();
  return <ShareView project={project} searchParams={await props.searchParams} />;
}

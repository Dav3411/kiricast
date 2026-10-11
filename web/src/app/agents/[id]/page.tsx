import type { Metadata } from "next";
import AgentClient from "./AgentClient";

export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Agent · Kiricast",
  description: "Browse an agent on Kiricast.",
};

export default async function AgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AgentClient id={id} />;
}


import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";

export const runtime = "nodejs";

const GENERATOR_URL = process.env.GENERATOR_BASE_URL ?? "http://127.0.0.1:8787";

type ReqBody = {
  title?: string;
  setting?: string;
  situation?: string;
  core_emotion?: string;
  relationship_state?: string;
  tone?: string;
  agent1Id?: string;
  agent2Id?: string;
};

export async function POST(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const res = await fetch(`${GENERATOR_URL}/api/clips/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: body.title?.trim() ?? "",
        setting: body.setting?.trim() ?? "",
        situation: body.situation?.trim() ?? "",
        core_emotion: body.core_emotion?.trim() ?? "",
        relationship_state: body.relationship_state?.trim() ?? "",
        tone: body.tone?.trim() ?? "",
        agent1_id: body.agent1Id?.trim() ?? "",
        agent2_id: body.agent2Id?.trim() ?? "",
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: (data as Record<string, string>).detail ?? "Clip assist failed" },
        { status: res.status >= 400 ? res.status : 502 },
      );
    }

    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to reach generator" },
      { status: 502 },
    );
  }
}

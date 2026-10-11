import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const GENERATOR_URL = process.env.GENERATOR_BASE_URL ?? "http://127.0.0.1:8787";

type ReqBody = {
  userChoice?: string;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const { id: seriesId } = await params;

  let body: ReqBody = {};
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    // body is optional
  }

  // 시리즈 조회
  const { data: series, error: seriesErr } = await supabaseAdmin
    .from("clip_series")
    .select("*")
    .eq("id", seriesId)
    .eq("owner_id", userId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  if (!series.series_document || !series.arc_document) {
    return NextResponse.json({ error: "Series document not generated yet" }, { status: 400 });
  }

  const storyContext = Array.isArray(series.story_context) ? series.story_context : [];
  const nextEpisodeNumber = storyContext.length + 1;

  try {
    const res = await fetch(`${GENERATOR_URL}/api/series/generate-scenario`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent1_id: series.agent1_id,
        agent2_id: series.agent2_id,
        series_document: series.series_document,
        arc_document: series.arc_document,
        episode_number: nextEpisodeNumber,
        user_choice: body.userChoice?.trim() ?? null,
        story_context: storyContext,
        character_fsm: series.character_fsm ?? {},
        rolling_summary: series.rolling_summary ?? "",
        core_memory: series.core_memory ?? {},
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: (data as Record<string, string>).detail ?? "Scenario generation failed" },
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

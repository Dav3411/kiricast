import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { getEffectivePlanForUser } from "@/lib/subscriptionPlan";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isNonEmpty } from "@/lib/serverUtils";

export const runtime = "nodejs";

type ReqBody = {
  agent1Id?: string;
  agent2Id?: string;
  title?: string;
  setting?: string;
  situation?: string;
  core_emotion?: string;
  relationship_state?: string;
  tone?: string;
  /** For this clip draft, how many script generations already done (0 = first). Used for plan limit. */
  scriptGenerateCount?: number;
  /** 시리즈 연속 클립: series ID */
  seriesId?: string;
  episodeNumber?: number;
  arcPhase?: string;
};

export async function POST(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const plan = await getEffectivePlanForUser(userId);
  const isFreePlan = plan == null;
  const limit = isFreePlan ? 1 : plan.scriptGenerateLimitPerClip;
  if (limit <= 0) {
    return NextResponse.json(
      { error: "Subscribe to a plan to generate scripts." },
      { status: 403 }
    );
  }

  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const count = Number(body.scriptGenerateCount);
  if (!Number.isInteger(count) || count < 0 || count >= limit) {
    return NextResponse.json(
      { error: `Script generate limit for this clip is ${limit}. Upgrade plan for more.` },
      { status: 403 }
    );
  }

  const agent1Id = body.agent1Id?.trim() ?? "";
  const agent2Id = body.agent2Id?.trim() ?? "";
  const title = body.title?.trim() ?? "";
  const setting = body.setting?.trim() ?? "";
  const situation = body.situation?.trim() ?? "";
  const core_emotion = body.core_emotion?.trim() ?? "";
  const relationship_state = body.relationship_state?.trim() ?? "";
  const tone = body.tone?.trim() ?? "";

  if (!isNonEmpty(agent1Id) || !isNonEmpty(agent2Id) || !isNonEmpty(title)) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (!isNonEmpty(setting) && !isNonEmpty(situation) && !isNonEmpty(core_emotion) && !isNonEmpty(relationship_state)) {
    return NextResponse.json({ error: "At least one of setting, situation, core emotion, or relationship state is required" }, { status: 400 });
  }
  if (title.length > 60) {
    return NextResponse.json({ error: "Title must be 60 characters or less" }, { status: 400 });
  }
  if (setting.length > 300) {
    return NextResponse.json({ error: "Setting must be 300 characters or less" }, { status: 400 });
  }
  if (situation.length > 300) {
    return NextResponse.json({ error: "Situation must be 300 characters or less" }, { status: 400 });
  }
  if (core_emotion.length > 150) {
    return NextResponse.json({ error: "Core emotion must be 150 characters or less" }, { status: 400 });
  }
  if (relationship_state.length > 150) {
    return NextResponse.json({ error: "Relationship state must be 150 characters or less" }, { status: 400 });
  }
  if (tone.length > 100) {
    return NextResponse.json({ error: "Tone must be 100 characters or less" }, { status: 400 });
  }
  if (agent1Id === agent2Id) {
    return NextResponse.json({ error: "Agents must be different" }, { status: 400 });
  }

  // 시리즈 연속 컨텍스트 조회
  const seriesId = body.seriesId?.trim() ?? "";
  type SeriesPayloadFields = {
    series_id?: string;
    episode_number?: number;
    arc_phase?: string;
    series_context?: unknown[];
    total_episodes?: number;
    relationship_context?: string;
  };
  let seriesFields: SeriesPayloadFields = {};

  if (isNonEmpty(seriesId)) {
    const { data: series } = await supabaseAdmin
      .from("clip_series")
      .select("*")
      .eq("id", seriesId)
      .eq("owner_id", userId)
      .single();

    if (series) {
      seriesFields = {
        series_id: seriesId,
        episode_number: body.episodeNumber ?? 1,
        series_context: Array.isArray(series.story_context) ? series.story_context : [],
        total_episodes: series.total_episodes,
        relationship_context: series.relationship_context ?? "",
      };
    }
  }

  const { data, error: insertErr } = await supabaseAdmin
    .from("script_generation_jobs")
    .insert({
      user_id: userId,
      status: "queued",
      progress: 0,
      payload: {
        agent1_id: agent1Id,
        agent2_id: agent2Id,
        title,
        setting,
        situation,
        core_emotion,
        relationship_state,
        tone,
        ...seriesFields,
      },
      updated_at: new Date().toISOString(),
      source: process.env.JOB_SOURCE || "production",
    })
    .select("id")
    .single();

  if (insertErr || !data) {
    return NextResponse.json({ error: "Failed to create script job" }, { status: 500 });
  }

  return NextResponse.json({ scriptJobId: data.id });
}

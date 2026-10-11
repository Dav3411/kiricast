import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/**
 * POST: 시리즈의 다음 에피소드 생성 준비.
 * 시리즈 context, 다음 episode_number, 잠긴 agents/setting, 시리즈 문서/아크 문서, 3계층 메모리 반환.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const { id: seriesId } = await params;

  const { data: series, error: seriesErr } = await supabaseAdmin
    .from("clip_series")
    .select("*")
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  const storyContext = Array.isArray(series.story_context) ? series.story_context : [];

  // 실제 에피소드 수 기반으로 다음 에피소드 번호 계산
  const { count: episodeCount } = await supabaseAdmin
    .from("clips")
    .select("id", { count: "exact", head: true })
    .eq("series_id", seriesId);

  const nextEpisodeNumber = Math.max(storyContext.length + 1, (episodeCount ?? 0) + 1);

  // next_episode_options 정규화: 구 형식(배열) → 새 형식(객체)
  const rawOpts = series.next_episode_options;
  let nextEpisodeOptions: { forced_next_type: string | null; options: unknown[] };
  if (rawOpts && typeof rawOpts === "object" && !Array.isArray(rawOpts)) {
    const obj = rawOpts as Record<string, unknown>;
    nextEpisodeOptions = {
      forced_next_type: (obj.forced_next_type as string) ?? null,
      options: Array.isArray(obj.options) ? obj.options : [],
    };
  } else if (Array.isArray(rawOpts)) {
    nextEpisodeOptions = { forced_next_type: null, options: rawOpts };
  } else {
    nextEpisodeOptions = { forced_next_type: null, options: [] };
  }

  return NextResponse.json({
    seriesId: series.id,
    seriesTitle: series.title,
    agent1Id: series.agent1_id,
    agent2Id: series.agent2_id,
    setting: series.setting,
    relationshipContext: series.relationship_context,
    totalEpisodes: series.total_episodes,
    nextEpisodeNumber,
    storyContext,
    nextEpisodeOptions,
    // 시리즈 파이프라인 데이터
    seriesDocument: series.series_document ?? null,
    arcDocument: series.arc_document ?? null,
    rollingMemory: series.rolling_summary ?? "",
    coreMemory: series.core_memory ?? null,
    characterFsm: series.character_fsm ?? null,
    locked: series.locked ?? false,
  });
}

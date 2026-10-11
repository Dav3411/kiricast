import { NextResponse } from "next/server";
import { getUserIdFromToken } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/**
 * POST: 기존 클립에서 연속 에피소드 시작.
 * - 클립에 series_id가 있으면 → 그 시리즈의 다음 에피소드 정보 반환 (비로그인 OK)
 * - 클립에 series_id가 없으면 → 시리즈를 자동 생성하고 이 클립을 episode 1로 등록 → episode 2 정보 반환 (로그인 필요)
 *
 * 시리즈는 open-ended — 고정 에피소드 수 제한 없음.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const authHeader = req.headers.get("authorization") ?? "";
  const [, token] = authHeader.split(" ");
  const { userId } = await getUserIdFromToken(token || null);

  const { id: clipId } = await params;

  // 클립 조회
  const { data: clip, error: clipErr } = await supabaseAdmin
    .from("clips")
    .select("id, title, owner_id, agent1_id, agent2_id, series_id, episode_number")
    .eq("id", clipId)
    .single();

  if (clipErr || !clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }
  if (!clip.agent1_id || !clip.agent2_id) {
    return NextResponse.json({ error: "Clip has no agents" }, { status: 400 });
  }

  let seriesId = clip.series_id;

  // 시리즈가 없으면 자동 생성 (open-ended) — 로그인 필요
  if (!seriesId) {
    if (!userId) {
      return NextResponse.json({ error: "Login required" }, { status: 401 });
    }
    // 원래 클립의 job에서 setting 조회
    let clipSetting = "";
    const { data: job } = await supabaseAdmin
      .from("script_generation_jobs")
      .select("payload")
      .eq("clip_id", clipId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (job?.payload && typeof job.payload === "object") {
      const p = job.payload as Record<string, unknown>;
      clipSetting = (typeof p.setting === "string" ? p.setting : "").trim();
    }

    const { data: newSeries, error: seriesInsertErr } = await supabaseAdmin
      .from("clip_series")
      .insert({
        owner_id: userId,
        title: clip.title ?? "Untitled Series",
        agent1_id: clip.agent1_id,
        agent2_id: clip.agent2_id,
        setting: clipSetting,
        relationship_context: "",
        total_episodes: null,
        story_context: [],
        status: "in_progress",
      })
      .select("id")
      .single();

    if (seriesInsertErr || !newSeries) {
      return NextResponse.json({ error: "Failed to create series" }, { status: 500 });
    }
    seriesId = newSeries.id;

    // 기존 클립을 episode 1로 소급 등록
    await supabaseAdmin
      .from("clips")
      .update({
        series_id: seriesId,
        episode_number: 1,
      })
      .eq("id", clipId);
  }

  // 시리즈 정보 조회
  const { data: series, error: seriesFetchErr } = await supabaseAdmin
    .from("clip_series")
    .select("*")
    .eq("id", seriesId)
    .single();

  if (seriesFetchErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 500 });
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
    // 새 형식: {forced_next_type, options}
    const obj = rawOpts as Record<string, unknown>;
    nextEpisodeOptions = {
      forced_next_type: (obj.forced_next_type as string) ?? null,
      options: Array.isArray(obj.options) ? obj.options : [],
    };
  } else if (Array.isArray(rawOpts)) {
    // 레거시 배열 형식
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
    totalEpisodes: series.total_episodes,  // null for open-ended
    nextEpisodeNumber,
    storyContext,
    nextEpisodeOptions,
  });
}

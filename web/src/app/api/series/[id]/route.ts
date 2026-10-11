import { NextResponse } from "next/server";
import { getUserIdFromToken, requireUserId } from "@/lib/authServer";
import { requireCreditsAdmin } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { deleteObjectFromR2 } from "@/lib/r2";

export const runtime = "nodejs";

/** GET: 시리즈 상세 (에피소드 목록 포함) — 누구나 조회 가능 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: seriesId } = await params;

  // 인증은 선택 — 소유자 여부 판별에만 사용
  const authHeader = req.headers.get("authorization") ?? "";
  const [, token] = authHeader.split(" ");
  const { userId } = await getUserIdFromToken(token || null);

  const { data: series, error: seriesErr } = await supabaseAdmin
    .from("clip_series")
    .select("*")
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  const { data: episodes } = await supabaseAdmin
    .from("clips")
    .select("id, title, duration_sec, episode_number, arc_phase, episode_type, published_at")
    .eq("series_id", seriesId)
    .order("episode_number", { ascending: true });

  const isOwner = !!userId && series.owner_id === userId;

  return NextResponse.json({
    series: {
      id: series.id,
      title: series.title,
      agent1Id: series.agent1_id,
      agent2Id: series.agent2_id,
      setting: series.setting,
      relationshipContext: series.relationship_context,
      totalEpisodes: series.total_episodes,
      storyContext: series.story_context,
      status: series.status,
      locked: series.locked ?? false,
      seriesDocument: series.series_document ?? null,
      arcDocument: series.arc_document ?? null,
      rollingMemory: series.rolling_summary ?? "",
      coreMemory: series.core_memory ?? null,
      characterFsm: series.character_fsm ?? null,
      createdAt: series.created_at,
      ownerId: series.owner_id,
      isOwner,
    },
    episodes: (episodes ?? []).map((ep) => ({
      id: ep.id,
      title: ep.title,
      durationSec: ep.duration_sec,
      episodeNumber: ep.episode_number,
      arcPhase: ep.arc_phase,
      episodeType: ep.episode_type,
      publishedAt: ep.published_at,
    })),
  });
}

/** DELETE: 시리즈 삭제 (소속 에피소드 클립의 R2 파일도 함께 삭제) */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const { id: seriesId } = await params;

  // 소유권 확인
  const { data: series, error: seriesErr } = await supabaseAdmin
    .from("clip_series")
    .select("id, owner_id")
    .eq("id", seriesId)
    .single();

  if (seriesErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  const isOwner = series.owner_id === userId;
  if (!isOwner) {
    const admin = await requireCreditsAdmin(req);
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }
  }

  // 소속 에피소드 클립 조회 → R2 파일 삭제 + 클립 삭제
  const { data: clips } = await supabaseAdmin
    .from("clips")
    .select("id, r2_key, transcript_key, video_key")
    .eq("series_id", seriesId);

  const bucket = process.env.R2_BUCKET;
  if (bucket && clips && clips.length > 0) {
    for (const clip of clips) {
      const keys = [clip.r2_key, clip.transcript_key, clip.video_key].filter(Boolean) as string[];
      for (const key of keys) {
        try { await deleteObjectFromR2({ bucket, key }); } catch { /* best-effort */ }
      }
    }
    // 클립 레코드 삭제
    await supabaseAdmin
      .from("clips")
      .delete()
      .eq("series_id", seriesId);
  }

  // 관련 잡 삭제 (payload->series_id 기준)
  await supabaseAdmin
    .from("jobs")
    .delete()
    .filter("payload->>series_id", "eq", seriesId);

  // 시리즈 삭제
  const { error: deleteErr } = await supabaseAdmin
    .from("clip_series")
    .delete()
    .eq("id", seriesId);

  if (deleteErr) {
    return NextResponse.json({ error: "Failed to delete series" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

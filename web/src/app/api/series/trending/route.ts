import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getR2PlaybackUrl } from "@/lib/clipDb";

export const runtime = "nodejs";

/**
 * GET /api/series/trending — 공개 API: 트렌딩 시리즈 목록
 * 시리즈에 속한 클립들의 총 조회수로 랭킹.
 * ?q=검색어 로 시리즈 제목 검색 가능.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") ?? "10")), 30);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const languagesParam = url.searchParams.get("languages")?.trim() ?? "";

  // 1. 공개된(ready + published) 클립 중 series_id가 있는 것들 집계
  let clipQuery = supabaseAdmin
    .from("clips")
    .select("series_id, view_count")
    .eq("status", "ready")
    .eq("is_hidden", false)
    .not("published_at", "is", null)
    .not("series_id", "is", null);

  if (languagesParam) {
    const languages = languagesParam.split(",").map((l) => l.trim()).filter(Boolean);
    if (languages.length > 0) {
      clipQuery = clipQuery.in("language", languages);
    }
  }

  const { data: clips, error: clipErr } = await clipQuery;

  if (clipErr || !clips) {
    return NextResponse.json({ error: "Failed to load clips" }, { status: 500 });
  }

  // 시리즈별 총 조회수 + 에피소드 수 집계
  const seriesStats = new Map<string, { totalViews: number; episodeCount: number }>();
  for (const clip of clips) {
    const sid = clip.series_id as string;
    const stats = seriesStats.get(sid) ?? { totalViews: 0, episodeCount: 0 };
    stats.totalViews += Number(clip.view_count ?? 0);
    stats.episodeCount += 1;
    seriesStats.set(sid, stats);
  }

  // 검색 모드: 제목으로 시리즈 검색 (에피소드 1개 이상)
  // 트렌딩 모드: 에피소드 2개 이상
  const minEpisodes = query ? 1 : 2;
  const qualified = [...seriesStats.entries()]
    .filter(([, s]) => s.episodeCount >= minEpisodes)
    .sort((a, b) => b[1].totalViews - a[1].totalViews);

  if (qualified.length === 0) {
    return NextResponse.json({ series: [] });
  }

  // 2. 시리즈 메타데이터 조회 (검색 시 ilike 필터 적용)
  const allSeriesIds = qualified.map(([id]) => id);

  let seriesQuery = supabaseAdmin
    .from("clip_series")
    .select("id, title, agent1_id, agent2_id, setting, created_at")
    .in("id", allSeriesIds);

  if (query) {
    seriesQuery = seriesQuery.ilike("title", `%${query}%`);
  }

  const { data: seriesRows } = await seriesQuery;

  // 매칭된 시리즈 ID만 필터하고 limit 적용
  const matchedIds = new Set((seriesRows ?? []).map((s) => s.id));
  const finalQualified = qualified
    .filter(([id]) => matchedIds.has(id))
    .slice(0, limit);

  if (finalQualified.length === 0) {
    return NextResponse.json({ series: [] });
  }

  const seriesMap = new Map<string, typeof seriesRows extends (infer T)[] | null ? T : never>();
  for (const s of seriesRows ?? []) {
    seriesMap.set(s.id, s);
  }

  // 3. 에이전트 이미지 조회
  const agentIds = new Set<string>();
  for (const s of seriesRows ?? []) {
    if (s.agent1_id) agentIds.add(s.agent1_id);
    if (s.agent2_id) agentIds.add(s.agent2_id);
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const agentImageMap = new Map<string, string>();
  if (agentIds.size > 0) {
    const { data: agentRows } = await supabaseAdmin
      .from("agents")
      .select("id, image_url, image_key")
      .in("id", [...agentIds]);
    for (const a of agentRows ?? []) {
      if (a.image_url) {
        agentImageMap.set(a.id, a.image_url);
      } else if (a.image_key) {
        agentImageMap.set(a.id, `/api/agents/${encodeURIComponent(a.id)}/avatar`);
      } else if (UUID_RE.test(a.id)) {
        agentImageMap.set(a.id, `/api/agents/${encodeURIComponent(a.id)}/avatar`);
      } else {
        agentImageMap.set(a.id, `/agents/images/${a.id}.png`);
      }
    }
  }
  // DB에 없는 에이전트(프리셋 등)도 폴백 이미지 제공
  for (const id of agentIds) {
    if (!agentImageMap.has(id)) {
      agentImageMap.set(id, UUID_RE.test(id)
        ? `/api/agents/${encodeURIComponent(id)}/avatar`
        : `/agents/images/${id}.png`);
    }
  }

  // 4. 에피소드 1 배경 이미지 조회
  const finalSeriesIds = finalQualified.map(([id]) => id);
  const ep1BgMap = new Map<string, string>();
  if (finalSeriesIds.length > 0) {
    const { data: ep1Rows } = await supabaseAdmin
      .from("clips")
      .select("series_id, background_image_key")
      .in("series_id", finalSeriesIds)
      .eq("episode_number", 1)
      .not("background_image_key", "is", null);
    for (const row of ep1Rows ?? []) {
      if (row.series_id && row.background_image_key) {
        const url = getR2PlaybackUrl(row.background_image_key, 3600);
        if (url) ep1BgMap.set(row.series_id, url);
      }
    }
  }

  // 5. 조합하여 반환
  const series = finalQualified
    .map(([id, stats]) => {
      const meta = seriesMap.get(id);
      if (!meta) return null;
      return {
        id: meta.id,
        title: meta.title,
        agent1Id: meta.agent1_id,
        agent2Id: meta.agent2_id,
        agent1ImageUrl: agentImageMap.get(meta.agent1_id) ?? null,
        agent2ImageUrl: agentImageMap.get(meta.agent2_id) ?? null,
        setting: meta.setting,
        episodeCount: stats.episodeCount,
        totalViews: stats.totalViews,
        createdAt: meta.created_at,
        ep1BackgroundUrl: ep1BgMap.get(id) ?? null,
      };
    })
    .filter(Boolean);

  return NextResponse.json({ series });
}

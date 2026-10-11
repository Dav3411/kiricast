import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getUserIdFromToken, requireUserId } from "@/lib/authServer";
import { createUploadUrl } from "@/lib/r2";
import { type ClipRow, clipRowToPayload, normalizeLimit } from "@/lib/clipDb";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = normalizeLimit(url.searchParams.get("limit"), 100);
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0);
  const includeDebug = url.searchParams.get("debug") === "1";
  const sort = (url.searchParams.get("sort") ?? "new").toLowerCase();

  const q = url.searchParams.get("q")?.trim() ?? "";
  const languagesParam = url.searchParams.get("languages")?.trim() ?? "";

  let baseQuery = supabaseAdmin
    .from("clips")
    .select(
      "id, title, duration_sec, stream_id, r2_key, transcript_key, video_key, background_image_key, status, published_at, view_count, owner_id, like_count, series_id, episode_number, arc_phase, language"
    )
    .eq("status", "ready")
    .eq("is_hidden", false)
    .not("published_at", "is", null);

  if (q) {
    baseQuery = baseQuery.ilike("title", `%${q}%`);
  }

  if (languagesParam) {
    const languages = languagesParam.split(",").map((l) => l.trim()).filter(Boolean);
    if (languages.length > 0) {
      baseQuery = baseQuery.in("language", languages);
    }
  }

  let query = baseQuery;
  if (sort === "random") {
    // 랜덤 정렬: 최근 500개 중에서 랜덤하게 선택 (성능 최적화)
    query = query.order("published_at", { ascending: false }).limit(500);
  } else {
    query = query.order("published_at", { ascending: false });
  }

  const { data: clipRows, error } = await (sort === "trending"
    ? query.range(0, 499)
    : sort === "random"
    ? query
    : query.range(offset, offset + limit - 1));

  if (error) {
    return NextResponse.json({ error: "Failed to load clips" }, { status: 500 });
  }

  let rows = (clipRows ?? []) as ClipRow[];

  if (sort === "random") {
    // Fisher-Yates 셔플 알고리즘으로 랜덤 정렬
    for (let i = rows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    }
    rows = rows.slice(offset, offset + limit);
  } else if (sort === "trending") {
    const viewsByClip = new Map<string, number>();
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const dayFrom = sevenDaysAgo.toISOString().slice(0, 10);
    type DailyRow = { clip_id: string; views: number };
    const { data: dailyRows, error: dailyErr } = await supabaseAdmin
      .from("clip_views_daily")
      .select("clip_id, views")
      .gte("day", dayFrom);
    if (!dailyErr && dailyRows?.length) {
      for (const row of (dailyRows ?? []) as DailyRow[]) {
        const id = row.clip_id;
        viewsByClip.set(id, (viewsByClip.get(id) ?? 0) + Number(row.views ?? 0));
      }
    } else {
      const thisMonth = new Date().toISOString().slice(0, 7);
      const { data: monthly } = await supabaseAdmin
        .from("clip_views_monthly")
        .select("clip_id, valid_views")
        .eq("month", thisMonth);
      type MonthlyRow = { clip_id: string; valid_views: number };
      for (const row of (monthly ?? []) as MonthlyRow[]) {
        viewsByClip.set(row.clip_id, Number(row.valid_views ?? 0));
      }
    }
    rows = [...rows].sort((a, b) => (viewsByClip.get(b.id) ?? 0) - (viewsByClip.get(a.id) ?? 0));
    rows = rows.slice(offset, offset + limit);
  }

  const clipIds = rows.map((r) => r.id);
  let likedClipIds: Set<string> | null = null;
  if (clipIds.length > 0) {
    const authHeader = req.headers.get("authorization") ?? "";
    const [, token] = authHeader.split(" ");
    const { userId } = await getUserIdFromToken(token || null);
    if (userId) {
      const { data: myLikes } = await supabaseAdmin
        .from("clip_likes")
        .select("clip_id")
        .eq("user_id", userId)
        .in("clip_id", clipIds);
      type LikeRow = { clip_id: string };
      likedClipIds = new Set(((myLikes ?? []) as LikeRow[]).map((r) => r.clip_id));
    }
  }

  // Batch fetch series titles for clips that belong to a series
  const seriesIds = [...new Set(rows.filter((r) => r.series_id).map((r) => r.series_id!))];
  const seriesTitleMap = new Map<string, string>();
  const seriesOwnerMap = new Map<string, string>();
  if (seriesIds.length > 0) {
    const { data: seriesRows } = await supabaseAdmin
      .from("clip_series")
      .select("id, title, owner_id")
      .in("id", seriesIds);
    for (const s of (seriesRows ?? []) as { id: string; title: string | null; owner_id: string | null }[]) {
      if (s.title) seriesTitleMap.set(s.id, s.title);
      if (s.owner_id) seriesOwnerMap.set(s.id, s.owner_id);
    }
  }

  const clips = rows.map((clip: ClipRow) => {
    const payload = clipRowToPayload(clip, { liked: likedClipIds ? likedClipIds.has(clip.id) : false });
    if (clip.series_id) {
      if (seriesTitleMap.has(clip.series_id)) {
        (payload as Record<string, unknown>).seriesTitle = seriesTitleMap.get(clip.series_id);
      }
      if (seriesOwnerMap.has(clip.series_id)) {
        (payload as Record<string, unknown>).seriesOwnerId = seriesOwnerMap.get(clip.series_id);
      }
    }
    return payload;
  });

  if (!includeDebug) {
    return NextResponse.json({ clips });
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const projectRef = supabaseUrl
    .replace(/^https?:\/\//, "")
    .replace(/\.supabase\.co.*$/i, "");

  return NextResponse.json({
    clips,
    debug: {
      projectRef,
      supabaseUrl,
      limit,
      offset,
      sort,
      total: clips.length,
      ids: clips.map((clip) => clip.id),
    },
  });
}

/* ------------------------------------------------------------------ */
/*  POST /api/clips — 새 클립 생성 (업로드 URL 발급)                    */
/* ------------------------------------------------------------------ */

type InitBody = {
  title?: string;
  durationSec?: number;
  mimeType?: string;
};

function normalizeExt(mimeType?: string) {
  if (!mimeType) return "mp4";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("quicktime")) return "mov";
  if (mimeType.includes("webm")) return "webm";
  return "mp4";
}

export async function POST(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  let body: InitBody;
  try {
    body = (await req.json()) as InitBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bucket = process.env.R2_BUCKET;
  if (!bucket) {
    return NextResponse.json({ error: "Missing R2_BUCKET" }, { status: 500 });
  }

  const ext = normalizeExt(body.mimeType);
  const r2Key = `clips/${userId}/${crypto.randomUUID()}.${ext}`;

  const { data, error: insertErr } = await supabaseAdmin
    .from("clips")
    .insert({
      owner_id: userId,
      title: body.title ?? null,
      duration_sec: body.durationSec ?? null,
      r2_key: r2Key,
      status: "uploading",
      view_count: 0,
      mime_type: body.mimeType ?? null,
    })
    .select("id")
    .single();

  if (insertErr || !data) {
    return NextResponse.json({ error: "Failed to create clip" }, { status: 500 });
  }

  const { url, expiresInSec } = await createUploadUrl({
    bucket,
    key: r2Key,
    contentType: body.mimeType,
    expiresInSec: 900,
  });

  return NextResponse.json({
    clipId: data.id,
    r2Key,
    uploadUrl: url,
    expiresInSec,
  });
}

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getUserIdFromToken, requireUserId } from "@/lib/authServer";
import { requireCreditsAdmin } from "@/lib/adminAuth";
import { deleteObjectFromR2 } from "@/lib/r2";
import { type ClipRow, clipRowToPayload } from "@/lib/clipDb";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id?: string }> }
) {
  const params = await context.params;
  const id = params?.id?.trim() ?? "";
  if (!id) {
    return NextResponse.json({ error: "Missing clip id" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("clips")
    .select(
      "id, title, duration_sec, stream_id, r2_key, transcript_key, video_key, background_image_key, status, published_at, owner_id, like_count, series_id, episode_number, arc_phase, language"
    )
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  const clip = data as ClipRow;
  if (clip.status !== "ready" || !clip.published_at) {
    return NextResponse.json({ error: "Clip not available" }, { status: 404 });
  }

  const authHeader = _req.headers.get("authorization") ?? "";
  const [, token] = authHeader.split(" ");
  const { userId } = await getUserIdFromToken(token || null);
  let liked = false;
  if (userId) {
    const { data: likeRow } = await supabaseAdmin
      .from("clip_likes")
      .select("clip_id")
      .eq("clip_id", clip.id)
      .eq("user_id", userId)
      .maybeSingle();
    liked = !!likeRow;
  }

  // 시리즈 제목 + 이전/다음 에피소드 clip ID 조회
  let seriesTitle: string | undefined;
  let seriesOwnerId: string | undefined;
  let prevEpisodeClipId: string | undefined;
  let nextEpisodeClipId: string | undefined;
  if (clip.series_id && clip.episode_number) {
    const seriesRes = await supabaseAdmin
      .from("clip_series")
      .select("title, owner_id")
      .eq("id", clip.series_id)
      .maybeSingle();
    seriesTitle = seriesRes.data?.title ?? undefined;
    seriesOwnerId = seriesRes.data?.owner_id ?? undefined;

    const [prevRes, nextRes] = await Promise.all([
      supabaseAdmin
        .from("clips")
        .select("id")
        .eq("series_id", clip.series_id)
        .eq("episode_number", clip.episode_number - 1)
        .eq("status", "ready")
        .maybeSingle(),
      supabaseAdmin
        .from("clips")
        .select("id")
        .eq("series_id", clip.series_id)
        .eq("episode_number", clip.episode_number + 1)
        .eq("status", "ready")
        .maybeSingle(),
    ]);
    prevEpisodeClipId = prevRes.data?.id ?? undefined;
    nextEpisodeClipId = nextRes.data?.id ?? undefined;
  }

  return NextResponse.json({
    clip: {
      ...clipRowToPayload(clip, { liked }),
      seriesTitle,
      seriesOwnerId,
      prevEpisodeClipId,
      nextEpisodeClipId,
    },
  });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id?: string }> }
) {
  const { error: authError, userId } = await requireUserId(req);
  if (authError || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const id = params?.id?.trim() ?? "";
  if (!id) {
    return NextResponse.json({ error: "Missing clip id" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from("clips")
    .select("id, owner_id, r2_key, transcript_key, video_key, background_image_key, series_id")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  const isOwner = data.owner_id === userId;
  if (!isOwner) {
    const admin = await requireCreditsAdmin(req);
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }
  }

  // Prevent deleting clips that belong to another user's series
  if (isOwner && data.series_id) {
    const { data: series } = await supabaseAdmin
      .from("clip_series")
      .select("owner_id")
      .eq("id", data.series_id)
      .maybeSingle();
    if (series && series.owner_id !== userId) {
      return NextResponse.json(
        { error: "Cannot delete a clip in another user's series" },
        { status: 403 }
      );
    }
  }

  const bucket = process.env.R2_BUCKET;
  if (bucket) {
    const keysToDelete = [data.r2_key, data.transcript_key, data.video_key, data.background_image_key].filter(Boolean) as string[];
    for (const key of keysToDelete) {
      try {
        await deleteObjectFromR2({ bucket, key });
      } catch {
        // best-effort deletion
      }
    }
  }

  const { error: deleteError } = await supabaseAdmin
    .from("clips")
    .delete()
    .eq("id", id);

  if (deleteError) {
    return NextResponse.json({ error: "Failed to delete clip" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}


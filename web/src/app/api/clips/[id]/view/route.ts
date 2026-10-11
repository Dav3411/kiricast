import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/** 계정당 24시간 내 최대 유효 조회 가능 클립 수 (리워드 어뷰징 방지) */
const MAX_VIEWS_PER_USER_PER_24H = 200;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error: authErr, userId: viewerId } = await requireUserId(req);
  if (authErr || !viewerId) {
    return NextResponse.json({ error: "Sign in to count view" }, { status: 401 });
  }

  const { id: clipId } = await params;
  if (!clipId) {
    return NextResponse.json({ error: "Missing clip id" }, { status: 400 });
  }

  // 클립 존재 및 소유자 확인 (자기 클립 조회는 리워드에 카운트하지 않음)
  const { data: clip, error: clipErr } = await supabaseAdmin
    .from("clips")
    .select("id, owner_id, status, published_at")
    .eq("id", clipId)
    .single();

  if (clipErr || !clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }
  if (clip.status !== "ready" || !clip.published_at) {
    return NextResponse.json({ error: "Clip not available" }, { status: 404 });
  }

  const ownerId = clip.owner_id as string | null;
  if (ownerId && ownerId === viewerId) {
    return NextResponse.json({ ok: true, counted: false });
  }

  // 24시간 내 동일 계정·동일 클립 재조회 여부
  const { data: existing } = await supabaseAdmin
    .from("clip_view_records")
    .select("last_viewed_at")
    .eq("viewer_id", viewerId)
    .eq("clip_id", clipId)
    .maybeSingle();

  const now = new Date();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (existing?.last_viewed_at && new Date(existing.last_viewed_at) > windowStart) {
    return NextResponse.json({ ok: true, counted: false });
  }

  // 어뷰징 방지: 계정당 24시간 내 유효 조회 상한
  const { count, error: countErr } = await supabaseAdmin
    .from("clip_view_records")
    .select("viewer_id", { count: "exact", head: true })
    .eq("viewer_id", viewerId)
    .gte("last_viewed_at", windowStart.toISOString());

  if (!countErr && count != null && count >= MAX_VIEWS_PER_USER_PER_24H) {
    return NextResponse.json(
      { error: "Daily view limit reached" },
      { status: 429 }
    );
  }

  // 기록 갱신 후 조회수 증가
  const { error: upsertErr } = await supabaseAdmin
    .from("clip_view_records")
    .upsert(
      {
        viewer_id: viewerId,
        clip_id: clipId,
        last_viewed_at: now.toISOString(),
      },
      { onConflict: "viewer_id,clip_id" }
    );

  if (upsertErr) {
    return NextResponse.json({ error: "Failed to record view" }, { status: 500 });
  }

  const { error } = await supabaseAdmin.rpc("increment_clip_view", {
    clip_id: clipId,
  });
  if (error) {
    return NextResponse.json({ error: "Failed to record view" }, { status: 500 });
  }

  const month = now.toISOString().slice(0, 7);
  const { error: monthlyErr } = await supabaseAdmin.rpc(
    "increment_clip_view_monthly",
    { month, clip_id: clipId }
  );
  if (monthlyErr) {
    return NextResponse.json({ error: "Failed to record monthly view" }, { status: 500 });
  }

  const { error: dailyErr } = await supabaseAdmin.rpc("increment_clip_view_daily", {
    p_clip_id: clipId,
  });
  if (dailyErr) {
    // clip_views_daily 테이블이 없을 수 있음 (마이그레이션 전)
  }

  return NextResponse.json({ ok: true, counted: true });
}

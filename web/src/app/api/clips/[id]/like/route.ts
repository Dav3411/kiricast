import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/** POST: 클립에 좋아요 (한 번만, 이미 눌렀으면 무시) */
export async function POST(
  _req: Request,
  context: { params: Promise<{ id?: string }> }
) {
  const { error: authError, userId } = await requireUserId(_req);
  if (authError || !userId) {
    return NextResponse.json({ error: authError ?? "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const clipId = params?.id?.trim() ?? "";
  if (!clipId) {
    return NextResponse.json({ error: "Missing clip id" }, { status: 400 });
  }

  const { error: clipErr } = await supabaseAdmin
    .from("clips")
    .select("id")
    .eq("id", clipId)
    .eq("status", "ready")
    .not("published_at", "is", null)
    .single();

  if (clipErr) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  await supabaseAdmin
    .from("clip_likes")
    .upsert({ clip_id: clipId, user_id: userId }, { onConflict: "clip_id,user_id" });

  const { data: clipRow } = await supabaseAdmin
    .from("clips")
    .select("like_count")
    .eq("id", clipId)
    .single();

  const likeCount = clipRow?.like_count != null ? Number(clipRow.like_count) : 0;
  return NextResponse.json({
    liked: true,
    likeCount,
  });
}

/** DELETE: 클립 좋아요 취소 */
export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id?: string }> }
) {
  const { error: authError, userId } = await requireUserId(_req);
  if (authError || !userId) {
    return NextResponse.json({ error: authError ?? "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const clipId = params?.id?.trim() ?? "";
  if (!clipId) {
    return NextResponse.json({ error: "Missing clip id" }, { status: 400 });
  }

  const { error: clipErr } = await supabaseAdmin
    .from("clips")
    .select("id")
    .eq("id", clipId)
    .eq("status", "ready")
    .not("published_at", "is", null)
    .single();

  if (clipErr) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  await supabaseAdmin
    .from("clip_likes")
    .delete()
    .eq("clip_id", clipId)
    .eq("user_id", userId);

  const { data: clipRow } = await supabaseAdmin
    .from("clips")
    .select("like_count")
    .eq("id", clipId)
    .single();

  const likeCount = clipRow?.like_count != null ? Number(clipRow.like_count) : 0;
  return NextResponse.json({
    liked: false,
    likeCount,
  });
}

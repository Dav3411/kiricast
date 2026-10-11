import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { type ClipRow, clipRowToPayload, normalizeLimit } from "@/lib/clipDb";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error: authErr } = await requireUserId(req);
  if (authErr) {
    return NextResponse.json({ error: authErr }, { status: 401 });
  }

  const { id: ownerId } = await params;
  if (!ownerId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  const url = new URL(req.url);
  const limit = normalizeLimit(url.searchParams.get("limit"), 24);

  const { data, error: fetchErr } = await supabaseAdmin
    .from("clips")
    .select(
      "id, title, duration_sec, stream_id, r2_key, transcript_key, video_key, background_image_key, status, published_at, view_count, owner_id, like_count"
    )
    .eq("owner_id", ownerId)
    .eq("status", "ready")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(limit);

  if (fetchErr) {
    return NextResponse.json({ error: "Failed to load clips" }, { status: 500 });
  }

  const clips = (data ?? []).map((clip: ClipRow) => clipRowToPayload(clip));

  return NextResponse.json({ clips });
}

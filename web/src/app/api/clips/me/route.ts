import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { type ClipRow, clipRowToPayload, normalizeLimit } from "@/lib/clipDb";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = normalizeLimit(url.searchParams.get("limit"));

  const { data, error: fetchErr } = await supabaseAdmin
    .from("clips")
    .select(
      "id, title, duration_sec, stream_id, r2_key, transcript_key, video_key, background_image_key, status, published_at, view_count, owner_id, like_count"
    )
    .eq("owner_id", userId)
    .order("published_at", { ascending: false })
    .limit(limit);

  if (fetchErr) {
    return NextResponse.json({ error: "Failed to load clips" }, { status: 500 });
  }

  const clips = (data ?? [])
    .filter((row: ClipRow) => row.status === "ready" && row.published_at)
    .map((clip: ClipRow) =>
      clipRowToPayload(clip, { preferStream: true, audioTtlSec: 300, transcriptTtlSec: 300 })
    );

  return NextResponse.json({ clips });
}


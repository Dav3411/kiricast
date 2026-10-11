import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createStreamJwt } from "@/lib/stream";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clipId } = await params;
  if (!clipId) {
    return NextResponse.json({ error: "Missing clip id" }, { status: 400 });
  }

  const { data: clip, error: clipErr } = await supabaseAdmin
    .from("clips")
    .select("id, stream_id, status")
    .eq("id", clipId)
    .single();

  if (clipErr || !clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }
  if (clip.status !== "ready" || !clip.stream_id) {
    return NextResponse.json({ error: "Clip not ready" }, { status: 409 });
  }

  const signingKey = process.env.STREAM_SIGNING_KEY;
  const signingKeyId = process.env.STREAM_SIGNING_KEY_ID;
  const baseUrl = process.env.STREAM_BASE_URL;

  if (!signingKey || !baseUrl) {
    return NextResponse.json(
      { error: "Missing STREAM_SIGNING_KEY or STREAM_BASE_URL" },
      { status: 500 }
    );
  }

  const { token, exp } = createStreamJwt({
    streamId: clip.stream_id,
    signingKey,
    signingKeyId,
    ttlSec: 3600,
  });

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const playbackUrl = `${normalizedBase}/${clip.stream_id}/manifest/video.m3u8?token=${token}`;

  return NextResponse.json({ playbackUrl, exp });
}

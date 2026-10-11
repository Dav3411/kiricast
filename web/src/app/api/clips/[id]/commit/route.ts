import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { signMediaUrl } from "@/lib/mediaSigner";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const { id: clipId } = await params;
  if (!clipId) {
    return NextResponse.json({ error: "Missing clip id" }, { status: 400 });
  }

  const { data: clip, error: clipErr } = await supabaseAdmin
    .from("clips")
    .select("id, owner_id, r2_key, status")
    .eq("id", clipId)
    .single();

  if (clipErr || !clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }
  if (clip.owner_id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const secret = process.env.MEDIA_TOKEN_SECRET;
  const mediaBaseUrl = process.env.MEDIA_BASE_URL;
  if (!secret || !mediaBaseUrl) {
    return NextResponse.json(
      { error: "Missing MEDIA_TOKEN_SECRET or MEDIA_BASE_URL" },
      { status: 500 }
    );
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.STREAM_API_TOKEN;
  if (!accountId || !apiToken) {
    return NextResponse.json(
      { error: "Missing CLOUDFLARE_ACCOUNT_ID or STREAM_API_TOKEN" },
      { status: 500 }
    );
  }

  const { url: sourceUrl } = signMediaUrl({
    objectPath: clip.r2_key,
    secret,
    mediaBaseUrl,
    ttlSec: 900,
  });

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/copy`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: sourceUrl,
        meta: { clipId: clip.id },
        requireSignedURLs: true,
      }),
    }
  );

  const payload = await res.json();
  if (!res.ok || !payload?.success) {
    return NextResponse.json(
      { error: "Failed to create stream", details: payload?.errors ?? [] },
      { status: 500 }
    );
  }

  const streamId = payload.result?.uid as string | undefined;
  const durationSec = payload.result?.duration as number | undefined;

  if (!streamId) {
    return NextResponse.json({ error: "Missing stream id" }, { status: 500 });
  }

  const { error: updateErr } = await supabaseAdmin
    .from("clips")
    .update({
      stream_id: streamId,
      status: "ready",
      duration_sec: durationSec ?? null,
      published_at: new Date().toISOString(),
    })
    .eq("id", clip.id);

  if (updateErr) {
    return NextResponse.json({ error: "Failed to update clip" }, { status: 500 });
  }

  return NextResponse.json({ clipId: clip.id, streamId, status: "ready" });
}

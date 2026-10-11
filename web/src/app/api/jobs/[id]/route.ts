import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { signMediaUrl } from "@/lib/mediaSigner";
import { createStreamJwt } from "@/lib/stream";

export const runtime = "nodejs";

function getStreamPlaybackUrl(streamId: string) {
  const signingKey = process.env.STREAM_SIGNING_KEY;
  const signingKeyId = process.env.STREAM_SIGNING_KEY_ID;
  const baseUrl = process.env.STREAM_BASE_URL;

  if (!signingKey || !baseUrl) return null;

  const { token, exp } = createStreamJwt({
    streamId,
    signingKey,
    signingKeyId,
    ttlSec: 3600,
  });

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return { playbackUrl: `${normalizedBase}/${streamId}/manifest/video.m3u8?token=${token}`, exp };
}

function getR2PlaybackUrl(r2Key: string) {
  const secret = process.env.MEDIA_TOKEN_SECRET;
  const mediaBaseUrl = process.env.MEDIA_BASE_URL;
  if (!secret || !mediaBaseUrl) return null;
  const { url, exp } = signMediaUrl({
    objectPath: r2Key,
    secret,
    mediaBaseUrl,
    ttlSec: 300,
  });
  return { playbackUrl: url, exp };
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id?: string }> }
) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const fromParams = params?.id ?? "";
  const pathname = new URL(req.url).pathname;
  const parts = pathname.split("/").filter(Boolean);
  const fromPath = parts[parts.length - 1] ?? "";
  const jobId = fromParams || fromPath;

  if (!jobId) {
    return NextResponse.json({ error: "Missing job id" }, { status: 400 });
  }

  const { data: job, error: jobErr } = await supabaseAdmin
    .from("jobs")
    .select("id, user_id, status, progress, error, clip_id, result, payload, created_at, updated_at")
    .eq("id", jobId)
    .single();

  if (jobErr || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  if (job.user_id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let clip:
    | {
        id: string;
        r2_key: string | null;
        transcript_key: string | null;
        stream_id: string | null;
        status: string;
        duration_sec: number | null;
        mime_type: string | null;
      }
    | null = null;
  let playbackUrl: string | null = null;
  let playbackExp: number | null = null;
  let timingUrl: string | null = null;
  let timingExp: number | null = null;

  if (job.clip_id) {
    const { data: clipRow } = await supabaseAdmin
      .from("clips")
      .select("id, r2_key, transcript_key, stream_id, status, duration_sec, mime_type")
      .eq("id", job.clip_id)
      .single();
    if (clipRow) {
      clip = clipRow;
      if (clipRow.stream_id && clipRow.status === "ready") {
        const stream = getStreamPlaybackUrl(clipRow.stream_id);
        if (stream) {
          playbackUrl = stream.playbackUrl;
          playbackExp = stream.exp;
        }
      }
      if (!playbackUrl && clipRow.r2_key) {
        const r2 = getR2PlaybackUrl(clipRow.r2_key);
        if (r2) {
          playbackUrl = r2.playbackUrl;
          playbackExp = r2.exp;
        }
      }
      if (clipRow.transcript_key) {
        const r2 = getR2PlaybackUrl(clipRow.transcript_key);
        if (r2) {
          timingUrl = r2.playbackUrl;
          timingExp = r2.exp;
        }
      }
    }
  }

  let downloadUrl: string | null = null;
  let downloadExp: number | null = null;

  const result = job.result as Record<string, unknown> | null;
  if (result?.type === "export_shorts" && typeof result?.r2_key === "string") {
    const r2 = getR2PlaybackUrl(result.r2_key);
    if (r2) {
      downloadUrl = r2.playbackUrl;
      downloadExp = r2.exp;
    }
  }

  return NextResponse.json({
    job: {
      id: job.id,
      status: job.status,
      progress: job.progress,
      error: job.error,
      clipId: job.clip_id,
      result: job.result,
      payload: job.payload,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
    },
    clip,
    playbackUrl,
    playbackExp,
    timingUrl,
    timingExp,
    downloadUrl,
    downloadExp,
  });
}

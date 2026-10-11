import { signMediaUrl } from "@/lib/mediaSigner";
import { createStreamJwt } from "@/lib/stream";

// ---- Types ----

/** Superset of all DB columns selected across clip API routes */
export type ClipRow = {
  id: string;
  title: string | null;
  duration_sec: number | null;
  stream_id: string | null;
  r2_key: string | null;
  transcript_key: string | null;
  video_key: string | null;
  status: string | null;
  published_at: string | null;
  view_count: number | null;
  owner_id: string | null;
  like_count: number | null;
  /** 배경 이미지 R2 키 */
  background_image_key?: string | null;
  /** 시리즈 연속 클립 */
  series_id?: string | null;
  episode_number?: number | null;
  arc_phase?: string | null;
  language?: string | null;
};

/** API-safe clip shape returned to clients */
export type ClipApiPayload = {
  id: string;
  title: string | null;
  durationSec: number | null;
  playbackUrl: string | null;
  timingUrl: string | null;
  videoUrl?: string | null;
  publishedAt?: string;
  viewCount?: number;
  ownerId?: string;
  likeCount?: number;
  liked?: boolean;
  /** 배경 이미지 URL */
  backgroundImageUrl?: string | null;
  /** 시리즈 연속 클립 */
  seriesId?: string | null;
  episodeNumber?: number | null;
  arcPhase?: string | null;
  language?: string;
};

// ---- URL Generation ----

export function getStreamPlaybackUrl(streamId: string): string | null {
  const signingKey = process.env.STREAM_SIGNING_KEY;
  const signingKeyId = process.env.STREAM_SIGNING_KEY_ID;
  const baseUrl = process.env.STREAM_BASE_URL;

  if (!signingKey || !baseUrl) return null;

  const { token } = createStreamJwt({
    streamId,
    signingKey,
    signingKeyId,
    ttlSec: 3600,
  });

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalizedBase}/${streamId}/manifest/video.m3u8?token=${token}`;
}

export function getR2PlaybackUrl(r2Key: string, ttlSec = 3600): string | null {
  const secret = process.env.MEDIA_TOKEN_SECRET;
  const mediaBaseUrl = process.env.MEDIA_BASE_URL;
  if (!secret || !mediaBaseUrl) return null;
  const { url } = signMediaUrl({
    objectPath: r2Key,
    secret,
    mediaBaseUrl,
    ttlSec,
  });
  return url;
}

// ---- Mapping ----

type ClipRowToPayloadOptions = {
  liked?: boolean;
  /** TTL for audio R2 URLs (default 3600) */
  audioTtlSec?: number;
  /** TTL for transcript R2 URLs (default 300) */
  transcriptTtlSec?: number;
  /** If true, try Stream first then R2 fallback (default: R2 first) */
  preferStream?: boolean;
};

/** Convert a DB row to a client-safe API payload. */
export function clipRowToPayload(
  clip: ClipRow,
  options?: ClipRowToPayloadOptions
): ClipApiPayload {
  const audioTtl = options?.audioTtlSec ?? 3600;
  const transcriptTtl = options?.transcriptTtlSec ?? 300;
  const preferStream = options?.preferStream ?? false;

  let playbackUrl: string | null = null;
  let timingUrl: string | null = null;

  if (preferStream) {
    if (clip.stream_id && clip.status === "ready") {
      playbackUrl = getStreamPlaybackUrl(clip.stream_id);
    }
    if (!playbackUrl && clip.r2_key) {
      playbackUrl = getR2PlaybackUrl(clip.r2_key, audioTtl);
    }
  } else {
    if (clip.r2_key) {
      playbackUrl = getR2PlaybackUrl(clip.r2_key, audioTtl);
    }
    if (!playbackUrl && clip.stream_id && clip.status === "ready") {
      playbackUrl = getStreamPlaybackUrl(clip.stream_id);
    }
  }

  if (clip.transcript_key) {
    timingUrl = getR2PlaybackUrl(clip.transcript_key, transcriptTtl);
  }

  let videoUrl: string | null = null;
  if (clip.video_key) {
    videoUrl = getR2PlaybackUrl(clip.video_key, 3600);
  }

  let backgroundImageUrl: string | null = null;
  if (clip.background_image_key) {
    backgroundImageUrl = getR2PlaybackUrl(clip.background_image_key, 3600);
  }

  return {
    id: clip.id,
    title: clip.title,
    durationSec: clip.duration_sec,
    playbackUrl,
    timingUrl,
    videoUrl,
    backgroundImageUrl,
    publishedAt: clip.published_at ?? undefined,
    viewCount: clip.view_count != null ? Number(clip.view_count) : 0,
    ownerId: clip.owner_id ?? undefined,
    likeCount: clip.like_count != null ? Number(clip.like_count) : 0,
    liked: options?.liked ?? false,
    seriesId: clip.series_id ?? undefined,
    episodeNumber: clip.episode_number ?? undefined,
    arcPhase: clip.arc_phase ?? undefined,
    language: clip.language ?? undefined,
  };
}

// ---- Query helpers ----

export function normalizeLimit(raw: string | null, fallback = 30): number {
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

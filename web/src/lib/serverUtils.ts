import { signMediaUrl } from "@/lib/mediaSigner";

export function isNonEmpty(value?: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function buildSignedMediaUrl(objectPath: string): string | null {
  const secret = process.env.MEDIA_TOKEN_SECRET;
  const mediaBaseUrl = process.env.MEDIA_BASE_URL;
  if (!secret || !mediaBaseUrl) return null;
  try {
    return signMediaUrl({ objectPath, secret, mediaBaseUrl, ttlSec: 600 }).url;
  } catch {
    return null;
  }
}

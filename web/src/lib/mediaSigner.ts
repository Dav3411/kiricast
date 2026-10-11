import crypto from "crypto";

export type SignedMediaUrl = {
  url: string;
  exp: number;
};

function base64Url(input: Buffer) {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function isValidObjectPath(p: string) {
  if (!p) return false;
  if (p.startsWith("/") || p.includes("\\")) return false;
  if (p.includes("..")) return false;
  if (p.length > 512) return false;
  return /^[a-zA-Z0-9/_\-.]+$/.test(p);
}

export function signMediaUrl({
  objectPath,
  secret,
  mediaBaseUrl,
  ttlSec = 60,
}: {
  objectPath: string;
  secret: string;
  mediaBaseUrl: string;
  ttlSec?: number;
}): SignedMediaUrl {
  if (!isValidObjectPath(objectPath)) {
    throw new Error("Invalid path");
  }
  if (!secret) {
    throw new Error("Missing MEDIA_TOKEN_SECRET");
  }
  if (!mediaBaseUrl) {
    throw new Error("Missing MEDIA_BASE_URL");
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + ttlSec;
  const payload = `${objectPath}|${expSec}`;
  const sig = base64Url(crypto.createHmac("sha256", secret).update(payload).digest());

  const normalizedBase = mediaBaseUrl.endsWith("/")
    ? mediaBaseUrl.slice(0, -1)
    : mediaBaseUrl;

  const url = `${normalizedBase}/${objectPath}?exp=${expSec}&sig=${sig}`;
  return { url, exp: expSec };
}

/** 서명·만료 검증 후 true 반환. 프록시에서 사용 */
export function verifyMediaUrl({
  objectPath,
  expSec,
  sig,
  secret,
}: {
  objectPath: string;
  expSec: number;
  sig: string;
  secret: string;
}): boolean {
  if (!objectPath || !secret || !sig) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (expSec < nowSec) return false;
  const payload = `${objectPath}|${expSec}`;
  const expected = base64Url(crypto.createHmac("sha256", secret).update(payload).digest());
  return sig === expected;
}

import crypto from "crypto";

function base64Url(input: Buffer) {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createStreamJwt({
  streamId,
  signingKey,
  signingKeyId,
  ttlSec = 3600,
}: {
  streamId: string;
  signingKey: string;
  signingKeyId?: string;
  ttlSec?: number;
}) {
  const header: Record<string, string> = { alg: "HS256", typ: "JWT" };
  if (signingKeyId) header.kid = signingKeyId;

  const nowSec = Math.floor(Date.now() / 1000);
  const payload = {
    sub: streamId,
    exp: nowSec + ttlSec,
    iat: nowSec,
  };

  const headerB64 = base64Url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64Url(Buffer.from(JSON.stringify(payload)));
  const toSign = `${headerB64}.${payloadB64}`;
  const sig = base64Url(crypto.createHmac("sha256", signingKey).update(toSign).digest());

  return { token: `${toSign}.${sig}`, exp: payload.exp };
}

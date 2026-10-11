import { NextResponse } from "next/server";
import { signMediaUrl } from "@/lib/mediaSigner";

export const runtime = "nodejs";

type ReqBody = {
  path?: string;
};

export async function POST(req: Request) {
  const secret = process.env.MEDIA_TOKEN_SECRET;
  const mediaBaseUrl = process.env.MEDIA_BASE_URL;

  if (!secret) {
    return NextResponse.json(
      { error: "Missing MEDIA_TOKEN_SECRET" },
      { status: 500 }
    );
  }
  if (!mediaBaseUrl) {
    return NextResponse.json(
      { error: "Missing MEDIA_BASE_URL" },
      { status: 500 }
    );
  }

  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const objectPath = (body.path ?? "").trim();
  try {
    const { url, exp } = signMediaUrl({
      objectPath,
      secret,
      mediaBaseUrl,
      ttlSec: 60,
    });
    return NextResponse.json({ url, exp });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message || "Invalid path" }, { status: 400 });
  }
}

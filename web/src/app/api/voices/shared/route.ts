import { NextResponse } from "next/server";

export const runtime = "nodejs";

const GENERATOR_URL = process.env.GENERATOR_BASE_URL ?? "http://127.0.0.1:8787";
const CACHE_TTL_MS = 10 * 60 * 1000; // 10분

type VoiceEntry = {
  voice_id: string;
  name: string;
  category: string | null;
  gender: string | null;
  accent: string | null;
  age: string | null;
  description: string | null;
  preview_url: string | null;
};

type CachedPage = { voices: VoiceEntry[]; has_more: boolean };
const pageCache = new Map<number, { data: CachedPage; ts: number }>();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page") ?? "0") || 0;

  const cached = pageCache.get(page);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json({ voices: cached.data.voices, has_more: cached.data.has_more, page });
  }

  try {
    const res = await fetch(
      `${GENERATOR_URL}/api/voices/shared?page=${encodeURIComponent(String(page))}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
      }
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: (body as Record<string, string>).detail ?? `Generator error: ${res.status}` },
        { status: res.status >= 400 ? res.status : 502 }
      );
    }

    const data = (await res.json()) as {
      voices?: VoiceEntry[];
      has_more?: boolean;
      page?: number;
    };
    const voices = data.voices ?? [];
    const has_more = data.has_more ?? false;
    pageCache.set(page, { data: { voices, has_more }, ts: Date.now() });

    return NextResponse.json({ voices, has_more, page: data.page ?? 0 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch shared voices" },
      { status: 500 }
    );
  }
}

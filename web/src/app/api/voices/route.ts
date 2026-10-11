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

let cache: { voices: VoiceEntry[]; ts: number } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json({ voices: cache.voices, has_more: false });
  }

  try {
    const res = await fetch(`${GENERATOR_URL}/api/voices`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: (body as Record<string, string>).detail ?? `Generator error: ${res.status}` },
        { status: res.status >= 400 ? res.status : 502 }
      );
    }

    const data = (await res.json()) as { voices?: VoiceEntry[]; has_more?: boolean };
    const voices = data.voices ?? [];
    cache = { voices, ts: Date.now() };
    return NextResponse.json({ voices, has_more: data.has_more ?? false });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to fetch voices" },
      { status: 500 }
    );
  }
}

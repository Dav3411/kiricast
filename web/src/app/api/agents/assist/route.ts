import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";

export const runtime = "nodejs";

const GENERATOR_URL = process.env.GENERATOR_BASE_URL ?? "http://127.0.0.1:8787";

// In-memory rate limiter: 5 requests per hour per user
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const assistTimestamps = new Map<string, number[]>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const timestamps = (assistTimestamps.get(userId) ?? []).filter((t) => t > cutoff);
  assistTimestamps.set(userId, timestamps);
  return timestamps.length < RATE_LIMIT;
}

function recordUsage(userId: string) {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const timestamps = (assistTimestamps.get(userId) ?? []).filter((t) => t > cutoff);
  timestamps.push(now);
  assistTimestamps.set(userId, timestamps);
}

export async function POST(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  if (!checkRateLimit(userId)) {
    return NextResponse.json(
      { error: "AI Assist is limited to 5 uses per hour. Please try again later." },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const res = await fetch(`${GENERATOR_URL}/api/agents/assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json(
        { error: (data as Record<string, string>).detail ?? "Assist failed" },
        { status: res.status >= 400 ? res.status : 502 },
      );
    }

    recordUsage(userId);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to reach generator" },
      { status: 502 },
    );
  }
}

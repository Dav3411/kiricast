import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildSignedMediaUrl } from "@/lib/serverUtils";
import type { AgentRow } from "@/types/agentRow";

export const runtime = "nodejs";

function normalizeLimit(raw: string | null, fallback = 24) {
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(1, Math.floor(parsed)));
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error: authErr, userId: viewerUserId } = await requireUserId(req);
  if (authErr || !viewerUserId) {
    return NextResponse.json({ error: authErr ?? "Unauthorized" }, { status: 401 });
  }

  const { id: userId } = await params;
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  // 본인의 에이전트만 조회 가능
  if (userId !== viewerUserId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const limit = normalizeLimit(url.searchParams.get("limit"));

  const { data, error } = await supabaseAdmin
    .from("agents")
    .select("id, user_id, name, personality, speaking_style, appearance, rate, pitch, intro_line, image_key, dominant_color")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: "Failed to load agents" }, { status: 500 });
  }

  const agents = (data ?? []).map((row: AgentRow) => ({
    id: row.id,
    name: row.name,
    personality: row.personality ?? undefined,
    speaking_style: row.speaking_style ?? undefined,
    appearance: row.appearance ?? undefined,
    rate: row.rate ?? undefined,
    pitch: row.pitch ?? undefined,
    intro_line: row.intro_line ?? undefined,
    image_url: (row.image_key ? buildSignedMediaUrl(row.image_key) : null) ?? undefined,
    dominant_color: row.dominant_color ?? undefined,
    source: "user" as const,
  }));

  return NextResponse.json({ agents });
}

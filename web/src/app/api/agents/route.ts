import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { deleteObjectFromR2 } from "@/lib/r2";
import { isNonEmpty, buildSignedMediaUrl } from "@/lib/serverUtils";
import type { AgentRow } from "@/types/agentRow";

export const runtime = "nodejs";

type UpdateAgentBody = {
  id?: string;
  name?: string;
  concept?: string;
  personality?: string;
  speakingStyle?: string;
  appearance?: string;
  rate?: string;
  pitch?: string;
  introLine?: string;
  elevenlabs_voice_id?: string | null;
  /** false면 비공개, true면 공개. */
  isPublic?: boolean;
};

type DeleteAgentBody = {
  id?: string;
};


async function resolveViewerUserId(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return null;
  try {
    const { error, userId } = await requireUserId(req);
    if (error || !userId) return null;
    return userId;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const viewerUserId = await resolveViewerUserId(req);
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  let agentsQuery = supabaseAdmin
    .from("agents")
    .select(
      "id, user_id, name, concept, personality, speaking_style, appearance, rate, pitch, intro_line, image_key, elevenlabs_voice_id, intro_mp3, is_public, subscriber_count, created_at, dominant_color, language"
    );

  if (q) {
    // PostgREST 메타문자 제거하여 필터 인젝션 차단
    const safeQ = q.replace(/[,.()"']/g, "");
    if (safeQ) {
      agentsQuery = agentsQuery.or(`name.ilike.%${safeQ}%,concept.ilike.%${safeQ}%,personality.ilike.%${safeQ}%,speaking_style.ilike.%${safeQ}%`);
    }
  }

  agentsQuery = agentsQuery.order("created_at", { ascending: false });
  const { data: agentRows } = await agentsQuery;
  const allAgents = (agentRows ?? []) as AgentRow[];
  const visibleAgents = viewerUserId
    ? allAgents.filter((row) => row.is_public !== false || row.user_id === viewerUserId)
    : allAgents.filter((row) => row.is_public !== false);

  // Fetch user's subscribed agent IDs for is_subscribed flag
  const subscribedAgentIds = new Set<string>();
  if (viewerUserId) {
    const { data: subs } = await supabaseAdmin
      .from("agent_subscriptions")
      .select("agent_id")
      .eq("user_id", viewerUserId);
    for (const row of subs ?? []) subscribedAgentIds.add(row.agent_id);
  }

  const normalizedUser = visibleAgents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    rate: agent.rate ?? undefined,
    pitch: agent.pitch ?? undefined,
    concept: agent.concept ?? undefined,
    personality: agent.personality ?? undefined,
    speaking_style: agent.speaking_style ?? undefined,
    appearance: agent.appearance ?? undefined,
    intro_line: agent.intro_line ?? undefined,
    elevenlabs_voice_id: agent.elevenlabs_voice_id ?? undefined,
    intro_mp3_url: agent.intro_mp3 ? buildSignedMediaUrl(agent.intro_mp3) ?? undefined : undefined,
    is_public: agent.is_public !== false,
    image_url: agent.image_key
      ? buildSignedMediaUrl(String(agent.image_key).replace(/^\//, "")) ?? undefined
      : undefined,
    mine: viewerUserId ? agent.user_id === viewerUserId : false,
    source: "user",
    subscriber_count: agent.subscriber_count ?? 0,
    is_subscribed: subscribedAgentIds.has(agent.id),
    created_at: agent.created_at ?? undefined,
    dominant_color: agent.dominant_color ?? undefined,
    language: agent.language ?? undefined,
  }));

  return NextResponse.json({ agents: normalizedUser });
}

export async function PATCH(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  let body: UpdateAgentBody;
  try {
    body = (await req.json()) as UpdateAgentBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = body.id?.trim() ?? "";
  if (!id) {
    return NextResponse.json({ error: "Missing agent id" }, { status: 400 });
  }

  const updates: Record<string, string | null | boolean> = {};
  if (typeof body.name === "string") updates.name = body.name.trim();
  if (typeof body.concept === "string") updates.concept = body.concept.trim();
  if (typeof body.personality === "string") updates.personality = body.personality.trim();
  if (typeof body.speakingStyle === "string") updates.speaking_style = body.speakingStyle.trim();
  if (typeof body.appearance === "string") updates.appearance = body.appearance.trim();
  if (typeof body.rate === "string") updates.rate = body.rate.trim() || null;
  if (typeof body.pitch === "string") updates.pitch = body.pitch.trim() || null;
  if (typeof body.introLine === "string") updates.intro_line = body.introLine.trim() || null;
  if (body.elevenlabs_voice_id !== undefined) updates.elevenlabs_voice_id = body.elevenlabs_voice_id?.trim() || null;
  if (typeof body.isPublic === "boolean") updates.is_public = body.isPublic;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }
  if (typeof updates.name === "string" && !isNonEmpty(updates.name)) {
    return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
  }
  const { data, error: updateErr } = await supabaseAdmin
    .from("agents")
    .update(updates)
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, name, concept, personality, speaking_style, appearance, rate, pitch, intro_line, elevenlabs_voice_id, intro_mp3")
    .single();

  if (updateErr || !data) {
    return NextResponse.json({ error: "Failed to update agent" }, { status: 500 });
  }

  const row = data as AgentRow;
  return NextResponse.json({
    agent: {
      id: row.id,
      name: row.name,
      concept: row.concept ?? undefined,
      personality: row.personality ?? undefined,
      speaking_style: row.speaking_style ?? undefined,
      appearance: row.appearance ?? undefined,
      rate: row.rate ?? undefined,
      pitch: row.pitch ?? undefined,
      intro_line: row.intro_line ?? undefined,
      elevenlabs_voice_id: row.elevenlabs_voice_id ?? undefined,
      intro_mp3_url: row.intro_mp3 ? buildSignedMediaUrl(row.intro_mp3) ?? undefined : undefined,
      source: "user",
    },
  });
}

export async function DELETE(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  let body: DeleteAgentBody;
  try {
    body = (await req.json()) as DeleteAgentBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = body.id?.trim() ?? "";
  if (!id) {
    return NextResponse.json({ error: "Missing agent id" }, { status: 400 });
  }

  const { data: target, error: fetchErr } = await supabaseAdmin
    .from("agents")
    .select("id, image_key")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (fetchErr || !target) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const { error: deleteErr } = await supabaseAdmin
    .from("agents")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (deleteErr) {
    return NextResponse.json({ error: "Failed to delete agent" }, { status: 500 });
  }

  let imageDeleted = false;
  let imageDeleteReason: string | null = null;
  const r2Bucket = process.env.R2_BUCKET;
  if (!target.image_key) {
    imageDeleteReason = "missing_image_key";
  } else if (!r2Bucket) {
    imageDeleteReason = "missing_r2_bucket";
  } else {
    try {
      await deleteObjectFromR2({ bucket: r2Bucket, key: target.image_key });
      imageDeleted = true;
    } catch {
      imageDeleted = false;
      imageDeleteReason = "delete_failed";
    }
  }

  return NextResponse.json({ ok: true, imageDeleted, imageDeleteReason });
}

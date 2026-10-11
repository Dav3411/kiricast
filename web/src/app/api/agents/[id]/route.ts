import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getUserIdFromToken, requireUserId } from "@/lib/authServer";
import { deleteObjectFromR2 } from "@/lib/r2";
import { getAgentByIdOrLegacy } from "@/lib/agentsDb";
import { buildSignedMediaUrl } from "@/lib/serverUtils";
import type { AgentRow } from "@/types/agentRow";

export const runtime = "nodejs";

const AGENT_SELECT =
  "id, user_id, name, concept, personality, speaking_style, appearance, rate, pitch, intro_line, image_key, is_public, elevenlabs_voice_id, intro_mp3, subscriber_count, dominant_color, language";

export async function GET(
  req: Request,
  context: { params: Promise<{ id?: string }> }
) {
  const params = await context.params;
  const id = params?.id?.trim() ?? "";
  if (!id) {
    return NextResponse.json({ error: "Missing agent id" }, { status: 400 });
  }

  const { data, error } = await getAgentByIdOrLegacy(
    supabaseAdmin,
    id,
    AGENT_SELECT
  );

  if (error || !data) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const agent = data as AgentRow & { is_public?: boolean | null; subscriber_count?: number | null };
  const authHeader = req.headers.get("authorization") ?? "";
  const [, token] = authHeader.split(" ");
  const { userId: viewerUserId } = await getUserIdFromToken(token ?? null);
  if (agent.is_public === false && agent.user_id !== viewerUserId) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  let isSubscribed = false;
  if (viewerUserId) {
    const { data: sub } = await supabaseAdmin
      .from("agent_subscriptions")
      .select("agent_id")
      .eq("agent_id", agent.id)
      .eq("user_id", viewerUserId)
      .maybeSingle();
    isSubscribed = !!sub;
  }

  return NextResponse.json({
    agent: {
      id: agent.id,
      name: agent.name,
      concept: agent.concept ?? undefined,
      personality: agent.personality ?? undefined,
      speaking_style: agent.speaking_style ?? undefined,
      appearance: agent.appearance ?? undefined,
      rate: agent.rate ?? undefined,
      pitch: agent.pitch ?? undefined,
      intro_line: agent.intro_line ?? undefined,
      elevenlabs_voice_id: agent.elevenlabs_voice_id ?? undefined,
      intro_mp3_url: agent.intro_mp3 ? buildSignedMediaUrl(agent.intro_mp3) ?? undefined : undefined,
      image_url: agent.image_key
        ? buildSignedMediaUrl(String(agent.image_key).replace(/^\//, "")) ?? undefined
        : undefined,
      source: "user",
      ownerId: agent.user_id ?? undefined,
      is_public: agent.is_public !== false,
      subscriber_count: agent.subscriber_count ?? 0,
      is_subscribed: isSubscribed,
      dominant_color: agent.dominant_color ?? undefined,
      language: agent.language ?? undefined,
    },
  });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id?: string }> }
) {
  const { error: authError, userId } = await requireUserId(req);
  if (authError || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const id = params?.id?.trim() ?? "";
  if (!id) {
    return NextResponse.json({ error: "Missing agent id" }, { status: 400 });
  }

  const { data, error } = await getAgentByIdOrLegacy(
    supabaseAdmin,
    id,
    "id, user_id, image_key, intro_mp3"
  );

  if (error || !data) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if ((data.user_id as string) !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const bucket = process.env.R2_BUCKET;
  if (bucket) {
    const keysToDelete = [data.image_key, data.intro_mp3].filter(Boolean) as string[];
    for (const key of keysToDelete) {
      try {
        await deleteObjectFromR2({ bucket, key });
      } catch {
        // best-effort
      }
    }
  }

  const { error: deleteError } = await supabaseAdmin
    .from("agents")
    .delete()
    .eq("id", data.id as string)
    .eq("user_id", userId);

  if (deleteError) {
    return NextResponse.json({ error: "Failed to delete agent" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}


import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getUserIdFromToken } from "@/lib/authServer";
import { getAgentByIdOrLegacy } from "@/lib/agentsDb";
import { type ClipRow, clipRowToPayload } from "@/lib/clipDb";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  context: { params: Promise<{ id?: string }> }
) {
  const params = await context.params;
  const agentId = params?.id?.trim() ?? "";
  if (!agentId) {
    return NextResponse.json({ error: "Missing agent id" }, { status: 400 });
  }

  // Verify agent exists
  const { data: agentData, error: agentErr } = await getAgentByIdOrLegacy(
    supabaseAdmin,
    agentId,
    "id, is_public, user_id"
  );
  if (agentErr || !agentData) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const agent = agentData as { id: string; is_public?: boolean | null; user_id?: string | null };
  const authHeader = req.headers.get("authorization") ?? "";
  const [, token] = authHeader.split(" ");
  const { userId } = await getUserIdFromToken(token || null);

  if (agent.is_public === false && agent.user_id !== userId) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const resolvedAgentId = agent.id;

  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? "20") || 20));

  // clips 테이블에서 agent1_id / agent2_id로 직접 조회
  const { data: clipRows } = await supabaseAdmin
    .from("clips")
    .select("id, title, duration_sec, stream_id, r2_key, transcript_key, video_key, background_image_key, status, published_at, view_count, owner_id, like_count, agent1_id, agent2_id")
    .or(`agent1_id.eq.${resolvedAgentId},agent2_id.eq.${resolvedAgentId}`)
    .eq("status", "ready")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(limit);

  if (!clipRows || clipRows.length === 0) {
    return NextResponse.json({ clips: [] });
  }

  const clips = (clipRows as (ClipRow & { agent1_id?: string; agent2_id?: string })[]).map((clip) => ({
    ...clipRowToPayload(clip),
    agent1Id: clip.agent1_id ?? undefined,
    agent2Id: clip.agent2_id ?? undefined,
  }));

  return NextResponse.json({ clips });
}

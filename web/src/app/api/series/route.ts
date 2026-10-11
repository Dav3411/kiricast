import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isNonEmpty } from "@/lib/serverUtils";

export const runtime = "nodejs";

/** POST: 새 시리즈 생성 */
export async function POST(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  let body: {
    id?: string;
    title?: string;
    agent1Id?: string;
    agent2Id?: string;
    setting?: string;
    relationshipContext?: string;
    totalEpisodes?: number;
    seriesDocument?: Record<string, unknown>;
    arcDocument?: Record<string, unknown>;
    locked?: boolean;
    language?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const requestedId = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id.trim()) ? body.id.trim() : null;

  const title = body.title?.trim() ?? "";
  const agent1Id = body.agent1Id?.trim() ?? "";
  const agent2Id = body.agent2Id?.trim() ?? "";
  const setting = body.setting?.trim() ?? "";
  const relationshipContext = body.relationshipContext?.trim() ?? "";
  const totalEpisodes = body.totalEpisodes ?? null;  // null = open-ended

  if (!isNonEmpty(title)) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (!isNonEmpty(agent1Id) || !isNonEmpty(agent2Id)) {
    return NextResponse.json({ error: "Both agents are required" }, { status: 400 });
  }
  if (agent1Id === agent2Id) {
    return NextResponse.json({ error: "Agents must be different" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const insertRow: Record<string, any> = {
    owner_id: userId,
    title,
    agent1_id: agent1Id,
    agent2_id: agent2Id,
    setting,
    relationship_context: relationshipContext,
    total_episodes: totalEpisodes,
    story_context: [],
    status: "in_progress",
  };

  const language = typeof body.language === "string" ? body.language.trim().slice(0, 10) : "en";
  if (language) insertRow.language = language;

  if (body.seriesDocument) insertRow.series_document = body.seriesDocument;
  if (body.arcDocument) insertRow.arc_document = body.arcDocument;
  if (body.locked) {
    insertRow.locked = true;
    insertRow.locked_at = new Date().toISOString();
  }
  if (requestedId) insertRow.id = requestedId;

  const { data, error: insertErr } = await supabaseAdmin
    .from("clip_series")
    .insert(insertRow)
    .select("id")
    .single();

  if (insertErr || !data) {
    return NextResponse.json({ error: "Failed to create series" }, { status: 500 });
  }

  return NextResponse.json({ seriesId: data.id });
}

/** GET: 사용자의 시리즈 목록 */
export async function GET(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const { data, error: fetchErr } = await supabaseAdmin
    .from("clip_series")
    .select("id, title, agent1_id, agent2_id, total_episodes, status, created_at, story_context, locked")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (fetchErr) {
    return NextResponse.json({ error: "Failed to load series" }, { status: 500 });
  }

  const series = (data ?? [])
    .map((s) => ({
      id: s.id,
      title: s.title,
      agent1Id: s.agent1_id,
      agent2Id: s.agent2_id,
      totalEpisodes: s.total_episodes,
      currentEpisode: Array.isArray(s.story_context) ? s.story_context.length : 0,
      status: s.status,
      locked: s.locked ?? false,
      createdAt: s.created_at,
    }))
    .filter((s) => s.currentEpisode > 0);

  return NextResponse.json({ series });
}

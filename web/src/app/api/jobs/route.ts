import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 50);

  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const [activeResult, recentResult, scriptActiveResult, scriptRecentResult] = await Promise.all([
    supabaseAdmin
      .from("jobs")
      .select("id, status, progress, error, result, payload, clip_id, created_at, updated_at, requeued_at")
      .eq("user_id", userId)
      .in("status", ["queued", "processing"])
      .order("created_at", { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from("jobs")
      .select("id, status, progress, error, result, payload, clip_id, created_at, updated_at, requeued_at")
      .eq("user_id", userId)
      .in("status", ["succeeded", "failed"])
      .gte("updated_at", thirtyMinAgo)
      .order("updated_at", { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from("script_generation_jobs")
      .select("id, status, progress, error, result, created_at, updated_at")
      .eq("user_id", userId)
      .in("status", ["queued", "processing"])
      .order("created_at", { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from("script_generation_jobs")
      .select("id, status, progress, error, result, created_at, updated_at")
      .eq("user_id", userId)
      .in("status", ["succeeded", "failed"])
      .gte("updated_at", thirtyMinAgo)
      .order("updated_at", { ascending: false })
      .limit(limit),
  ]);

  if (activeResult.error || recentResult.error || scriptActiveResult.error || scriptRecentResult.error) {
    return NextResponse.json({ error: "Failed to load jobs" }, { status: 500 });
  }

  const seen = new Set<string>();
  const mainJobs = [...(activeResult.data ?? []), ...(recentResult.data ?? [])]
    .filter((j) => {
      if (seen.has(j.id)) return false;
      seen.add(j.id);
      return true;
    })
    .slice(0, limit)
    .map((j) => {
      const payload = j.payload as Record<string, unknown> | null;
      const kind = payload?.kind === "agent"
        ? "agent"
        : payload?.kind === "export_shorts"
          ? "export_shorts"
          : payload?.kind === "series_doc"
            ? "series_doc"
            : "clip";
      const name = kind === "agent"
        ? (payload?.name as string) ?? "Agent"
        : kind === "export_shorts"
          ? (payload?.title as string) ?? "Export"
          : kind === "series_doc"
            ? (payload?.title as string) ?? "Series Document"
            : (payload?.title as string) ?? "Clip";
      return {
        id: j.id,
        status: j.status,
        progress: j.progress,
        error: j.error,
        result: j.result,
        clipId: j.clip_id,
        kind,
        name,
        seriesId: (payload?.series_id as string) ?? undefined,
        episodeNumber: (payload?.episode_number as number) ?? undefined,
        createdAt: j.created_at,
        updatedAt: j.updated_at,
        requeuedAt: (j as { requeued_at?: string | null }).requeued_at ?? undefined,
      };
    });

  const scriptJobs = [...(scriptActiveResult.data ?? []), ...(scriptRecentResult.data ?? [])]
    .filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    })
    .slice(0, limit)
    .map((s) => ({
      id: s.id,
      status: s.status,
      progress: s.progress,
      error: s.error,
      result: s.result,
      clipId: null as string | null,
      kind: "script" as const,
      name: "Generating Script",
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      requeuedAt: undefined as string | undefined,
    }));

  const combined = [...mainJobs, ...scriptJobs].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  ).slice(0, limit);

  return NextResponse.json({ jobs: combined });
}

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, userId } = await requireUserId(_req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const id = (await params).id;
  if (!id) {
    return NextResponse.json({ error: "Missing script job id" }, { status: 400 });
  }

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("script_generation_jobs")
    .select("id, user_id, status, progress, result, error, created_at, updated_at, started_at")
    .eq("id", id)
    .maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: "Failed to load script job" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Script job not found" }, { status: 404 });
  }
  if ((row as { user_id: string }).user_id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const r = row as {
    id: string;
    status: string;
    progress: number | null;
    result: unknown;
    error: string | null;
    created_at: string;
    updated_at: string;
    started_at: string | null;
  };

  return NextResponse.json({
    id: r.id,
    status: r.status,
    progress: r.progress,
    result: r.result,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.started_at,
  });
}

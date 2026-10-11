import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const { id: seriesId } = await params;

  // 시리즈 확인
  const { data: series, error: fetchErr } = await supabaseAdmin
    .from("clip_series")
    .select("id, owner_id, locked")
    .eq("id", seriesId)
    .single();

  if (fetchErr || !series) {
    return NextResponse.json({ error: "Series not found" }, { status: 404 });
  }

  if (series.locked) {
    return NextResponse.json({ error: "Series is already locked" }, { status: 400 });
  }

  const { error: updateErr } = await supabaseAdmin
    .from("clip_series")
    .update({ locked: true, locked_at: new Date().toISOString() })
    .eq("id", seriesId);

  if (updateErr) {
    return NextResponse.json({ error: "Failed to lock series" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

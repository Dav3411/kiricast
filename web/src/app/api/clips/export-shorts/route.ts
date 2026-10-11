import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getEffectivePlanForUser } from "@/lib/subscriptionPlan";
import crypto from "crypto";

export const runtime = "nodejs";

type ExportBody = {
  clipId?: string;
};

export async function POST(req: Request) {
  const { error: authError, userId } = await requireUserId(req);
  if (authError || !userId) {
    return NextResponse.json({ error: authError ?? "Unauthorized" }, { status: 401 });
  }

  let body: ExportBody;
  try {
    body = (await req.json()) as ExportBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const clipId = body.clipId?.trim() ?? "";
  if (!clipId) {
    return NextResponse.json({ error: "Missing clipId" }, { status: 400 });
  }

  const { data: clipRow, error: clipErr } = await supabaseAdmin
    .from("clips")
    .select("id, title, owner_id, r2_key, transcript_key, background_image_key")
    .eq("id", clipId)
    .maybeSingle();

  if (clipErr || !clipRow) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }
  if (clipRow.owner_id !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Plan gate: Plus plan or higher required for video export
  const plan = await getEffectivePlanForUser(userId);
  if (!plan?.canExportVideo) {
    return NextResponse.json(
      { error: "Video export requires Plus plan or higher" },
      { status: 403 }
    );
  }

  const title = (clipRow.title ?? "").trim() || "Untitled";
  const r2Key: string | null = clipRow.r2_key;
  const transcriptKey: string | null = clipRow.transcript_key;
  const backgroundImageKey: string | null = clipRow.background_image_key ?? null;

  if (!r2Key || !transcriptKey) {
    return NextResponse.json({ error: "Clip has no audio or transcript" }, { status: 400 });
  }

  const jobId = crypto.randomUUID();
  const { error: insertErr } = await supabaseAdmin
    .from("jobs")
    .insert({
      id: jobId,
      user_id: userId,
      status: "queued",
      progress: 0,
      payload: {
        kind: "export_shorts",
        clip_id: clipId,
        title,
        r2_key: r2Key,
        transcript_key: transcriptKey,
        background_image_key: backgroundImageKey,
        no_watermark: !!plan.noWatermark,
      },
      source: process.env.JOB_SOURCE || "production",
    });

  if (insertErr) {
    return NextResponse.json({ error: "Failed to create export job" }, { status: 500 });
  }

  return NextResponse.json({ jobId });
}

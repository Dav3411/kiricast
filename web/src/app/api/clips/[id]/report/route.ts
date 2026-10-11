import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const VALID_REASONS = ["defamation", "copyright", "privacy", "inappropriate", "other"] as const;
type ReportReason = (typeof VALID_REASONS)[number];

/** 유저당 하루 최대 신고 건수 */
const DAILY_REPORT_LIMIT = 5;
/** 숨김 처리에 필요한 고유 신고자 수 */
const HIDE_THRESHOLD = 3;

type ReqBody = {
  reason?: string;
  detail?: string;
};

/** POST: 클립 신고 — 고유 신고자 HIDE_THRESHOLD명 이상 시 is_hidden=true */
export async function POST(
  req: Request,
  context: { params: Promise<{ id?: string }> }
) {
  const { error: authError, userId } = await requireUserId(req);
  if (authError || !userId) {
    return NextResponse.json({ error: authError ?? "Unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const clipId = params?.id?.trim() ?? "";
  if (!clipId) {
    return NextResponse.json({ error: "Missing clip id" }, { status: 400 });
  }

  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const reason = body.reason?.trim() ?? "";
  if (!VALID_REASONS.includes(reason as ReportReason)) {
    return NextResponse.json(
      { error: `reason must be one of: ${VALID_REASONS.join(", ")}` },
      { status: 400 }
    );
  }

  const detail = body.detail?.trim() || null;

  // 이미 같은 클립을 신고한 적이 있는지 확인
  const { data: existing } = await supabaseAdmin
    .from("clip_reports")
    .select("id")
    .eq("clip_id", clipId)
    .eq("reporter_id", userId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Already reported" }, { status: 409 });
  }

  // 일일 신고 횟수 제한
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count: dailyCount } = await supabaseAdmin
    .from("clip_reports")
    .select("id", { count: "exact", head: true })
    .eq("reporter_id", userId)
    .gte("created_at", todayStart.toISOString());

  if ((dailyCount ?? 0) >= DAILY_REPORT_LIMIT) {
    return NextResponse.json(
      { error: "Daily report limit reached. Please try again tomorrow." },
      { status: 429 }
    );
  }

  // 클립 존재 여부 확인
  const { data: clip, error: clipErr } = await supabaseAdmin
    .from("clips")
    .select("id, is_hidden")
    .eq("id", clipId)
    .maybeSingle();

  if (clipErr || !clip) {
    return NextResponse.json({ error: "Clip not found" }, { status: 404 });
  }

  // 신고 기록 저장
  const { error: insertErr } = await supabaseAdmin.from("clip_reports").insert({
    clip_id: clipId,
    reporter_id: userId,
    reason,
    detail,
  });

  if (insertErr) {
    console.error("[report] clip_reports insert failed:", insertErr);
    return NextResponse.json({ error: "Failed to submit report" }, { status: 500 });
  }

  // 고유 신고자 수 확인 후 임계치 도달 시 숨김 처리
  if (!clip.is_hidden) {
    const { count: reporterCount } = await supabaseAdmin
      .from("clip_reports")
      .select("id", { count: "exact", head: true })
      .eq("clip_id", clipId);

    if ((reporterCount ?? 0) >= HIDE_THRESHOLD) {
      await supabaseAdmin
        .from("clips")
        .update({ is_hidden: true, hidden_reason: "reported" })
        .eq("id", clipId);
    }
  }

  return NextResponse.json({ ok: true });
}

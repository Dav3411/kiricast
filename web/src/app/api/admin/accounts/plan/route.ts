import { NextResponse } from "next/server";
import { requireCreditsAdmin } from "@/lib/adminAuth";
import { getPlan, type PlanId } from "@/lib/plans";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/**
 * 관리자: 유저 구독 플랜 변경.
 * ADMIN_CREDITS_SECRET + 로그인 + ADMIN_USER_IDS allowlist 필요.
 *
 * POST body: { userId: string, planId: "starter"|"plus"|"pro"|"ultra", periodDays?: number }
 * - periodDays: 구독 종료일을 오늘 기준 며칠 후로 할지 (기본 30).
 */
export async function POST(req: Request) {
  const auth = await requireCreditsAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { userId?: string; planId?: string; periodDays?: number };
  try {
    body = (await req.json()) as { userId?: string; planId?: string; periodDays?: number };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = body.userId?.trim() ?? "";
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const planId = (body.planId ?? "").trim().toLowerCase() as PlanId;
  const plan = getPlan(planId);
  if (!plan) {
    return NextResponse.json(
      { error: "Invalid planId. Use: starter, plus, pro, ultra" },
      { status: 400 }
    );
  }

  const periodDays = Math.min(
    365,
    Math.max(1, Math.floor(Number(body.periodDays) || 30))
  );
  const periodEndsAt = new Date();
  periodEndsAt.setDate(periodEndsAt.getDate() + periodDays);

  const { error } = await supabaseAdmin.from("user_subscriptions").upsert(
    {
      user_id: userId,
      plan_id: planId,
      period_ends_at: periodEndsAt.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return NextResponse.json(
      { error: error.message || "Failed to update subscription" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    userId,
    planId,
    periodEndsAt: periodEndsAt.toISOString(),
    periodDays,
  });
}

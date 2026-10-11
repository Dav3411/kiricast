import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { type Plan } from "@/lib/plans";
import { getEffectiveSubscriptionState } from "@/lib/subscriptionPlan";

export const runtime = "nodejs";

/**
 * GET /api/subscription/plan
 * 현재 유저의 구독 플랜. 기간 만료 시 null.
 */
export async function GET(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const {
    plan,
    periodEndsAt,
    subscriptionId,
    canCancelRenewal,
    renewalCancelled,
  } = await getEffectiveSubscriptionState(userId);

  if (!plan) {
    return NextResponse.json({
      plan: {
        scriptGenerateLimitPerClip: 1,
        canCreatePrivateAgent: false,
        canSelectVoiceManually: false,
        canExportVideo: false,
        noWatermark: false,
      },
      periodEndsAt: null,
      subscriptionId: null,
      canCancelRenewal,
      renewalCancelled,
    });
  }

  return NextResponse.json({
    plan: plan as Plan,
    periodEndsAt,
    subscriptionId,
    canCancelRenewal,
    renewalCancelled,
  });
}

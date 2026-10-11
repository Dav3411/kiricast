import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPlan, type Plan, type PlanId } from "@/lib/plans";

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export async function getEffectiveSubscriptionState(userId: string): Promise<{
  plan: Plan | null;
  periodEndsAt: string | null;
  subscriptionId: string | null;
  canCancelRenewal: boolean;
  renewalCancelled: boolean;
}> {
  const now = new Date().toISOString();
  const [{ data: sub }, { data: activeSub }, { data: cancelledSub }, { data: activatedSubs }] = await Promise.all([
    supabaseAdmin
      .from("user_subscriptions")
      .select("plan_id, period_ends_at, updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("paypal_subscriptions")
      .select("subscription_id, plan_id, activated_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle(),
    supabaseAdmin
      .from("paypal_subscriptions")
      .select("subscription_id")
      .eq("user_id", userId)
      .eq("status", "cancelled")
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("paypal_subscriptions")
      .select("plan_id, activated_at, status")
      .eq("user_id", userId)
      .not("activated_at", "is", null)
      .in("status", ["active", "cancelled"])
      .order("activated_at", { ascending: true }),
  ]);

  const canCancelRenewal = !!activeSub?.subscription_id;
  const renewalCancelled = !canCancelRenewal && !!cancelledSub?.subscription_id;

  // 1) Primary source: current paid window in user_subscriptions.
  if (sub?.period_ends_at && sub.period_ends_at >= now) {
    const currentPlan = getPlan(String(sub.plan_id ?? ""));
    if (currentPlan) {
      return {
        plan: currentPlan,
        periodEndsAt: sub.period_ends_at,
        subscriptionId: activeSub?.subscription_id ?? null,
        canCancelRenewal,
        renewalCancelled,
      };
    }
  }

  // 2) Sequential queued downgrade windows:
  // Apply in activation order. Each queued plan keeps its own expiry
  // at (activated_at + 30 days), while its start is deferred until the
  // previous window has ended.
  if (sub?.period_ends_at && sub?.updated_at) {
    let cursor = sub.period_ends_at;
    const candidates = (activatedSubs ?? []).filter((row) => {
      const activatedAt = String(row.activated_at ?? "");
      return activatedAt >= sub.updated_at;
    });
    for (const row of candidates) {
      const queuedPlan = getPlan(String(row.plan_id ?? ""));
      if (!queuedPlan) continue;
      const activatedAt = String(row.activated_at ?? "");
      const slotStart = cursor > activatedAt ? cursor : activatedAt;
      const slotEnd = addDaysIso(activatedAt, 30);

      // This queued slot already expired before it could start.
      if (slotEnd <= slotStart) {
        continue;
      }

      if (now >= slotStart && now < slotEnd) {
        return {
          plan: queuedPlan,
          periodEndsAt: slotEnd,
          subscriptionId: activeSub?.subscription_id ?? null,
          canCancelRenewal,
          renewalCancelled,
        };
      }
      if (now >= slotEnd) {
        cursor = slotEnd;
      }
    }
  }

  // 3) Fallback: active PayPal subscription.
  const fallbackPlan = getPlan(String(activeSub?.plan_id ?? ""));
  if (fallbackPlan) {
    const fallbackEnd = activeSub?.activated_at ? addDaysIso(activeSub.activated_at, 30) : null;
    return {
      plan: fallbackPlan,
      periodEndsAt: fallbackEnd,
      subscriptionId: activeSub?.subscription_id ?? null,
      canCancelRenewal,
      renewalCancelled,
    };
  }

  return {
    plan: null,
    periodEndsAt: null,
    subscriptionId: null,
    canCancelRenewal,
    renewalCancelled,
  };
}

/**
 * 유저가 Free Plan인지 여부. 유료 구독이 없거나 기간이 만료된 경우 true.
 */
export async function isFreePlan(userId: string): Promise<boolean> {
  const state = await getEffectiveSubscriptionState(userId);
  return !state.plan;
}

/**
 * 유저의 현재 유효 유료 플랜(기간 내)을 반환. Free Plan이면 null.
 */
export async function getEffectivePlanForUser(userId: string): Promise<Plan | null> {
  const state = await getEffectiveSubscriptionState(userId);
  return state.plan;
}

export type { Plan, PlanId };

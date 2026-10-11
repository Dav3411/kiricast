import { NextResponse } from "next/server";
import { requireCreditsAdmin } from "@/lib/adminAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type PlanId = "starter" | "plus" | "pro" | "ultra";

const PLAN_IDS: PlanId[] = ["starter", "plus", "pro", "ultra"];

function emptyPlans(): Record<PlanId, { count: number; amountUsd: number }> {
  return Object.fromEntries(
    PLAN_IDS.map((id) => [id, { count: 0, amountUsd: 0 }])
  ) as Record<PlanId, { count: number; amountUsd: number }>;
}

/**
 * GET /api/admin/stats/plan-payments
 * 관리자: 월별 플랜 결제량 통계 (paypal_orders, status=captured).
 * ADMIN_CREDITS_SECRET + 로그인 + ADMIN_USER_IDS 필요.
 */
export async function GET(req: Request) {
  const auth = await requireCreditsAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data: rows, error } = await supabaseAdmin
    .from("paypal_orders")
    .select("plan_id, amount_usd, captured_at, created_at")
    .eq("status", "captured")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: error.message || "Failed to load orders" },
      { status: 500 }
    );
  }

  type MonthKey = string;
  const byMonth = new Map<
    MonthKey,
    { plans: Record<PlanId, { count: number; amountUsd: number }>; totalCount: number; totalUsd: number }
  >();

  for (const row of rows ?? []) {
    const planId = (String(row.plan_id ?? "").toLowerCase() || "starter") as PlanId;
    const amountUsd = Number(row.amount_usd) || 0;
    const date = row.captured_at ?? row.created_at;
    const month = date
      ? new Date(date).toISOString().slice(0, 7)
      : new Date().toISOString().slice(0, 7);

    if (!byMonth.has(month)) {
      byMonth.set(month, {
        plans: emptyPlans(),
        totalCount: 0,
        totalUsd: 0,
      });
    }
    const entry = byMonth.get(month)!;
    if (PLAN_IDS.includes(planId)) {
      entry.plans[planId].count += 1;
      entry.plans[planId].amountUsd += amountUsd;
    }
    entry.totalCount += 1;
    entry.totalUsd += amountUsd;
  }

  const months: Array<{
    month: string;
    plans: Record<PlanId, { count: number; amountUsd: number }>;
    totalCount: number;
    totalUsd: number;
  }> = Array.from(byMonth.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, v]) => ({ month, ...v }));

  return NextResponse.json({ months });
}

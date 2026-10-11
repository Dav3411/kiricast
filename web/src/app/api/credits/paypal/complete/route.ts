import { NextResponse } from "next/server";
import { capturePayPalOrder, getPayPalSubscription } from "@/lib/paypal";
import { getPlan } from "@/lib/plans";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/** 지갑이 없을 때만 balance=0 으로 생성. 있으면 건드리지 않음(기존 잔액 유지). */
async function ensureWallet(userId: string) {
  const { error } = await supabaseAdmin.from("credit_wallets").insert({
    user_id: userId,
    balance: 0,
    updated_at: new Date().toISOString(),
  });
  if (error?.code === "23505") return;
  if (error) throw error;
}

async function addCredits(userId: string, amount: number): Promise<boolean> {
  if (amount <= 0) return false;
  try {
    await ensureWallet(userId);
  } catch {
    return false;
  }
  const { data, error: readErr } = await supabaseAdmin
    .from("credit_wallets")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();
  if (readErr) return false;
  const current = Number(data?.balance ?? 0);
  const next = current + amount;
  const { error: updateErr } = await supabaseAdmin
    .from("credit_wallets")
    .update({ balance: next, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  return !updateErr;
}

async function shouldDeferDowngradeSwitch(userId: string, nextPlanId: string): Promise<boolean> {
  const { data: currentSub } = await supabaseAdmin
    .from("user_subscriptions")
    .select("plan_id, period_ends_at")
    .eq("user_id", userId)
    .maybeSingle();
  const nowIso = new Date().toISOString();
  if (!currentSub?.period_ends_at || currentSub.period_ends_at <= nowIso) return false;
  const currentPlan = getPlan(String(currentSub.plan_id ?? ""));
  const nextPlan = getPlan(String(nextPlanId ?? ""));
  if (!currentPlan || !nextPlan) return false;
  return nextPlan.credits < currentPlan.credits;
}

/**
 * GET /api/credits/paypal/complete?token=ORDER_ID
 * PayPal redirects here after buyer approval. We capture the order and add credits.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  let baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.VERCEL_URL ??
    (req.headers.get("x-forwarded-proto") && req.headers.get("x-forwarded-host")
      ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("x-forwarded-host")}`
      : "http://localhost:3000");
  if (!baseUrl.startsWith("http")) baseUrl = `https://${baseUrl}`;
  const creditsUrl = `${baseUrl.replace(/\/$/, "")}/credits`;

  if (!token) {
    return NextResponse.redirect(`${creditsUrl}?error=missing_token`);
  }

  const { data: subRow } = await supabaseAdmin
    .from("paypal_subscriptions")
    .select("id, user_id, plan_id, credits, amount_usd, status")
    .eq("subscription_id", token)
    .maybeSingle();

  if (subRow) {
    if (subRow.status === "active") {
      return NextResponse.redirect(`${creditsUrl}?success=1`);
    }
    try {
      const sub = await getPayPalSubscription(token);
      if (sub.status === "ACTIVE") {
        const now = new Date().toISOString();
        await supabaseAdmin
          .from("paypal_subscriptions")
          .update({ status: "active", activated_at: now })
          .eq("subscription_id", token)
          .eq("status", "pending");
        await supabaseAdmin.rpc("record_subscription_first_payment", {
          p_subscription_id: token,
          p_user_id: subRow.user_id,
          p_plan_id: subRow.plan_id,
          p_credits: subRow.credits,
          p_amount_usd: Number(subRow.amount_usd) || 0,
          p_paid_at: now,
          p_paypal_sale_id: null,
        });
        const deferDowngrade = await shouldDeferDowngradeSwitch(subRow.user_id, subRow.plan_id);
        if (!deferDowngrade) {
          const periodEndsAt = new Date();
          periodEndsAt.setDate(periodEndsAt.getDate() + 30);
          await supabaseAdmin.from("user_subscriptions").upsert(
            {
              user_id: subRow.user_id,
              plan_id: subRow.plan_id,
              period_ends_at: periodEndsAt.toISOString(),
              updated_at: now,
            },
            { onConflict: "user_id" }
          );
        }
        return NextResponse.redirect(`${creditsUrl}?success=1`);
      }
      if (sub.status === "APPROVAL_PENDING" || sub.status === "APPROVED") {
        return NextResponse.redirect(`${creditsUrl}?success=1&message=subscription_pending`);
      }
    } catch (e) {
      console.error("PayPal subscription complete error:", e);
      return NextResponse.redirect(`${creditsUrl}?error=subscription_failed`);
    }
    return NextResponse.redirect(`${creditsUrl}?success=1`);
  }

  const { data: orderRow, error: orderErr } = await supabaseAdmin
    .from("paypal_orders")
    .select("id, user_id, plan_id, credits, status")
    .eq("order_id", token)
    .maybeSingle();

  if (orderErr || !orderRow) {
    return NextResponse.redirect(`${creditsUrl}?error=order_not_found`);
  }

  if (orderRow.status === "captured") {
    return NextResponse.redirect(`${creditsUrl}?success=1`);
  }

  try {
    const { status } = await capturePayPalOrder(token);
    if (status !== "COMPLETED") {
      await supabaseAdmin
        .from("paypal_orders")
        .update({ status: "failed" })
        .eq("order_id", token);
      return NextResponse.redirect(`${creditsUrl}?error=capture_failed`);
    }
  } catch (e) {
    console.error("PayPal capture error:", e);
    return NextResponse.redirect(`${creditsUrl}?error=capture_failed`);
  }

  // 이중 지급 방지: pending 인 경우에만 captured 로 갱신. 동시 요청이어도 한 번만 성공.
  const { data: updated, error: updateOrderErr } = await supabaseAdmin
    .from("paypal_orders")
    .update({
      status: "captured",
      captured_at: new Date().toISOString(),
    })
    .eq("order_id", token)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (updateOrderErr || !updated) {
    if (!updated) {
      return NextResponse.redirect(`${creditsUrl}?success=1`);
    }
    console.error("PayPal complete: failed to mark order captured", updateOrderErr);
    return NextResponse.redirect(`${creditsUrl}?error=credits_failed`);
  }

  const ok = await addCredits(orderRow.user_id, orderRow.credits);
  if (!ok) {
    return NextResponse.redirect(`${creditsUrl}?error=credits_failed`);
  }

  const periodEndsAt = new Date();
  periodEndsAt.setDate(periodEndsAt.getDate() + 30);
  await supabaseAdmin.from("user_subscriptions").upsert(
    {
      user_id: orderRow.user_id,
      plan_id: orderRow.plan_id,
      period_ends_at: periodEndsAt.toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  return NextResponse.redirect(`${creditsUrl}?success=1`);
}

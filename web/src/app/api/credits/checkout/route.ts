import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { getPlan, type PlanId } from "@/lib/plans";
import { cancelPayPalSubscription, createPayPalOrder, createPayPalSubscription } from "@/lib/paypal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function getPayPalPlanId(planId: PlanId): string | null {
  const key = `PAYPAL_PLAN_ID_${planId.toUpperCase()}`;
  const value = process.env[key]?.trim();
  return value && value.length > 0 ? value : null;
}

export const runtime = "nodejs";

function getOrigin(): string {
  // 환경 변수에서만 origin을 결정. 클라이언트 헤더(x-forwarded-host)를 신뢰하지 않음.
  const configured =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL ?? "http://localhost:3000";
  const base = String(configured).replace(/\/$/, "");
  return base.startsWith("http") ? base : `https://${base}`;
}

export async function POST(req: Request) {
  try {
    const { error, userId } = await requireUserId(req);
    if (error || !userId) {
      return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
    }

    let body: { planId?: string };
    try {
      body = (await req.json()) as { planId?: string };
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const planId = (body.planId ?? "").trim() as PlanId;
    const plan = getPlan(planId);
    if (!plan) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    // Downgrade policy:
    // - If renewal is still active, block immediate downgrade.
    // - If user already cancelled renewal, allow starting lower plan now,
    //   but effective features are handled separately until current period ends.
    const nowIso = new Date().toISOString();
    const { data: currentSub } = await supabaseAdmin
      .from("user_subscriptions")
      .select("plan_id, period_ends_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (currentSub?.period_ends_at && currentSub.period_ends_at > nowIso) {
      const currentPlan = getPlan(String(currentSub.plan_id ?? ""));
      if (currentPlan && plan.credits < currentPlan.credits) {
        const [{ data: activeSub }, { data: cancelledSub }] = await Promise.all([
          supabaseAdmin
            .from("paypal_subscriptions")
            .select("subscription_id")
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
        ]);
        const hasActiveRenewal = !!activeSub?.subscription_id;
        const hasCancelledRenewal = !!cancelledSub?.subscription_id;
        if (hasActiveRenewal) {
          return NextResponse.json(
            {
              error: "Please cancel current plan renewal first. Downgrade can be started after cancellation.",
            },
            { status: 409 }
          );
        }
        if (!hasCancelledRenewal) {
          return NextResponse.json(
            {
              error: `Downgrade is available after cancellation. Current plan remains active until ${new Date(currentSub.period_ends_at).toLocaleDateString()}.`,
            },
            { status: 409 }
          );
        }
      }
    }

    const paypalClientId = (process.env.PAYPAL_CLIENT_ID ?? "").trim();
    const paypalSecret = (process.env.PAYPAL_CLIENT_SECRET ?? "").trim();
    if (!paypalClientId || !paypalSecret) {
      const missing: string[] = [];
      if (!paypalClientId) missing.push("PAYPAL_CLIENT_ID");
      if (!paypalSecret) missing.push("PAYPAL_CLIENT_SECRET");
      return NextResponse.json(
        {
          error: `PayPal is not configured: ${missing.join(" and ")} is missing or empty. Restart the dev server (npm run dev) after changing .env.local.`,
        },
        { status: 503 }
      );
    }

    const origin = getOrigin();
    let returnUrl = `${origin}/api/credits/paypal/complete`;
    let cancelUrl = `${origin}/credits`;
    try {
      new URL(returnUrl);
      new URL(cancelUrl);
    } catch {
      return NextResponse.json(
        { error: "Invalid server URL. Set NEXT_PUBLIC_APP_URL or VERCEL_URL." },
        { status: 500 }
      );
    }

    try {
      const paypalPlanId = getPayPalPlanId(planId);

      if (paypalPlanId) {
        const { data: existingSub } = await supabaseAdmin
          .from("paypal_subscriptions")
          .select("subscription_id")
          .eq("user_id", userId)
          .eq("status", "active")
          .maybeSingle();

        if (existingSub?.subscription_id) {
          try {
            await cancelPayPalSubscription(existingSub.subscription_id, "Upgrading or changing plan");
          } catch (e) {
            console.error("PayPal cancel (upgrade) error:", e);
          }
          await supabaseAdmin
            .from("paypal_subscriptions")
            .update({ status: "cancelled" })
            .eq("subscription_id", existingSub.subscription_id);
        }

        const { subscriptionId, approvalUrl } = await createPayPalSubscription({
          planIdPayPal: paypalPlanId,
          customId: `${userId}:${planId}`,
          returnUrl,
          cancelUrl,
        });
        if (!approvalUrl || !approvalUrl.startsWith("http")) {
          return NextResponse.json(
            { error: "PayPal returned an invalid subscription URL." },
            { status: 500 }
          );
        }
        const { error: subErr } = await supabaseAdmin.from("paypal_subscriptions").insert({
          subscription_id: subscriptionId,
          user_id: userId,
          plan_id: planId,
          credits: plan.credits,
          amount_usd: plan.priceUsd,
          status: "pending",
        });
        if (subErr) {
          console.error("PayPal subscription insert error:", subErr);
          return NextResponse.json(
            { error: "Failed to save subscription. Check server logs." },
            { status: 500 }
          );
        }
        return NextResponse.json({ url: approvalUrl });
      }

      const { orderId, approvalUrl } = await createPayPalOrder({
        amountUsd: plan.priceUsd.toFixed(2),
        customId: `${userId}:${planId}`,
        description: `${plan.name} - ${plan.credits.toLocaleString()} credits/month`,
        returnUrl,
        cancelUrl,
      });
      if (!approvalUrl || !approvalUrl.startsWith("http")) {
        return NextResponse.json(
          { error: "PayPal returned an invalid checkout URL." },
          { status: 500 }
        );
      }
      await supabaseAdmin.from("paypal_orders").insert({
        order_id: orderId,
        user_id: userId,
        plan_id: planId,
        credits: plan.credits,
        amount_usd: plan.priceUsd,
        status: "pending",
      });
      return NextResponse.json({ url: approvalUrl });
    } catch (e) {
      console.error("PayPal create order error:", e);
      return NextResponse.json(
        { error: "Failed to create PayPal order. Check server logs." },
        { status: 500 }
      );
    }
  } catch (e) {
    console.error("Checkout API error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Checkout failed" },
      { status: 500 }
    );
  }
}

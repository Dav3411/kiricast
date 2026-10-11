import { NextResponse } from "next/server";
import { getPayPalSubscription, verifyPayPalWebhookSignature } from "@/lib/paypal";
import { getPlan } from "@/lib/plans";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

async function ensureWallet(userId: string) {
  const { error } = await supabaseAdmin.from("credit_wallets").insert({
    user_id: userId,
    balance: 0,
    updated_at: new Date().toISOString(),
  });
  if (error?.code === "23505") return;
  if (error) throw error;
}

/**
 * Atomic credit increment via Supabase RPC.
 * 필요한 DB 함수:
 *   CREATE OR REPLACE FUNCTION increment_credit_balance(p_user_id uuid, p_amount int)
 *   RETURNS void AS $$
 *     UPDATE credit_wallets
 *     SET balance = balance + p_amount, updated_at = now()
 *     WHERE user_id = p_user_id;
 *   $$ LANGUAGE sql;
 */
async function addCredits(userId: string, amount: number): Promise<boolean> {
  if (amount <= 0) return false;
  try {
    await ensureWallet(userId);
  } catch {
    return false;
  }
  const { error } = await supabaseAdmin.rpc("increment_credit_balance", {
    p_user_id: userId,
    p_amount: amount,
  });
  return !error;
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
 * POST /api/credits/paypal/webhook
 * PayPal 구독 웹훅: BILLING.SUBSCRIPTION.ACTIVATED, PAYMENT.SALE.COMPLETED
 * PAYPAL_WEBHOOK_ID 설정 시 서명 검증 수행. 미설정 시 요청 거부.
 */
export async function POST(req: Request) {
  try {
    const webhookId = process.env.PAYPAL_WEBHOOK_ID?.trim();
    if (!webhookId) {
      console.error("PayPal webhook: PAYPAL_WEBHOOK_ID is not configured");
      return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
    }

    const rawBody = await req.text();
    let body: {
      event_type?: string;
      resource?: {
        id?: string;
        billing_agreement_id?: string;
        amount?: { total?: string };
      };
    };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const transmissionId = req.headers.get("paypal-transmission-id") ?? "";
    const transmissionTime = req.headers.get("paypal-transmission-time") ?? "";
    const transmissionSig = req.headers.get("paypal-transmission-sig") ?? "";
    const certUrl = req.headers.get("paypal-cert-url") ?? "";

    if (!transmissionId || !transmissionSig) {
      return NextResponse.json({ error: "Missing signature headers" }, { status: 403 });
    }

    const verified = await verifyPayPalWebhookSignature({
      transmissionId,
      transmissionTime,
      transmissionSig,
      certUrl,
      webhookId,
      body,
    });
    if (!verified) {
      console.warn("PayPal webhook: signature verification failed");
      return NextResponse.json({ error: "Signature verification failed" }, { status: 403 });
    }

    const eventType = body.event_type ?? "";
    const resource = body.resource ?? {};

    if (eventType === "BILLING.SUBSCRIPTION.ACTIVATED") {
      const subscriptionId = resource.id;
      if (!subscriptionId) return NextResponse.json({ received: true }, { status: 200 });
      const { data: subRow } = await supabaseAdmin
        .from("paypal_subscriptions")
        .select("id, user_id, plan_id, credits, status")
        .eq("subscription_id", subscriptionId)
        .maybeSingle();
      if (subRow && subRow.status === "pending") {
        await supabaseAdmin
          .from("paypal_subscriptions")
          .update({ status: "active", activated_at: new Date().toISOString() })
          .eq("subscription_id", subscriptionId)
          .eq("status", "pending");
        const deferDowngrade = await shouldDeferDowngradeSwitch(subRow.user_id, subRow.plan_id);
        if (!deferDowngrade) {
          const periodEndsAt = new Date();
          periodEndsAt.setDate(periodEndsAt.getDate() + 30);
          await supabaseAdmin.from("user_subscriptions").upsert(
            {
              user_id: subRow.user_id,
              plan_id: subRow.plan_id,
              period_ends_at: periodEndsAt.toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          );
        }
      }
      return NextResponse.json({ received: true }, { status: 200 });
    }

    if (eventType === "BILLING.SUBSCRIPTION.CANCELLED") {
      const subscriptionId = resource.id;
      if (!subscriptionId) return NextResponse.json({ received: true }, { status: 200 });
      await supabaseAdmin
        .from("paypal_subscriptions")
        .update({ status: "cancelled" })
        .eq("subscription_id", subscriptionId);
      return NextResponse.json({ received: true }, { status: 200 });
    }

    if (eventType === "PAYMENT.SALE.COMPLETED") {
      const subscriptionId = resource.billing_agreement_id ?? resource.id;
      if (!subscriptionId || !subscriptionId.startsWith("I-")) {
        return NextResponse.json({ received: true }, { status: 200 });
      }
      const { data: subRow } = await supabaseAdmin
        .from("paypal_subscriptions")
        .select("id, user_id, plan_id, credits, amount_usd, status, activated_at")
        .eq("subscription_id", subscriptionId)
        .maybeSingle();

      if (!subRow) {
        return NextResponse.json({ received: true }, { status: 200 });
      }

      const paypalSaleId = typeof resource.id === "string" ? resource.id.trim() || null : null;
      const amountUsd =
        Number(resource.amount?.total) || Number(subRow.amount_usd) || 0;
      const paidAt = new Date().toISOString();

      if (subRow.status === "pending") {
        await supabaseAdmin.rpc("record_subscription_first_payment", {
          p_subscription_id: subscriptionId,
          p_user_id: subRow.user_id,
          p_plan_id: subRow.plan_id,
          p_credits: subRow.credits,
          p_amount_usd: amountUsd,
          p_paid_at: paidAt,
          p_paypal_sale_id: paypalSaleId,
        });
        await supabaseAdmin
          .from("paypal_subscriptions")
          .update({ status: "active", activated_at: paidAt })
          .eq("subscription_id", subscriptionId)
          .eq("status", "pending");
        const deferDowngrade = await shouldDeferDowngradeSwitch(subRow.user_id, subRow.plan_id);
        if (!deferDowngrade) {
          const periodEndsAt = new Date();
          periodEndsAt.setDate(periodEndsAt.getDate() + 30);
          await supabaseAdmin.from("user_subscriptions").upsert(
            {
              user_id: subRow.user_id,
              plan_id: subRow.plan_id,
              period_ends_at: periodEndsAt.toISOString(),
              updated_at: paidAt,
            },
            { onConflict: "user_id" }
          );
        }
        return NextResponse.json({ received: true }, { status: 200 });
      }

      if (subRow.status === "active") {
        const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const { data: existingRow } = await supabaseAdmin
          .from("paypal_subscription_payments")
          .select("id")
          .eq("subscription_id", subscriptionId)
          .gte("paid_at", tenMinAgo)
          .is("paypal_sale_id", null)
          .eq("is_first_payment", true)
          .maybeSingle();
        if (existingRow) {
          if (paypalSaleId) {
            await supabaseAdmin
              .from("paypal_subscription_payments")
              .update({ paypal_sale_id: paypalSaleId })
              .eq("id", existingRow.id);
          }
        } else {
          const alreadyBySale =
            paypalSaleId &&
            (await supabaseAdmin
              .from("paypal_subscription_payments")
              .select("id")
              .eq("paypal_sale_id", paypalSaleId)
              .maybeSingle()).data;
          if (!alreadyBySale) {
            await addCredits(subRow.user_id, subRow.credits);
            const { error: payErr } = await supabaseAdmin
              .from("paypal_subscription_payments")
              .insert({
                subscription_id: subscriptionId,
                user_id: subRow.user_id,
                plan_id: subRow.plan_id,
                credits: subRow.credits,
                amount_usd: amountUsd,
                paid_at: paidAt,
                paypal_sale_id: paypalSaleId,
                is_first_payment: false,
              });
            if (payErr && payErr.code !== "23505") {
              console.error("paypal_subscription_payments insert error:", payErr);
            }
          }
        }
        const deferDowngrade = await shouldDeferDowngradeSwitch(subRow.user_id, subRow.plan_id);
        if (!deferDowngrade) {
          const { data: cur } = await supabaseAdmin
            .from("user_subscriptions")
            .select("period_ends_at")
            .eq("user_id", subRow.user_id)
            .maybeSingle();
          const base = cur?.period_ends_at ? new Date(cur.period_ends_at) : new Date();
          if (base.getTime() < Date.now()) base.setTime(Date.now());
          base.setDate(base.getDate() + 30);
          await supabaseAdmin.from("user_subscriptions").upsert(
            {
              user_id: subRow.user_id,
              plan_id: subRow.plan_id,
              period_ends_at: base.toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          );
        }
      }
      return NextResponse.json({ received: true }, { status: 200 });
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (e) {
    console.error("PayPal webhook error:", e);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

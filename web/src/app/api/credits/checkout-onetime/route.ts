import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { createPayPalOrder } from "@/lib/paypal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const ONE_TIME_PACK = {
  planId: "one_time_5000",
  credits: 5000,
  amountUsd: 49.99,
  description: "One-time credits - 5,000 credits",
} as const;

function getOrigin(req: Request): string {
  const x = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  if (x) {
    const origin = `${proto}://${x}`.replace(/\/$/, "");
    if (origin.startsWith("http")) return origin;
  }
  const fallback =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL ?? "http://localhost:3000";
  const base = String(fallback).replace(/\/$/, "");
  return base.startsWith("http") ? base : `https://${base}`;
}

export async function POST(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const paypalClientId = (process.env.PAYPAL_CLIENT_ID ?? "").trim();
  const paypalSecret = (process.env.PAYPAL_CLIENT_SECRET ?? "").trim();
  if (!paypalClientId || !paypalSecret) {
    return NextResponse.json({ error: "PayPal is not configured." }, { status: 503 });
  }

  const origin = getOrigin(req);
  const returnUrl = `${origin}/api/credits/paypal/complete-onetime`;
  const cancelUrl = `${origin}/credits/one-time`;

  try {
    const { orderId, approvalUrl } = await createPayPalOrder({
      amountUsd: ONE_TIME_PACK.amountUsd.toFixed(2),
      customId: `${userId}:${ONE_TIME_PACK.planId}`,
      description: ONE_TIME_PACK.description,
      returnUrl,
      cancelUrl,
    });

    if (!approvalUrl || !approvalUrl.startsWith("http")) {
      return NextResponse.json({ error: "PayPal returned an invalid checkout URL." }, { status: 500 });
    }

    const { error: insertErr } = await supabaseAdmin.from("paypal_orders").insert({
      order_id: orderId,
      user_id: userId,
      plan_id: ONE_TIME_PACK.planId,
      credits: ONE_TIME_PACK.credits,
      amount_usd: ONE_TIME_PACK.amountUsd,
      status: "pending",
    });
    if (insertErr) {
      console.error("PayPal one-time order insert error:", insertErr);
      return NextResponse.json({ error: "Failed to save order." }, { status: 500 });
    }

    return NextResponse.json({ url: approvalUrl });
  } catch (e) {
    console.error("PayPal one-time checkout error:", e);
    return NextResponse.json({ error: "Failed to create PayPal order." }, { status: 500 });
  }
}


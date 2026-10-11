import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { cancelPayPalSubscription } from "@/lib/paypal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/**
 * POST /api/credits/subscription/cancel
 * Cancel current user's PayPal subscription. Access continues until period_ends_at.
 */
export async function POST(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const { data: sub, error: subErr } = await supabaseAdmin
    .from("paypal_subscriptions")
    .select("subscription_id, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (subErr || !sub?.subscription_id) {
    return NextResponse.json(
      { error: "No active subscription to cancel." },
      { status: 404 }
    );
  }

  try {
    await cancelPayPalSubscription(sub.subscription_id, "User requested cancellation");
  } catch (e) {
    console.error("PayPal cancel subscription error:", e);
    return NextResponse.json(
      { error: "Failed to cancel with PayPal. Try again or cancel from your PayPal account." },
      { status: 502 }
    );
  }

  const { error: updateErr } = await supabaseAdmin
    .from("paypal_subscriptions")
    .update({ status: "cancelled" })
    .eq("subscription_id", sub.subscription_id);

  if (updateErr) {
    console.error("paypal_subscriptions update error:", updateErr);
    return NextResponse.json(
      { error: "Subscription was cancelled with PayPal but our record update failed." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}

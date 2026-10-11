import { NextResponse } from "next/server";
import { capturePayPalOrder } from "@/lib/paypal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const ONE_TIME_PLAN_ID = "one_time_5000";

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
  const oneTimeUrl = `${baseUrl.replace(/\/$/, "")}/credits/one-time`;

  if (!token) {
    return NextResponse.redirect(`${oneTimeUrl}?error=missing_token`);
  }

  const { data: orderRow, error: orderErr } = await supabaseAdmin
    .from("paypal_orders")
    .select("id, user_id, plan_id, credits, status")
    .eq("order_id", token)
    .maybeSingle();

  if (orderErr || !orderRow) {
    return NextResponse.redirect(`${oneTimeUrl}?error=order_not_found`);
  }
  if (orderRow.plan_id !== ONE_TIME_PLAN_ID) {
    return NextResponse.redirect(`${oneTimeUrl}?error=invalid_order_type`);
  }
  if (orderRow.status === "captured") {
    return NextResponse.redirect(`${oneTimeUrl}?success=1`);
  }

  try {
    const { status } = await capturePayPalOrder(token);
    if (status !== "COMPLETED") {
      await supabaseAdmin.from("paypal_orders").update({ status: "failed" }).eq("order_id", token);
      return NextResponse.redirect(`${oneTimeUrl}?error=capture_failed`);
    }
  } catch (e) {
    console.error("PayPal one-time capture error:", e);
    return NextResponse.redirect(`${oneTimeUrl}?error=capture_failed`);
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("paypal_orders")
    .update({
      status: "captured",
      captured_at: new Date().toISOString(),
    })
    .eq("order_id", token)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (updateErr || !updated) {
    if (!updated) return NextResponse.redirect(`${oneTimeUrl}?success=1`);
    console.error("PayPal one-time complete: failed to mark captured", updateErr);
    return NextResponse.redirect(`${oneTimeUrl}?error=credits_failed`);
  }

  const ok = await addCredits(orderRow.user_id, Number(orderRow.credits ?? 0));
  if (!ok) {
    return NextResponse.redirect(`${oneTimeUrl}?error=credits_failed`);
  }

  return NextResponse.redirect(`${oneTimeUrl}?success=1`);
}


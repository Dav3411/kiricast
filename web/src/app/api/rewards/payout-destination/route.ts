import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

/**
 * GET /api/rewards/payout-destination
 * 인증된 유저 본인의 출금 수령처(PayPal 이메일) 조회.
 */
export async function GET(req: Request) {
  const { error: authErr, userId } = await requireUserId(req);
  if (authErr || !userId) {
    return NextResponse.json({ error: authErr ?? "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("payout_destinations")
    .select("paypal_email, method, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to load payout destination" }, { status: 500 });
  }

  return NextResponse.json({
    paypalEmail: data?.paypal_email ?? null,
    method: data?.method ?? "paypal",
    updatedAt: data?.updated_at ?? null,
  });
}

/**
 * PATCH /api/rewards/payout-destination
 * 인증된 유저 본인의 출금 수령처(PayPal 이메일) 저장.
 */
export async function PATCH(req: Request) {
  const { error: authErr, userId } = await requireUserId(req);
  if (authErr || !userId) {
    return NextResponse.json({ error: authErr ?? "Unauthorized" }, { status: 401 });
  }

  let body: { paypalEmail?: string | null };
  try {
    body = (await req.json()) as { paypalEmail?: string | null };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = typeof body.paypalEmail === "string" ? body.paypalEmail.trim() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid PayPal email format" }, { status: 400 });
  }

  const { error: upsertErr } = await supabaseAdmin
    .from("payout_destinations")
    .upsert(
      {
        user_id: userId,
        method: "paypal",
        paypal_email: email || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

  if (upsertErr) {
    return NextResponse.json({ error: "Failed to save payout destination" }, { status: 500 });
  }

  return NextResponse.json({
    paypalEmail: email,
    updatedAt: new Date().toISOString(),
  });
}

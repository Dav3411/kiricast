import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { createPayPalPayout } from "@/lib/paypal";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * POST /api/rewards/withdraw
 * 출금 요청. user_wallets.reward_balance_usd 에서 차감 후 withdrawal_requests 에 pending 으로 등록.
 * 이중 요청 방지: 동일 유저의 pending 요청이 있으면 거절하거나, 최소 출금액·횟수 제한 가능.
 */
export async function POST(req: Request) {
  const { error: authErr, userId } = await requireUserId(req);
  if (authErr || !userId) {
    return NextResponse.json({ error: authErr ?? "Unauthorized" }, { status: 401 });
  }

  let body: { amountUsd?: number };
  try {
    body = (await req.json()) as { amountUsd?: number };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const amountUsd = Number(body.amountUsd ?? 0);
  const minWithdraw = Number(process.env.MIN_WITHDRAWAL_USD ?? "5");
  if (!Number.isFinite(amountUsd) || amountUsd < minWithdraw) {
    return NextResponse.json(
      { error: `Minimum withdrawal is $${minWithdraw}` },
      { status: 400 }
    );
  }

  const { data: dest } = await supabaseAdmin
    .from("payout_destinations")
    .select("paypal_email")
    .eq("user_id", userId)
    .maybeSingle();
  const paypalEmail = dest?.paypal_email?.trim();
  if (!paypalEmail) {
    return NextResponse.json(
      { error: "Register a PayPal email in My page to withdraw." },
      { status: 400 }
    );
  }

  // Prevent duplicate pending withdrawal
  const { data: pending } = await supabaseAdmin
    .from("withdrawal_requests")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();

  if (pending) {
    return NextResponse.json(
      { error: "You already have a pending withdrawal" },
      { status: 400 }
    );
  }

  /**
   * Atomic deduct via RPC. Race-condition safe.
   * 필요한 DB 함수:
   *   CREATE OR REPLACE FUNCTION deduct_reward_balance(p_user_id uuid, p_amount numeric)
   *   RETURNS numeric AS $$
   *     UPDATE user_wallets
   *     SET reward_balance_usd = reward_balance_usd - p_amount, updated_at = now()
   *     WHERE user_id = p_user_id AND reward_balance_usd >= p_amount
   *     RETURNING reward_balance_usd;
   *   $$ LANGUAGE sql;
   */
  const { data: deductResult, error: updateErr } = await supabaseAdmin.rpc(
    "deduct_reward_balance",
    { p_user_id: userId, p_amount: amountUsd }
  );

  if (updateErr || deductResult === null || deductResult === undefined) {
    return NextResponse.json(
      { error: "Insufficient reward balance" },
      { status: 400 }
    );
  }

  const balance = amountUsd + Number(deductResult ?? 0); // pre-deduction balance for rollback

  const { data: withdrawal, error: insertErr } = await supabaseAdmin
    .from("withdrawal_requests")
    .insert({
      user_id: userId,
      amount_usd: amountUsd,
      status: "pending",
    })
    .select("id, amount_usd, status, created_at")
    .single();

  if (insertErr) {
    // 잔액은 이미 차감됐으므로 복구 필요 (또는 트랜잭션 사용 권장)
    await supabaseAdmin
      .from("user_wallets")
      .upsert(
        {
          user_id: userId,
          reward_balance_usd: balance,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    return NextResponse.json({ error: "Failed to create withdrawal request" }, { status: 500 });
  }

  const payoutsEnabled =
    process.env.PAYPAL_PAYOUTS_ENABLED === "true" || process.env.PAYPAL_PAYOUTS_ENABLED === "1";
  let finalStatus = withdrawal.status as string;
  let balanceRolledBack: boolean | null = null;

  if (payoutsEnabled && paypalEmail) {
      try {
        await createPayPalPayout({
          amountUsd,
          receiverEmail: paypalEmail,
          senderBatchId: String(withdrawal.id),
          note: "Reward withdrawal",
        });
        finalStatus = "completed";
        await supabaseAdmin
          .from("withdrawal_requests")
          .update({
            status: "completed",
            processed_at: new Date().toISOString(),
            note: null,
          })
          .eq("id", withdrawal.id);
        balanceRolledBack = false;
      } catch (err) {
        const message = err instanceof Error ? err.message : "PayPal payout failed";
        // PayPal 지급 실패 시 차감했던 잔액 자동 롤백
        const { data: latestWallet } = await supabaseAdmin
          .from("user_wallets")
          .select("reward_balance_usd")
          .eq("user_id", userId)
          .maybeSingle();
        const latestBalance = Number(latestWallet?.reward_balance_usd ?? 0);
        const restoredBalance = round2(latestBalance + amountUsd);
        const { error: rollbackErr } = await supabaseAdmin
          .from("user_wallets")
          .upsert(
            {
              user_id: userId,
              reward_balance_usd: restoredBalance,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" }
          );

        await supabaseAdmin
          .from("withdrawal_requests")
          .update({
            status: "failed",
            note: rollbackErr
              ? `${message} | balance rollback failed`.slice(0, 500)
              : `${message} | balance rolled back`.slice(0, 500),
          })
          .eq("id", withdrawal.id);
        finalStatus = "failed";
        balanceRolledBack = !rollbackErr;
      }
  }

  return NextResponse.json({
    id: withdrawal.id,
    amountUsd: withdrawal.amount_usd,
    status: finalStatus,
    balanceRolledBack,
    createdAt: withdrawal.created_at,
  });
}

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { serverFeatures } from "@/lib/featuresServer";

export const runtime = "nodejs";

function toInt(raw: string | undefined, fallback: number) {
  const n = Number(raw ?? "");
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return fallback;
  return n;
}

async function ensureWallet(userId: string) {
  await supabaseAdmin
    .from("credit_wallets")
    .insert({ user_id: userId, balance: 0 })
    .select("user_id")
    .maybeSingle();
}

async function addCredits(userId: string, amount: number) {
  if (amount <= 0) return null;
  await ensureWallet(userId);
  // Atomic increment via RPC (race-condition safe)
  const { error } = await supabaseAdmin.rpc("increment_credit_balance", {
    p_user_id: userId,
    p_amount: amount,
  });
  return error ? null : amount;
}

export async function POST(req: Request) {
  if (!serverFeatures.referrals) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const referrerBonus = toInt(process.env.REFERRAL_REFERRER_BONUS, 500);
  const referredBonus = toInt(process.env.REFERRAL_REFERRED_BONUS, 500);

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("referrals")
    .select("id, referrer_user_id, status, rewarded_at")
    .eq("referred_user_id", userId)
    .maybeSingle();

  if (fetchErr) {
    const msg = fetchErr.message ?? "";
    if (msg.toLowerCase().includes("relation") && msg.toLowerCase().includes("referrals")) {
      return NextResponse.json(
        { error: "Referrals table not configured" },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: "Failed to load referral" }, { status: 500 });
  }

  if (!row?.id || !row.referrer_user_id) {
    return NextResponse.json({ ok: true, rewarded: false, reason: "no_referral" });
  }
  if (row.rewarded_at || row.status === "rewarded") {
    return NextResponse.json({ ok: true, rewarded: false, reason: "already_rewarded" });
  }

  const now = new Date().toISOString();
  const referrerId = String(row.referrer_user_id);

  const referrerBalance = await addCredits(referrerId, referrerBonus);
  const referredBalance = await addCredits(userId, referredBonus);

  await supabaseAdmin
    .from("referrals")
    .update({ status: "rewarded", rewarded_at: now })
    .eq("id", row.id);

  return NextResponse.json({
    ok: true,
    rewarded: true,
    referrerBonus,
    referredBonus,
  });
}


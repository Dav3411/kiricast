import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireCreditsAdmin } from "@/lib/adminAuth";

export const runtime = "nodejs";

type Body = {
  userId?: string;
  amount?: number;
  mode?: "delta" | "set";
};

/** 관리자: 유저별 크레딧 잔액 목록 (닉네임 포함). 시크릿 + 로그인 + ADMIN_USER_IDS(선택) 필요 */
export async function GET(req: Request) {
  const auth = await requireCreditsAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data: wallets, error: walletsErr } = await supabaseAdmin
    .from("credit_wallets")
    .select("user_id, balance, updated_at")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (walletsErr) {
    return NextResponse.json({ error: "Failed to load wallets" }, { status: 500 });
  }

  const userIds = (wallets ?? []).map((w) => w.user_id);
  let nicknames: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id, nickname")
      .in("user_id", userIds);
    for (const p of profiles ?? []) {
      nicknames[p.user_id] = p.nickname ?? "";
    }
  }

  const list = (wallets ?? []).map((w) => ({
    userId: w.user_id,
    balance: w.balance,
    nickname: nicknames[w.user_id] ?? null,
    updatedAt: w.updated_at,
  }));

  return NextResponse.json({ wallets: list });
}

export async function POST(req: Request) {
  const auth = await requireCreditsAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = body.userId?.trim() ?? "";
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const mode = body.mode ?? "delta";
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    return NextResponse.json({ error: "amount must be an integer" }, { status: 400 });
  }
  if (mode === "delta" && amount === 0) {
    return NextResponse.json({ error: "amount must be non-zero" }, { status: 400 });
  }

  const { error: insertErr } = await supabaseAdmin
    .from("credit_wallets")
    .insert({ user_id: userId, balance: 0, updated_at: new Date().toISOString() });
  if (insertErr && insertErr.code !== "23505") {
    return NextResponse.json({ error: "Failed to ensure wallet" }, { status: 500 });
  }

  const { data: wallet, error: readErr } = await supabaseAdmin
    .from("credit_wallets")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ error: "Failed to load wallet" }, { status: 500 });
  }

  const current = Number(wallet?.balance ?? 0);
  const next = mode === "set" ? amount : current + amount;
  if (next < 0) {
    return NextResponse.json({ error: "Balance cannot be negative" }, { status: 400 });
  }

  const { error: updateErr } = await supabaseAdmin
    .from("credit_wallets")
    .update({ balance: next, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (updateErr) {
    return NextResponse.json({ error: "Failed to update wallet" }, { status: 500 });
  }

  return NextResponse.json({ userId, balance: next });
}

/** 관리자: 유저 크레딧 지갑 삭제 (해당 유저 행 제거, 목록에서 사라짐) */
export async function DELETE(req: Request) {
  const auth = await requireCreditsAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { userId?: string };
  try {
    body = (await req.json()) as { userId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = body.userId?.trim() ?? "";
  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("credit_wallets")
    .delete()
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: "Failed to delete wallet" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, userId });
}

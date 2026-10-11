import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

export async function POST(req: Request) {
  let body: { email?: string; code?: string; password?: string; nickname?: string };
  try {
    body = (await req.json()) as {
      email?: string;
      code?: string;
      password?: string;
      nickname?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const code = typeof body.code === "string" ? body.code.trim().replace(/\D/g, "") : "";
  const password = typeof body.password === "string" ? body.password : "";
  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }
  if (code.length !== 6) {
    return NextResponse.json({ error: "Valid 6-digit code is required" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }
  if (nickname.length < 1 || nickname.length > 32) {
    return NextResponse.json({ error: "Nickname must be 1–32 characters" }, { status: 400 });
  }

  const MAX_OTP_ATTEMPTS = 5;

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("signup_otps")
    .select("otp_hash, nickname, expires_at, attempts")
    .eq("email", email)
    .single();
  if (fetchErr || !row) {
    return NextResponse.json({ error: "Invalid or expired code. Request a new code." }, { status: 400 });
  }
  const expiresAt = new Date((row as { expires_at: string }).expires_at).getTime();
  if (Date.now() > expiresAt) {
    await supabaseAdmin.from("signup_otps").delete().eq("email", email);
    return NextResponse.json({ error: "Code expired. Request a new code." }, { status: 400 });
  }
  const attempts = Number((row as { attempts?: number }).attempts ?? 0);
  if (attempts >= MAX_OTP_ATTEMPTS) {
    await supabaseAdmin.from("signup_otps").delete().eq("email", email);
    return NextResponse.json({ error: "Too many attempts. Request a new code." }, { status: 429 });
  }
  const expectedHash = (row as { otp_hash: string }).otp_hash;
  const codeHash = hashOtp(code);
  const hashMatch =
    codeHash.length === expectedHash.length &&
    timingSafeEqual(Buffer.from(codeHash), Buffer.from(expectedHash));
  if (!hashMatch) {
    await supabaseAdmin
      .from("signup_otps")
      .update({ attempts: attempts + 1 })
      .eq("email", email);
    return NextResponse.json({ error: "Invalid code." }, { status: 400 });
  }
  await supabaseAdmin.from("signup_otps").delete().eq("email", email);

  const storedNickname = (row as { nickname?: string }).nickname ?? nickname;
  const { data: user, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nickname: storedNickname },
  });
  if (createErr) {
    if (createErr.message?.includes("already been registered")) {
      return NextResponse.json({ error: "This email is already registered" }, { status: 400 });
    }
    console.error("User creation error:", createErr.message);
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, userId: user?.user?.id });
}

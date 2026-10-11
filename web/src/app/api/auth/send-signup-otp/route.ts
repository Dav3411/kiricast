import { NextResponse } from "next/server";
import { createHash, randomInt } from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const OTP_EXPIRY_MINUTES = 10;
/** Resend로 전송되는 인증 코드 자릿수 (6자리 고정) */
const OTP_LENGTH = 6;

function hashOtp(otp: string): string {
  return createHash("sha256").update(otp).digest("hex");
}

function generateOtp(): string {
  let s = "";
  for (let i = 0; i < OTP_LENGTH; i++) {
    s += randomInt(0, 10).toString();
  }
  return s;
}

async function sendOtpEmail(to: string, otp: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.SIGNUP_OTP_FROM_EMAIL?.trim() || "Kiricast <onboarding@resend.dev>";
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not set. Configure it to send signup verification emails.");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Your Kiricast signup verification code",
      html: `
        <h2>Verify your email</h2>
        <p>Your verification code is: <strong style="font-size:24px; letter-spacing:4px;">${otp}</strong></p>
        <p>Enter this code on the signup page. It expires in ${OTP_EXPIRY_MINUTES} minutes.</p>
        <p>If you didn't request this, you can ignore this email.</p>
      `,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Failed to send email: ${res.status} ${t}`);
  }
}

export async function POST(req: Request) {
  let body: { email?: string; nickname?: string };
  try {
    body = (await req.json()) as { email?: string; nickname?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const nickname = typeof body.nickname === "string" ? body.nickname.trim() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }
  if (nickname.length < 1 || nickname.length > 32) {
    return NextResponse.json({ error: "Nickname must be 1–32 characters" }, { status: 400 });
  }

  // 동일 이메일에 대해 아직 유효한 OTP가 있으면 재발송 차단 (최소 60초 간격)
  const MIN_RESEND_SEC = 60;
  const { data: existing } = await supabaseAdmin
    .from("signup_otps")
    .select("expires_at")
    .eq("email", email)
    .maybeSingle();
  if (existing?.expires_at) {
    const remainingSec =
      (new Date(existing.expires_at).getTime() - Date.now()) / 1000;
    // OTP가 아직 유효하고, 발급된 지 MIN_RESEND_SEC 미만이면 차단
    if (remainingSec > (OTP_EXPIRY_MINUTES * 60 - MIN_RESEND_SEC)) {
      return NextResponse.json(
        { error: "Code already sent. Please wait before requesting a new one." },
        { status: 429 }
      );
    }
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();
  try {
    await sendOtpEmail(email, otp);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to send email";
    return NextResponse.json({ error: msg }, { status: 503 });
  }
  const otpHash = hashOtp(otp);
  await supabaseAdmin.from("signup_otps").upsert(
    { email, otp_hash: otpHash, nickname, expires_at: expiresAt, attempts: 0 },
    { onConflict: "email" }
  );
  return NextResponse.json({ ok: true });
}

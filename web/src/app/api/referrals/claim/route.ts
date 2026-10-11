import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { serverFeatures } from "@/lib/featuresServer";

export const runtime = "nodejs";

type Body = {
  referrerId?: string;
};

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

export async function POST(req: Request) {
  if (!serverFeatures.referrals) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const referrerId = body.referrerId?.trim() ?? "";
  if (!referrerId || !isUuid(referrerId)) {
    return NextResponse.json({ error: "Invalid referrerId" }, { status: 400 });
  }
  if (referrerId === userId) {
    return NextResponse.json({ error: "Self referral not allowed" }, { status: 400 });
  }

  const { error: insertErr } = await supabaseAdmin.from("referrals").insert({
    referrer_user_id: referrerId,
    referred_user_id: userId,
    status: "pending",
    rewarded_at: null,
  });

  if (insertErr) {
    const msg = insertErr.message ?? "";
    if (msg.toLowerCase().includes("relation") && msg.toLowerCase().includes("referrals")) {
      return NextResponse.json(
        { error: "Referrals table not configured" },
        { status: 500 }
      );
    }
    if (msg.toLowerCase().includes("duplicate")) {
      return NextResponse.json({ ok: true, alreadyClaimed: true });
    }
    return NextResponse.json({ error: "Failed to claim referral" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, alreadyClaimed: false });
}


import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import crypto from "crypto";
import { serverFeatures } from "@/lib/featuresServer";

export const runtime = "nodejs";

function assignVariant(userId: string) {
  const hex = crypto.createHash("sha256").update(userId).digest("hex");
  const bucket = parseInt(hex.slice(0, 2), 16) % 2;
  return bucket === 1 ? "free_first_clip" : "control";
}

export async function GET(req: Request) {
  if (!serverFeatures.freeFirstClipAb) {
    return NextResponse.json({ eligible: false, enabled: false, reason: "disabled" });
  }

  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  const variant = assignVariant(userId);
  if (variant !== "free_first_clip") {
    return NextResponse.json({ eligible: false, variant, reason: "not_in_variant" });
  }

  const { count, error: countErr } = await supabaseAdmin
    .from("clips")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);

  if (countErr) {
    return NextResponse.json({ error: "Failed to check trial" }, { status: 500 });
  }

  const created = count ?? 0;
  if (created > 0) {
    return NextResponse.json({ eligible: false, variant, reason: "already_created" });
  }

  return NextResponse.json({ eligible: true, variant, reason: "ok" });
}


import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { deleteObjectFromR2 } from "@/lib/r2";

export const runtime = "nodejs";

type Body = {
  id?: string;
};

function getAdminSecret(req: Request) {
  return req.headers.get("x-admin-secret") ?? "";
}

export async function DELETE(req: Request) {
  const adminSecret = process.env.ADMIN_AGENTS_SECRET;
  if (!adminSecret || getAdminSecret(req) !== adminSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = body.id?.trim() ?? "";
  if (!id) {
    return NextResponse.json({ error: "Missing agent id" }, { status: 400 });
  }

  const { data: target, error: fetchErr } = await supabaseAdmin
    .from("agents")
    .select("id, image_key")
    .eq("id", id)
    .single();

  if (fetchErr || !target) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  const { error: deleteErr } = await supabaseAdmin.from("agents").delete().eq("id", id);
  if (deleteErr) {
    return NextResponse.json({ error: "Failed to delete agent" }, { status: 500 });
  }

  let imageDeleted = false;
  let imageDeleteReason: string | null = null;
  const r2Bucket = process.env.R2_BUCKET;
  if (!target.image_key) {
    imageDeleteReason = "missing_image_key";
  } else if (!r2Bucket) {
    imageDeleteReason = "missing_r2_bucket";
  } else {
    try {
      await deleteObjectFromR2({ bucket: r2Bucket, key: target.image_key });
      imageDeleted = true;
    } catch {
      imageDeleted = false;
      imageDeleteReason = "delete_failed";
    }
  }

  return NextResponse.json({ ok: true, imageDeleted, imageDeleteReason });
}

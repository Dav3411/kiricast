import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const NICKNAME_MIN = 1;
const NICKNAME_MAX = 32;
const NICKNAME_REGEX = /^[a-zA-Z0-9_\u3131-\uD79D.-]+$/;

async function ensureProfileForUserId(userId: string): Promise<{ userId: string; nickname: string } | null> {
  let { data, error } = await supabaseAdmin
    .from("profiles")
    .select("user_id, nickname")
    .eq("user_id", userId)
    .single();

  if (!error && data) {
    return { userId: data.user_id, nickname: data.nickname };
  }
  if (error?.code !== "PGRST116") return null;

  let nick = "";
  try {
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
    const meta = userData?.user?.user_metadata as { nickname?: string } | undefined;
    const fromMeta = typeof meta?.nickname === "string" ? meta.nickname.trim() : "";
    if (fromMeta.length >= NICKNAME_MIN && fromMeta.length <= NICKNAME_MAX && NICKNAME_REGEX.test(fromMeta)) {
      nick = fromMeta;
    }
  } catch {
    // ignore
  }
  if (!nick) nick = `User-${userId.slice(0, 8)}`;

  let { error: upsertErr } = await supabaseAdmin
    .from("profiles")
    .upsert({ user_id: userId, nickname: nick, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (upsertErr?.code === "23505" && nick.startsWith("User-")) {
    nick = `User-${userId.slice(0, 12)}`;
    const retry = await supabaseAdmin
      .from("profiles")
      .upsert({ user_id: userId, nickname: nick, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    upsertErr = retry.error;
  }
  if (upsertErr) return null;

  const res = await supabaseAdmin.from("profiles").select("user_id, nickname").eq("user_id", userId).single();
  if (res.error || !res.data) return null;
  return { userId: res.data.user_id, nickname: res.data.nickname };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error: authErr, userId: viewerUserId } = await requireUserId(req);
  if (authErr) {
    return NextResponse.json({ error: authErr }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  let { data, error } = await supabaseAdmin
    .from("profiles")
    .select("user_id, nickname")
    .eq("user_id", id)
    .single();

  if (error || !data) {
    if (id === viewerUserId) {
      const profile = await ensureProfileForUserId(id);
      if (profile) {
        return NextResponse.json({ userId: profile.userId, nickname: profile.nickname });
      }
    }
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  return NextResponse.json({
    userId: data.user_id,
    nickname: data.nickname,
  });
}

import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const NICKNAME_MIN = 1;
const NICKNAME_MAX = 32;
const NICKNAME_REGEX = /^[a-zA-Z0-9_\u3131-\uD79D.-]+$/;
const VALID_LANGUAGES = ["en", "ko"];

export async function GET(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  let { data, error: fetchErr } = await supabaseAdmin
    .from("profiles")
    .select("user_id, nickname, updated_at, ui_language, creation_language, content_languages")
    .eq("user_id", userId)
    .single();

  if (fetchErr && fetchErr.code === "PGRST116") {
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
    if (!nick) {
      nick = `User-${userId.slice(0, 8)}`;
    }
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
    if (!upsertErr) {
      const res = await supabaseAdmin.from("profiles").select("user_id, nickname, updated_at, ui_language, creation_language, content_languages").eq("user_id", userId).single();
      data = res.data;
      fetchErr = res.error;
    }
  }

  if (fetchErr || !data) {
    return NextResponse.json({ profile: null });
  }

  return NextResponse.json({
    profile: {
      userId: data.user_id,
      nickname: data.nickname,
      updatedAt: data.updated_at,
    },
    uiLanguage: data.ui_language ?? "en",
    creationLanguage: data.creation_language ?? "en",
    contentLanguages: data.content_languages ?? ["en"],
  });
}

export async function POST(req: Request) {
  const { error, userId } = await requireUserId(req);
  if (error || !userId) {
    return NextResponse.json({ error: error ?? "Unauthorized" }, { status: 401 });
  }

  let body: {
    nickname?: string;
    uiLanguage?: string;
    creationLanguage?: string;
    contentLanguages?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // --- Language settings update (no nickname required) ---
  if (body.uiLanguage || body.creationLanguage || body.contentLanguages) {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (body.uiLanguage && VALID_LANGUAGES.includes(body.uiLanguage)) {
      updates.ui_language = body.uiLanguage;
    }
    if (body.creationLanguage && VALID_LANGUAGES.includes(body.creationLanguage)) {
      updates.creation_language = body.creationLanguage;
    }
    if (Array.isArray(body.contentLanguages)) {
      const filtered = body.contentLanguages.filter((l) => VALID_LANGUAGES.includes(l));
      // Enforce: creation language always included
      const creation = (updates.creation_language as string) ?? body.creationLanguage ?? "en";
      if (!filtered.includes(creation)) filtered.unshift(creation);
      if (filtered.length > 0) updates.content_languages = filtered;
    }

    // If only language fields (no nickname), do a direct update
    if (!body.nickname) {
      const { error: updateErr } = await supabaseAdmin
        .from("profiles")
        .update(updates)
        .eq("user_id", userId);
      if (updateErr) {
        return NextResponse.json({ error: "Failed to save language settings" }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }
  }

  // --- Nickname update ---
  const raw = typeof body.nickname === "string" ? body.nickname.trim() : "";
  if (raw.length < NICKNAME_MIN || raw.length > NICKNAME_MAX) {
    return NextResponse.json(
      { error: `Nickname must be ${NICKNAME_MIN}-${NICKNAME_MAX} characters` },
      { status: 400 }
    );
  }
  if (!NICKNAME_REGEX.test(raw)) {
    return NextResponse.json(
      { error: "Nickname can only contain letters, numbers, underscores, and dots" },
      { status: 400 }
    );
  }

  const { error: upsertErr } = await supabaseAdmin
    .from("profiles")
    .upsert(
      { user_id: userId, nickname: raw, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );

  if (upsertErr) {
    if (upsertErr.code === "23505") {
      return NextResponse.json({ error: "That nickname is already taken" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to save profile" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, nickname: raw });
}

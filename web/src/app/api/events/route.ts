import { NextResponse } from "next/server";
import { getUserIdFromToken, requireUserId } from "@/lib/authServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { EventName } from "@/lib/analytics";
import { isNonEmpty } from "@/lib/serverUtils";

export const runtime = "nodejs";

type ReqBody = {
  name?: string;
  anonId?: string;
  url?: string;
  properties?: Record<string, unknown>;
  accessToken?: string | null;
};

async function resolveUserId(req: Request, bodyToken?: string | null) {
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    return requireUserId(req);
  }
  if (!bodyToken) return { error: null, userId: null };
  return getUserIdFromToken(bodyToken);
}

export async function POST(req: Request) {
  let body: ReqBody;
  try {
    body = (await req.json()) as ReqBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const anonId = String(body.anonId ?? "").trim();
  const url = typeof body.url === "string" ? body.url : null;
  const properties =
    body.properties && typeof body.properties === "object" ? body.properties : null;

  const allowed = new Set<EventName>([
    "sign_up",
    "sign_in",
    "create_open",
    "agent_create_start",
    "agent_create_success",
    "agent_create_fail",
    "clip_create_start",
    "clip_create_success",
    "clip_create_fail",
    "share_open",
    "share_complete",
    "remix_start",
    "page_view",
    "clip_view",
    "clip_play_start",
    "clip_play_complete",
    "paywall_shown",
    "checkout_start",
    "export_shorts_start",
    "export_shorts_queued",
    "export_shorts_complete",
    "export_shorts_error",
    "clip_delete",
    "script_generate_start",
    "script_refresh",
  ]);

  if (!isNonEmpty(name) || !isNonEmpty(anonId) || !allowed.has(name as EventName)) {
    return NextResponse.json({ ok: false, error: "Missing required fields" }, { status: 400 });
  }

  const { userId } = await resolveUserId(req, body.accessToken ?? null);

  // best-effort insert: if table isn't created yet, don't break the app
  try {
    const { error } = await supabaseAdmin.from("analytics_events").insert({
      user_id: userId,
      anon_id: anonId,
      event_name: name,
      url,
      properties,
      user_agent: req.headers.get("user-agent") ?? null,
    });
    void error;
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true });
}


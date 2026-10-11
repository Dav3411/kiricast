import { supabase } from "@/lib/supabaseClient";

export type EventName =
  | "sign_up"
  | "sign_in"
  | "create_open"
  | "agent_create_start"
  | "agent_create_success"
  | "agent_create_fail"
  | "clip_create_start"
  | "clip_create_success"
  | "clip_create_fail"
  | "share_open"
  | "share_complete"
  | "remix_start"
  | "page_view"
  | "clip_view"
  | "clip_play_start"
  | "clip_play_complete"
  | "paywall_shown"
  | "checkout_start"
  | "export_shorts_start"
  | "export_shorts_queued"
  | "export_shorts_complete"
  | "export_shorts_error"
  | "clip_delete"
  | "script_generate_start"
  | "script_refresh"
  | "continue_story_start"
  | "continue_story_option_selected"
  | "continue_story_soft_reset";

type TrackBody = {
  name: EventName;
  anonId: string;
  url?: string;
  properties?: Record<string, unknown>;
  accessToken?: string | null;
};

function getOrCreateAnonId() {
  if (typeof window === "undefined") return "server";
  try {
    const key = "kiricast_anon_id";
    const existing = window.localStorage.getItem(key);
    if (existing && existing.trim()) return existing;
    const next = crypto.randomUUID();
    window.localStorage.setItem(key, next);
    return next;
  } catch {
    return "anon";
  }
}

async function getAccessToken() {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function trackEvent(
  name: EventName,
  properties?: Record<string, unknown>
) {
  try {
    const anonId = getOrCreateAnonId();
    const accessToken = await getAccessToken();
    const body: TrackBody = {
      name,
      anonId,
      url: typeof window !== "undefined" ? window.location.href : undefined,
      properties,
      accessToken,
    };

    const json = JSON.stringify(body);
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([json], { type: "application/json" });
      navigator.sendBeacon("/api/events", blob);
      return;
    }

    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
      keepalive: true,
    });
  } catch {
    // best-effort only
  }
}


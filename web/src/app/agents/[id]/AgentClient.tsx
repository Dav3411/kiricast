"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { trackEvent } from "@/lib/analytics";
import { supabase } from "@/lib/supabaseClient";
import { SiteHeader } from "@/components/SiteHeader";
import { useDominantColor } from "@/hooks/useDominantColor";
import { applyColorTransform } from "@/lib/colorUtils";
import { formatDuration, getAgentAvatarUrl } from "@/lib/clipUtils";
import type { ClipPayload } from "@/types/clip";
import type { Agent } from "@/types/agent";

type Clip = ClipPayload;

/* ── Color helpers for clip tiles ── */

const VIVID_OPTS = { saturationBoost: 15.0, lighten: 0.65 };
const FALLBACK_COLORS = [
  "164, 244, 207", "255, 179, 179", "179, 212, 255", "255, 218, 163", "200, 179, 255",
  "164, 244, 232", "255, 179, 218", "179, 240, 179", "255, 230, 163", "179, 232, 255",
];

function fallbackColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[((hash % FALLBACK_COLORS.length) + FALLBACK_COLORS.length) % FALLBACK_COLORS.length];
}

function ensureContrast(a: string, b: string): [string, string] {
  const parse = (s: string) => s.split(",").map((v) => parseInt(v.trim(), 10)) as [number, number, number];
  const lum = (r: number, g: number, b: number) => r * 0.299 + g * 0.587 + b * 0.114;
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const dist = Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
  if (dist > 90) return [a, b];
  const lift = 0.6;
  if (lum(r1, g1, b1) >= lum(r2, g2, b2)) {
    return [`${Math.round(r1 + (255 - r1) * lift)}, ${Math.round(g1 + (255 - g1) * lift)}, ${Math.round(b1 + (255 - b1) * lift)}`, b];
  }
  return [a, `${Math.round(r2 + (255 - r2) * lift)}, ${Math.round(g2 + (255 - g2) * lift)}, ${Math.round(b2 + (255 - b2) * lift)}`];
}

/* ── Single clip tile (needs its own component for hooks) ── */

function ClipTile({ clip, agentColors }: { clip: Clip; agentColors?: Record<string, string> }) {
  const tc = useTranslations("common");
  const stored1 = (clip.agent1Id && agentColors?.[clip.agent1Id]) ? applyColorTransform(agentColors[clip.agent1Id], VIVID_OPTS) : null;
  const stored2 = (clip.agent2Id && agentColors?.[clip.agent2Id]) ? applyColorTransform(agentColors[clip.agent2Id], VIVID_OPTS) : null;
  const img1 = stored1 ? undefined : (clip.agent1Id ? getAgentAvatarUrl(clip.agent1Id) : undefined);
  const img2 = stored2 ? undefined : (clip.agent2Id ? getAgentAvatarUrl(clip.agent2Id) : undefined);
  const extracted1 = useDominantColor(img1, VIVID_OPTS);
  const extracted2 = useDominantColor(img2, VIVID_OPTS);
  const color1 = stored1 ?? extracted1;
  const color2 = stored2 ?? extracted2;
  const ready = color1 !== null || color2 !== null;
  const [c1, c2] = ensureContrast(
    color1 ?? fallbackColor(clip.id),
    color2 ?? fallbackColor(clip.id + "x"),
  );

  return (
    <Link
      href={`/clips/${encodeURIComponent(clip.id)}`}
      className="relative aspect-square overflow-hidden group"
    >
      {/* Fallback base */}
      <div className="absolute inset-0 bg-zinc-800" />
      {clip.backgroundImageUrl ? (
        /* 배경 이미지가 있으면 이미지 사용 */
        <img
          src={clip.backgroundImageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        /* 없으면 에이전트 컬러 그라데이션 */
        <div
          className="absolute inset-0 transition-opacity duration-500"
          style={{
            background: `linear-gradient(135deg, rgb(${c1}), rgb(${c2}))`,
            opacity: ready ? 1 : 0,
          }}
        />
      )}
      {/* Agent avatars */}
      {(clip.agent1Id || clip.agent2Id) ? (
        <div className="absolute top-2 left-2 flex items-center -space-x-2 z-10">
          {clip.agent1Id ? (
            <img
              src={getAgentAvatarUrl(clip.agent1Id)}
              alt=""
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover ring-2 ring-black/30"
            />
          ) : null}
          {clip.agent2Id ? (
            <img
              src={getAgentAvatarUrl(clip.agent2Id)}
              alt=""
              className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover ring-2 ring-black/30"
            />
          ) : null}
        </div>
      ) : null}
      {/* Content overlay */}
      <div className={`absolute inset-0 flex flex-col justify-end p-2.5 sm:p-3 ${clip.backgroundImageUrl ? "bg-gradient-to-t from-black/60 to-transparent" : ""}`}>
        <div className={`text-xs sm:text-sm font-semibold line-clamp-2 leading-tight ${clip.backgroundImageUrl ? "text-white drop-shadow-md" : "text-black"}`}>
          {clip.title ?? tc("untitled")}
        </div>
        {clip.durationSec != null ? (
          <div className={`mt-1 text-[10px] sm:text-xs ${clip.backgroundImageUrl ? "text-white/70" : "text-black/60"}`}>
            {formatDuration(clip.durationSec)}
          </div>
        ) : null}
      </div>
      {/* Hover overlay with like count */}
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
        {(clip.likeCount ?? 0) > 0 ? (
          <span className="flex items-center gap-1 text-sm font-semibold text-white">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" /></svg>
            {clip.likeCount}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

const REPORT_REASONS = [
  { value: "defamation", labelKey: "reportDefamation" },
  { value: "copyright", labelKey: "reportCopyright" },
  { value: "privacy", labelKey: "reportPrivacy" },
  { value: "inappropriate", labelKey: "reportInappropriate" },
  { value: "other", labelKey: "reportOther" },
] as const;

function formatTime(sec: number): string {
  if (!sec || !isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AgentClient({ id }: { id: string }) {
  const t = useTranslations("agentDetail");
  const tc = useTranslations("common");
  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [isPublic, setIsPublic] = useState(true);
  const [updatingPublic, setUpdatingPublic] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [subscribing, setSubscribing] = useState(false);
  const [clips, setClips] = useState<Clip[]>([]);
  const [clipsLoading, setClipsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"clips" | "community">("clips");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const introAudioRef = useRef<HTMLAudioElement>(null);
  const [introPlaying, setIntroPlaying] = useState(false);
  const [introProgress, setIntroProgress] = useState(0);
  const [introDuration, setIntroDuration] = useState(0);

  useEffect(() => {
    void trackEvent("page_view", { page: "agent", agentId: id });
  }, [id]);

  useEffect(() => {
    if (!deleteConfirm) { setDeleteInput(""); return; }
    const timer = window.setTimeout(() => setDeleteConfirm(false), 15000);
    return () => clearTimeout(timer);
  }, [deleteConfirm]);

  useEffect(() => {
    if (!moreMenuOpen) return;
    const close = () => setMoreMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [moreMenuOpen]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        const uid = sessionData.session?.user?.id;
        const headers: HeadersInit = {};
        if (token) headers.Authorization = `Bearer ${token}`;

        const res = await fetch(`/api/agents/${encodeURIComponent(id)}`, { method: "GET", headers });
        const payload = (await res.json()) as { agent?: Agent; error?: string };
        if (!res.ok || !payload.agent) {
          throw new Error(payload.error || "Agent not found");
        }
        if (!cancelled) {
          setAgent(payload.agent);
          setIsPublic(payload.agent.is_public !== false);
          setSubscribed(!!payload.agent.is_subscribed);
          setSubscriberCount(payload.agent.subscriber_count ?? 0);
          if (uid && payload.agent.ownerId === uid) {
            setIsOwner(true);
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load agent");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Load clips made with this agent
  useEffect(() => {
    let cancelled = false;
    async function loadClips() {
      setClipsLoading(true);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        const headers: HeadersInit = {};
        if (token) headers.Authorization = `Bearer ${token}`;

        const res = await fetch(`/api/agents/${encodeURIComponent(id)}/clips?limit=30`, { headers });
        const data = (await res.json()) as { clips?: Clip[] };
        if (!cancelled) {
          setClips(Array.isArray(data.clips) ? data.clips : []);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setClipsLoading(false);
      }
    }
    loadClips();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const toggleSubscribe = useCallback(async () => {
    if (subscribing) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      alert(t("signInRequired"));
      return;
    }
    setSubscribing(true);
    const next = !subscribed;
    // optimistic
    setSubscribed(next);
    setSubscriberCount((prev) => prev + (next ? 1 : -1));
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(id)}/subscribe`, {
        method: next ? "POST" : "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = (await res.json()) as { subscribed?: boolean; subscriberCount?: number };
      if (!res.ok) {
        // rollback
        setSubscribed(!next);
        setSubscriberCount((prev) => prev + (next ? -1 : 1));
      } else {
        setSubscribed(!!payload.subscribed);
        if (typeof payload.subscriberCount === "number") {
          setSubscriberCount(payload.subscriberCount);
        }
      }
    } catch {
      setSubscribed(!next);
      setSubscriberCount((prev) => prev + (next ? -1 : 1));
    } finally {
      setSubscribing(false);
    }
  }, [id, subscribed, subscribing, t]);

  async function copyLink() {
    try {
      const url = window.location.href;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  async function deleteAgent() {
    setDeleting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        alert(t("signInRequired"));
        return;
      }
      const res = await fetch(`/api/agents/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: t("deleteFailed") })) as { error?: string };
        alert(payload.error || t("deleteFailed"));
        return;
      }
      const userId = sessionData.session?.user?.id;
      window.location.href = userId ? `/users/${userId}` : "/agents";
    } catch {
      alert(t("deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  async function nativeShare() {
    try {
      if (!navigator.share) return;
      const url = window.location.href;
      await navigator.share({ title: agent?.name ?? "Agent", url });
    } catch {
      // ignore
    }
  }

  async function handleReportSubmit() {
    if (!reportReason || reportSubmitting) return;
    setReportSubmitting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      await fetch(`/api/agents/${encodeURIComponent(id)}/report`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ reason: reportReason }),
      });
      setReportDone(true);
    } catch {
      setReportDone(true);
    } finally {
      setReportSubmitting(false);
    }
  }

  function closeReportModal() {
    setReportOpen(false);
    setReportReason("");
    setReportDone(false);
  }

  async function togglePublic() {
    if (!agent || !isOwner) return;
    setUpdatingPublic(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;
      const res = await fetch("/api/agents", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: agent.id, isPublic: !isPublic }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        alert(payload.error ?? t("failedToUpdate"));
        return;
      }
      setIsPublic(!isPublic);
    } catch {
      alert(t("failedToUpdate"));
    } finally {
      setUpdatingPublic(false);
    }
  }

  if (loading) {
    return (
      <div className="h-dvh overflow-x-hidden overflow-y-auto text-zinc-100 lg-pl-sidebar">
        <SiteHeader />
        <div className="flex h-[60vh] items-center justify-center">
          <div className="text-sm text-zinc-500">{tc("loading")}</div>
        </div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="h-dvh overflow-x-hidden overflow-y-auto text-zinc-100 lg-pl-sidebar">
        <SiteHeader />
        <div className="flex h-[60vh] items-center justify-center">
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            {error ?? t("notFound")}
          </div>
        </div>
      </div>
    );
  }

  const conceptText = agent.concept || "";
  const personalityText = agent.personality || "";

  return (
    <div className="h-dvh overflow-x-hidden overflow-y-auto text-zinc-100 lg-pl-sidebar">
      <SiteHeader />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-16">
        {/* ── Profile header ── */}
        <div className="flex items-start gap-6 sm:gap-8">
          {/* Avatar */}
          {agent.image_url ? (
            <img
              className="h-24 w-24 sm:h-36 sm:w-36 shrink-0 rounded-full object-cover ring-2 ring-white/10"
              src={agent.image_url}
              alt={agent.name}
            />
          ) : (
            <div className="h-24 w-24 sm:h-36 sm:w-36 shrink-0 rounded-full bg-zinc-800 ring-2 ring-white/10 flex items-center justify-center text-zinc-500 text-xs">
              {t("noImage")}
            </div>
          )}

          {/* Stats + actions */}
          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-bold text-zinc-50 truncate">{agent.name}</h1>
              {agent.source === "user" && isOwner ? (
                <span className="text-[10px] text-zinc-500 px-2 py-0.5 rounded-full border border-white/10 shrink-0">
                  {isPublic ? tc("public") : tc("private")}
                </span>
              ) : null}
            </div>

            {/* Stats row */}
            <div className="mt-3 flex items-center gap-5">
              <div className="text-center">
                <div className="text-base sm:text-lg font-bold text-zinc-100">{clips.length}</div>
                <div className="text-[11px] text-zinc-500">{t("clipsStat")}</div>
              </div>
              <div className="text-center">
                <div className="text-base sm:text-lg font-bold text-zinc-100">{subscriberCount}</div>
                <div className="text-[11px] text-zinc-500">{t("subscribersStat")}</div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="px-5 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95"
                style={
                  subscribed
                    ? { background: "rgba(255,255,255,0.08)", color: "#a1a1aa", border: "1px solid rgba(255,255,255,0.12)" }
                    : { background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#002e1f" }
                }
                disabled={subscribing}
                onClick={() => void toggleSubscribe()}
              >
                {subscribed ? tc("subscribed") : tc("subscribe")}
              </button>
              {(isOwner || isPublic) ? (
                <Link
                  href="/series/create"
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-white/8 border border-white/10 text-zinc-200 hover:bg-white/12 transition active:scale-95"
                >
                  {tc("useInSeries")}
                </Link>
              ) : null}
              <button
                type="button"
                className="h-9 w-9 rounded-lg flex items-center justify-center bg-white/8 border border-white/10 text-zinc-400 hover:text-zinc-100 hover:bg-white/12 transition active:scale-95"
                onClick={() => void copyLink()}
                title={copied ? tc("copied") : tc("copyLink")}
              >
                {copied ? (
                  <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                )}
              </button>
              {"share" in navigator ? (
                <button
                  type="button"
                  className="h-9 w-9 rounded-lg flex items-center justify-center bg-white/8 border border-white/10 text-zinc-400 hover:text-zinc-100 hover:bg-white/12 transition active:scale-95"
                  onClick={() => void nativeShare()}
                  title={tc("share")}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                </button>
              ) : null}
              {/* More menu */}
              {isOwner ? (
                <div className="relative">
                  <button
                    type="button"
                    className="h-9 w-9 rounded-lg flex items-center justify-center bg-white/8 border border-white/10 text-zinc-400 hover:text-zinc-100 hover:bg-white/12 transition active:scale-95"
                    title={tc("more")}
                    onClick={(e) => { e.stopPropagation(); setMoreMenuOpen((v) => !v); setDeleteConfirm(false); setDeleteInput(""); }}
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
                  </button>
                  {moreMenuOpen ? (
                    <div
                      className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-white/15 bg-zinc-900/95 backdrop-blur-xl p-1.5 shadow-xl z-20"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {agent.source === "user" ? (
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 rounded-lg text-sm text-zinc-200 hover:bg-zinc-800/80 flex items-center justify-between"
                          disabled={updatingPublic}
                          onClick={() => void togglePublic()}
                        >
                          <span>{updatingPublic ? t("saving") : isPublic ? t("makePrivate") : t("makePublic")}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${isPublic ? "bg-emerald-500/20 text-emerald-300" : "bg-zinc-700 text-zinc-400"}`}>
                            {isPublic ? tc("public") : tc("private")}
                          </span>
                        </button>
                      ) : null}
                      {!deleteConfirm ? (
                        <button
                          type="button"
                          className="w-full text-left px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-500/10"
                          onClick={() => setDeleteConfirm(true)}
                        >
                          {t("deleteAgent")}
                        </button>
                      ) : (
                        <div className="px-3 py-2">
                          <div className="text-[11px] text-red-400 mb-1.5">
                            {t("typeToConfirm", { name: agent.name })}
                          </div>
                          <input
                            type="text"
                            className="w-full px-2.5 py-1.5 rounded-lg text-xs bg-zinc-800 border border-white/10 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-red-500/50"
                            placeholder={agent.name}
                            value={deleteInput}
                            onChange={(e) => setDeleteInput(e.target.value)}
                            autoFocus
                          />
                          <div className="flex gap-1.5 mt-2">
                            <button
                              type="button"
                              className="flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold bg-red-500/80 text-white hover:bg-red-500 disabled:opacity-50 transition"
                              disabled={deleting || deleteInput !== agent.name}
                              onClick={() => void deleteAgent()}
                            >
                              {deleting ? t("deleting") : tc("delete")}
                            </button>
                            <button
                              type="button"
                              className="flex-1 px-2 py-1.5 rounded-lg text-xs border border-white/10 text-zinc-400 hover:bg-white/5 transition"
                              onClick={() => setDeleteConfirm(false)}
                            >
                              {tc("cancel")}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* ── Intro audio ── */}
        {agent.intro_line ? (
          <div className="mt-5 rounded-xl overflow-hidden" style={{ background: "linear-gradient(135deg, rgba(164,244,207,0.08), rgba(124,237,163,0.04))", border: "1px solid rgba(164,244,207,0.15)" }}>
            <div className="px-4 py-3">
              <p className="text-sm leading-relaxed" style={{ color: "#b8f0d4" }}>
                &ldquo;{agent.intro_line}&rdquo;
              </p>
            </div>
            {agent.intro_mp3_url ? (
              <>
                <audio
                  ref={introAudioRef}
                  src={agent.intro_mp3_url}
                  preload="metadata"
                  onLoadedMetadata={() => {
                    if (introAudioRef.current) setIntroDuration(introAudioRef.current.duration);
                  }}
                  onTimeUpdate={() => {
                    if (introAudioRef.current && introDuration > 0) {
                      setIntroProgress(introAudioRef.current.currentTime / introDuration);
                    }
                  }}
                  onEnded={() => { setIntroPlaying(false); setIntroProgress(0); }}
                  className="hidden"
                />
                <div className="flex items-center gap-3 px-4 py-2.5" style={{ borderTop: "1px solid rgba(164,244,207,0.1)" }}>
                  <button
                    type="button"
                    className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center transition-all active:scale-90"
                    style={{ background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)" }}
                    onClick={() => {
                      const audio = introAudioRef.current;
                      if (!audio) return;
                      if (introPlaying) { audio.pause(); setIntroPlaying(false); }
                      else { void audio.play(); setIntroPlaying(true); }
                    }}
                  >
                    {introPlaying ? (
                      <svg className="w-3.5 h-3.5 text-emerald-900" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 text-emerald-900 ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    )}
                  </button>
                  <div
                    className="flex-1 h-1 rounded-full cursor-pointer relative"
                    style={{ background: "rgba(164,244,207,0.15)" }}
                    onClick={(e) => {
                      const audio = introAudioRef.current;
                      if (!audio || !introDuration) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                      audio.currentTime = pct * introDuration;
                      setIntroProgress(pct);
                    }}
                  >
                    <div
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${introProgress * 100}%`, background: "linear-gradient(90deg, #A4F4CF, #7CEDA3)" }}
                    />
                  </div>
                  <span className="text-[10px] tabular-nums shrink-0" style={{ color: "rgba(164,244,207,0.5)" }}>
                    {formatTime(introAudioRef.current?.currentTime ?? 0)}/{formatTime(introDuration)}
                  </span>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {/* ── Bio section ── */}
        {(conceptText || personalityText || agent.speaking_style) ? (
          <div className="mt-5">
            {conceptText ? (
              <div className="mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{t("setting")}</span>
                <p className={`text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed mt-0.5${descExpanded ? "" : " line-clamp-3"}`}>
                  {conceptText}
                </p>
              </div>
            ) : null}
            {personalityText ? (
              <div className="mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{t("personality")}</span>
                <p className={`text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed mt-0.5${descExpanded ? "" : " line-clamp-3"}`}>
                  {personalityText}
                </p>
              </div>
            ) : null}
            {agent.speaking_style ? (
              <p className={`mt-1.5 text-xs text-zinc-500 italic leading-relaxed${descExpanded ? "" : " line-clamp-2"}`}>
                {agent.speaking_style}
              </p>
            ) : null}
            <button
              type="button"
              className="mt-1 text-xs font-medium text-zinc-500 hover:text-zinc-300 transition"
              onClick={() => setDescExpanded((v) => !v)}
            >
              {descExpanded ? t("less") : t("more")}
            </button>
          </div>
        ) : null}

        {/* ── Disclaimer + Report ── */}
        <div className="mt-4 flex items-center justify-between text-[11px] text-zinc-600">
          <span>{t("disclaimer")}</span>
          {!isOwner ? (
            <button type="button" className="hover:text-zinc-400 transition" onClick={() => setReportOpen(true)}>
              {tc("report")}
            </button>
          ) : null}
        </div>

        {/* ── Tab bar ── */}
        <div className="mt-6 border-b border-white/10">
          <nav className="flex">
            {(["clips", "community"] as const).map((tab) => {
              const icons = {
                clips: (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zm10 0a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                ),
                community: (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                ),
              };
              const isTabActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  className={`relative flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold uppercase tracking-wider transition-colors ${isTabActive ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {icons[tab]}
                  {tab === "clips" ? t("clipsTab") : t("communityTab")}
                  {isTabActive ? (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-100 rounded-full" />
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>

        {/* ── Tab content ── */}
        <div className="mt-1">
          {activeTab === "clips" ? (
            clipsLoading ? (
              <div className="py-12 text-center text-sm text-zinc-500">{t("loadingClips")}</div>
            ) : clips.length === 0 ? (
              <div className="py-12 text-center text-sm text-zinc-500">{t("noClipsYet")}</div>
            ) : (
              <div className="grid grid-cols-3 gap-0.5">
                {clips.map((clip) => (
                  <ClipTile key={clip.id} clip={clip} agentColors={agent?.dominant_color ? { [agent.id]: agent.dominant_color } : undefined} />
                ))}
              </div>
            )
          ) : (
            <div className="py-12 text-center text-sm text-zinc-500">{t("comingSoon")}</div>
          )}
        </div>
      </main>

      {/* Report Modal */}
      {reportOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={closeReportModal}
        >
          <div
            className="w-80 rounded-2xl border border-white/15 bg-zinc-900 p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {reportDone ? (
              <div className="text-center py-4">
                <div className="text-2xl mb-2">✅</div>
                <div className="text-sm text-zinc-200 font-medium">{t("reportSuccess")}</div>
                <div className="text-xs text-zinc-400 mt-1">{t("reportSuccessDesc")}</div>
                <button
                  type="button"
                  className="mt-4 w-full rounded-xl bg-white/10 py-2 text-sm text-zinc-200 hover:bg-white/20 transition"
                  onClick={closeReportModal}
                >
                  {tc("close")}
                </button>
              </div>
            ) : (
              <>
                <div className="text-sm font-semibold text-zinc-100 mb-3">{t("reportTitle")}</div>
                <div className="flex flex-col gap-1.5">
                  {REPORT_REASONS.map(({ value, labelKey }) => (
                    <button
                      key={value}
                      type="button"
                      className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition ${
                        reportReason === value
                          ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-200"
                          : "bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10"
                      }`}
                      onClick={() => setReportReason(value)}
                    >
                      {t(labelKey)}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    type="button"
                    className="flex-1 rounded-xl border border-white/15 py-2 text-sm text-zinc-400 hover:bg-white/5 transition"
                    onClick={closeReportModal}
                  >
                    {tc("cancel")}
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded-xl bg-red-500/80 py-2 text-sm text-white hover:bg-red-500 transition disabled:opacity-50"
                    disabled={!reportReason || reportSubmitting}
                    onClick={() => void handleReportSubmit()}
                  >
                    {reportSubmitting ? tc("submitting") : tc("submit")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

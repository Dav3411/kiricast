"use client";

/* eslint-disable @next/next/no-img-element */

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/components/AuthProvider";
import { SiteHeader } from "@/components/SiteHeader";
import { PageContainer } from "@/components/PageContainer";
import { trackEvent } from "@/lib/analytics";
import { features } from "@/lib/featuresClient";
import type { ClipPayload, TimingLine } from "@/types/clip";
import type { Agent } from "@/types/agent";
import { useDominantColor } from "@/hooks/useDominantColor";
import { applyColorTransform } from "@/lib/colorUtils";
import { TrendingAgentCard } from "@/components/cards/TrendingAgentCard";
import { SubscribedAgentCard } from "@/components/cards/SubscribedAgentCard";
import { useLocaleSettings } from "@/components/LocaleProvider";
import { useTranslations } from "next-intl";

const LandingPage = dynamic(() => import("./LandingPage"), { ssr: false });

type ClipCard = ClipPayload;

const VIVID_COLOR_OPTS = { saturationBoost: 15.0, lighten: 0.65 };
function useDominantColorVivid(imageUrl?: string) {
  return useDominantColor(imageUrl, VIVID_COLOR_OPTS);
}

// Fallback palette (RGB strings) when dominant color extraction fails
const FALLBACK_COLORS = [
  "164, 244, 207", "255, 179, 179", "179, 212, 255", "255, 218, 163", "200, 179, 255",
  "164, 244, 232", "255, 179, 218", "179, 240, 179", "255, 230, 163", "179, 232, 255",
];
function fallbackColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[((hash % FALLBACK_COLORS.length) + FALLBACK_COLORS.length) % FALLBACK_COLORS.length];
}

export default function Page() {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <LandingPage />;
  return <Home />;
}

type TrendingSeriesItem = {
  id: string;
  title: string;
  agent1Id: string;
  agent2Id: string;
  agent1ImageUrl: string | null;
  agent2ImageUrl: string | null;
  setting: string | null;
  episodeCount: number;
  totalViews: number;
  createdAt: string;
  ep1BackgroundUrl: string | null;
};

export function Home() {
  const { user, session, loading, signOut } = useAuth();
  const { contentLanguages } = useLocaleSettings();
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const langParam = contentLanguages.length > 0 ? `&languages=${contentLanguages.join(",")}` : "";
  const [clips, setClips] = useState<ClipCard[]>([]);
  const [trendingClips, setTrendingClips] = useState<ClipCard[]>([]);
  const [clipsLoading, setClipsLoading] = useState(true);
  const [clipsError, setClipsError] = useState<string | null>(null);
  const [clipTimings, setClipTimings] = useState<Record<string, TimingLine[]>>({});
  const [clipAgentIds, setClipAgentIds] = useState<Record<string, string[]>>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"new" | "trending">("new");
  const [clipPage, setClipPage] = useState(1);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null);
  const [menuOpenClipId, setMenuOpenClipId] = useState<string | null>(null);
  const [likingClipId, setLikingClipId] = useState<string | null>(null);
  const [likePopClipId, setLikePopClipId] = useState<string | null>(null);
  const [agentPopup, setAgentPopup] = useState<{ agent: Agent; rect: DOMRect } | null>(null);
  const [subscribedMap, setSubscribedMap] = useState<Record<string, boolean>>({});
  const [subscriberCountMap, setSubscriberCountMap] = useState<Record<string, number>>({});
  const trendingAgentsScrollRef = useRef<HTMLDivElement>(null);
  const [trendingSeries, setTrendingSeries] = useState<TrendingSeriesItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchClips, setSearchClips] = useState<ClipCard[]>([]);
  const [searchAgents, setSearchAgents] = useState<Agent[]>([]);
  const [searchSeries, setSearchSeries] = useState<TrendingSeriesItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  function scrollHorizontal(ref: React.RefObject<HTMLDivElement | null>, dir: "left" | "right") {
    const el = ref.current;
    if (!el) return;
    const cardWidth = el.firstElementChild
      ? (el.firstElementChild as HTMLElement).offsetWidth + 16
      : 224;
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    const atStart = el.scrollLeft <= 4;
    if (dir === "right" && atEnd) {
      el.scrollTo({ left: 0, behavior: "smooth" });
    } else if (dir === "left" && atStart) {
      el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
    } else {
      el.scrollBy({ left: dir === "right" ? cardWidth * 3 : -cardWidth * 3, behavior: "smooth" });
    }
  }

  useEffect(() => {
    if (!menuOpenClipId) return;
    const close = () => setMenuOpenClipId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpenClipId]);

  async function deleteClip(clipId: string) {
    if (!session?.access_token) return;
    if (!window.confirm(t("deleteConfirm"))) return;
    setDeletingClipId(clipId);
    try {
      const res = await fetch(`/api/clips/${encodeURIComponent(clipId)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: t("deleteFailed") })) as { error?: string };
        alert(payload.error || t("deleteFailed"));
        return;
      }
      setClips((prev) => prev.filter((c) => c.id !== clipId));
      setTrendingClips((prev) => prev.filter((c) => c.id !== clipId));
      void trackEvent("clip_delete", { clipId });
    } catch {
      alert(t("deleteFailed"));
    } finally {
      setDeletingClipId(null);
    }
  }

  async function toggleLikeClip(clipId: string) {
    if (!session?.access_token) return;
    if (likingClipId === clipId) return;
    setLikingClipId(clipId);
    try {
      const current = clips.find((c) => c.id === clipId) ?? trendingClips.find((c) => c.id === clipId) ?? searchClips.find((c) => c.id === clipId);
      const nextLike = !(current?.liked ?? false);
      const res = await fetch(`/api/clips/${encodeURIComponent(clipId)}/like`, {
        method: nextLike ? "POST" : "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = (await res.json()) as { liked?: boolean; likeCount?: number; error?: string };
      if (!res.ok) {
        alert(data.error ?? t("likeUpdateError"));
        return;
      }
      const nextLikeCount = data.likeCount ?? 0;
      setClips((prev) =>
        prev.map((c) =>
          c.id === clipId ? { ...c, liked: !!data.liked, likeCount: nextLikeCount } : c
        )
      );
      setTrendingClips((prev) =>
        prev.map((c) =>
          c.id === clipId ? { ...c, liked: !!data.liked, likeCount: nextLikeCount } : c
        )
      );
      setSearchClips((prev) =>
        prev.map((c) =>
          c.id === clipId ? { ...c, liked: !!data.liked, likeCount: nextLikeCount } : c
        )
      );
    } catch {
      alert(t("likeUpdateError"));
    } finally {
      setLikingClipId(null);
    }
  }

  async function copyShareLink(clipId: string) {
    try {
      const url = `${window.location.origin}/clips/${clipId}`;
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1200);
      void trackEvent("share_complete", { clipId, method: "copy" });
    } catch {
      // ignore copy failures
    }
  }

  async function copyInviteLink() {
    if (!user) return;
    if (!features.referrals) return;
    try {
      const url = `${window.location.origin}/login?mode=signup&ref=${encodeURIComponent(
        user.id
      )}`;
      await navigator.clipboard.writeText(url);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1200);
    } catch {
      // ignore copy failures
    }
  }

  // MVP analytics: keep only agreed schema events.
  useEffect(() => {
    void trackEvent("page_view", { page: "home" });
  }, []);

  useEffect(() => {
    if (!user || !session?.access_token) {
      setCreditBalance(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/credits/balance", {
          method: "GET",
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const data = (await res.json()) as { balance?: number; error?: string };
        if (!cancelled && res.ok && typeof data.balance === "number") {
          setCreditBalance(data.balance);
        }
      } catch {
        if (!cancelled) setCreditBalance(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, session?.access_token]);

  useEffect(() => {
    let cancelled = false;
    async function loadClips() {
      setClipsLoading(true);
      setClipsError(null);
      const headers: HeadersInit = {};
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      try {
        const [resNew, resTrending, resTrendingSeries] = await Promise.all([
          fetch(`/api/clips?sort=new&limit=200${langParam}`, { headers }),
          fetch(`/api/clips?sort=trending&limit=200${langParam}`, { headers }),
          fetch(`/api/series/trending?limit=10${langParam}`),
        ]);
        const payloadNew = (await resNew.json()) as { clips?: ClipCard[]; error?: string };
        const payloadTrending = (await resTrending.json()) as { clips?: ClipCard[]; error?: string };
        const payloadSeries = (await resTrendingSeries.json()) as { series?: TrendingSeriesItem[] };
        if (!resNew.ok) throw new Error(payloadNew.error || t("clipsLoadError"));
        if (!cancelled) {
          setClips(Array.isArray(payloadNew.clips) ? payloadNew.clips : []);
          setTrendingClips(Array.isArray(payloadTrending.clips) ? payloadTrending.clips : []);
          setTrendingSeries(Array.isArray(payloadSeries.series) ? payloadSeries.series : []);
        }
      } catch (e) {
        if (!cancelled) setClipsError(e instanceof Error ? e.message : t("clipsLoadError"));
      } finally {
        if (!cancelled) setClipsLoading(false);
      }
    }
    loadClips();
    return () => { cancelled = true; };
  }, [session?.access_token, langParam]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchClips([]);
      setSearchAgents([]);
      setSearchSeries([]);
      return;
    }
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      const headers: HeadersInit = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      try {
        const [resClips, resAgents, resSeries] = await Promise.all([
          fetch(`/api/clips?q=${encodeURIComponent(q)}&sort=new&limit=60${langParam}`, { headers }),
          fetch(`/api/agents?q=${encodeURIComponent(q)}`, { headers }),
          fetch(`/api/series/trending?q=${encodeURIComponent(q)}&limit=20${langParam}`),
        ]);
        const payloadClips = (await resClips.json()) as { clips?: ClipCard[] };
        const payloadAgents = (await resAgents.json()) as { agents?: Agent[] };
        const payloadSeries = (await resSeries.json()) as { series?: TrendingSeriesItem[] };
        const foundClips = Array.isArray(payloadClips.clips) ? payloadClips.clips : [];
        setSearchClips(foundClips);
        setSearchAgents(Array.isArray(payloadAgents.agents) ? payloadAgents.agents : []);
        setSearchSeries(Array.isArray(payloadSeries.series) ? payloadSeries.series : []);

        // timing 데이터 로드 (스피커 정보 추출)
        const timingEntries = await Promise.all(
          foundClips.map(async (clip) => {
            if (!clip.timingUrl) return { id: clip.id, lines: [] as TimingLine[], agentIds: [] as string[] };
            try {
              const res = await fetch(clip.timingUrl);
              if (!res.ok) return { id: clip.id, lines: [] as TimingLine[], agentIds: [] as string[] };
              const payload = (await res.json()) as TimingLine[] | { lines?: TimingLine[]; agents?: { id?: string }[]; [k: string]: unknown };
              let lines: TimingLine[];
              if (Array.isArray(payload)) {
                lines = payload;
              } else if (Array.isArray((payload as { lines?: TimingLine[] }).lines)) {
                lines = (payload as { lines: TimingLine[] }).lines;
              } else {
                lines = [];
              }
              const agentIds = !Array.isArray(payload) && Array.isArray((payload as { agents?: { id?: string }[] }).agents)
                ? ((payload as { agents: { id?: string }[] }).agents.map((a) => a.id).filter((id): id is string => typeof id === "string"))
                : [];
              return { id: clip.id, lines, agentIds };
            } catch {
              return { id: clip.id, lines: [] as TimingLine[], agentIds: [] as string[] };
            }
          })
        );
        setClipTimings((prev) => {
          const next = { ...prev };
          for (const e of timingEntries) next[e.id] = e.lines;
          return next;
        });
        setClipAgentIds((prev) => {
          const next = { ...prev };
          for (const e of timingEntries) next[e.id] = e.agentIds;
          return next;
        });
      } catch {
        // silently ignore
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, session?.access_token, langParam]);

  const allClipsForTimings = useMemo(
    () => [...clips, ...trendingClips.filter((t) => !clips.some((c) => c.id === t.id))],
    [clips, trendingClips]
  );

  useEffect(() => {
    if (allClipsForTimings.length === 0) return;
    let cancelled = false;
    async function loadTimings() {
      const entries = await Promise.all(
        allClipsForTimings.map(async (clip) => {
          if (!clip.timingUrl) {
            return { id: clip.id, lines: [] as TimingLine[], agentIds: [] as string[] };
          }
          try {
            const res = await fetch(clip.timingUrl);
            if (!res.ok) {
              return { id: clip.id, lines: [] as TimingLine[], agentIds: [] as string[] };
            }
            const payload = (await res.json()) as
              | TimingLine[]
              | { lines?: TimingLine[]; agents?: { id?: string }[]; [k: string]: unknown };
            let lines: TimingLine[];
            if (Array.isArray(payload)) {
              lines = payload;
            } else if (Array.isArray((payload as { lines?: TimingLine[] }).lines)) {
              lines = (payload as { lines: TimingLine[] }).lines;
            } else if (payload && typeof payload === "object" && !Array.isArray(payload)) {
              const numericKeys = Object.keys(payload).filter((k) => /^\d+$/.test(k));
              if (numericKeys.length > 0) {
                lines = numericKeys
                  .sort((a, b) => Number(a) - Number(b))
                  .map((k) => (payload as Record<string, TimingLine>)[k])
                  .filter((x): x is TimingLine => x != null && typeof x === "object");
              } else {
                lines = [];
              }
            } else {
              lines = [];
            }
            const agentIds =
              !Array.isArray(payload) &&
              Array.isArray((payload as { agents?: { id?: string }[] }).agents)
                ? ((payload as { agents: { id?: string }[] }).agents
                    .map((a) => a.id)
                    .filter((id): id is string => typeof id === "string") as string[])
                : ([] as string[]);
            return { id: clip.id, lines, agentIds };
          } catch {
            return { id: clip.id, lines: [] as TimingLine[], agentIds: [] as string[] };
          }
        })
      );
      if (cancelled) return;
      const nextTimings: Record<string, TimingLine[]> = {};
      const nextAgentIds: Record<string, string[]> = {};
      for (const entry of entries) {
        nextTimings[entry.id] = entry.lines;
        if (entry.agentIds.length > 0) nextAgentIds[entry.id] = entry.agentIds;
      }
      setClipTimings(nextTimings);
      setClipAgentIds(nextAgentIds);
    }
    loadTimings();
    return () => {
      cancelled = true;
    };
  }, [allClipsForTimings]);

  // Initialize subscribe maps from agents data
  useEffect(() => {
    const subMap: Record<string, boolean> = {};
    const countMap: Record<string, number> = {};
    for (const a of agents) {
      subMap[a.id] = a.is_subscribed ?? false;
      countMap[a.id] = a.subscriber_count ?? 0;
    }
    setSubscribedMap(subMap);
    setSubscriberCountMap(countMap);
  }, [agents]);

  const handleToggleSubscribe = useCallback(async (agentId: string) => {
    if (!session?.access_token) return;
    const currentlySubscribed = subscribedMap[agentId] ?? false;
    setSubscribedMap((prev) => ({ ...prev, [agentId]: !currentlySubscribed }));
    setSubscriberCountMap((prev) => ({
      ...prev,
      [agentId]: Math.max(0, (prev[agentId] ?? 0) + (currentlySubscribed ? -1 : 1)),
    }));
    try {
      const res = await fetch(`/api/agents/${agentId}/subscribe`, {
        method: currentlySubscribed ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const payload = (await res.json()) as { subscribed?: boolean; subscriberCount?: number; error?: string };
      if (res.ok && payload.subscriberCount != null) {
        setSubscribedMap((prev) => ({ ...prev, [agentId]: payload.subscribed ?? !currentlySubscribed }));
        setSubscriberCountMap((prev) => ({ ...prev, [agentId]: payload.subscriberCount! }));
      } else {
        setSubscribedMap((prev) => ({ ...prev, [agentId]: currentlySubscribed }));
        setSubscriberCountMap((prev) => ({
          ...prev,
          [agentId]: Math.max(0, (prev[agentId] ?? 0) + (currentlySubscribed ? 1 : -1)),
        }));
      }
    } catch {
      setSubscribedMap((prev) => ({ ...prev, [agentId]: currentlySubscribed }));
      setSubscriberCountMap((prev) => ({
        ...prev,
        [agentId]: Math.max(0, (prev[agentId] ?? 0) + (currentlySubscribed ? 1 : -1)),
      }));
    }
  }, [session?.access_token, subscribedMap]);

  const agentsById = useMemo(() => {
    const map = new Map<string, Agent>();
    agents.forEach((agent) => map.set(agent.id, agent));
    return map;
  }, [agents]);

  // 구독한 에이전트
  const subscribedAgents = useMemo(
    () => agents.filter((a) => a.is_subscribed === true),
    [agents]
  );

  // 구독한 에이전트 ID set
  const subscribedAgentIds = useMemo(
    () => new Set(subscribedAgents.map((a) => a.id)),
    [subscribedAgents]
  );

  const clipsForTab = useMemo(
    () => (activeTab === "trending" ? trendingClips : clips),
    [activeTab, clips, trendingClips]
  );

  const CLIPS_PER_PAGE = 60;
  const totalPages = Math.max(1, Math.ceil(clipsForTab.length / CLIPS_PER_PAGE));
  const paginatedClips = useMemo(
    () =>
      clipsForTab.slice((clipPage - 1) * CLIPS_PER_PAGE, clipPage * CLIPS_PER_PAGE),
    [clipsForTab, clipPage]
  );

  useEffect(() => {
    setClipPage(1);
  }, [activeTab]);

  const getClipSpeakers = useCallback(
    (clipId: string) => {
      const lines = clipTimings[clipId] ?? [];
      const seen = new Set<string>();
      const result: string[] = [];
      for (const line of lines) {
        const speaker = line.speaker;
        if (speaker && speaker !== "sfx" && speaker !== "narration" && !seen.has(speaker)) {
          seen.add(speaker);
          result.push(speaker);
        }
      }
      if (result.length > 0) return result;
      return clipAgentIds[clipId] ?? [];
    },
    [clipTimings, clipAgentIds]
  );

  // 구독한 에이전트가 출연하는 클립 (최신순)
  const subscribedClips = useMemo(() => {
    if (subscribedAgentIds.size === 0) return [];
    return clips.filter((clip) => {
      const speakers = getClipSpeakers(clip.id);
      return speakers.some((sid) => subscribedAgentIds.has(sid));
    });
  }, [clips, subscribedAgentIds, getClipSpeakers]);

  const getAgentImageUrl = (id: string) => {
    const agent = agentsById.get(id);
    if (agent?.image_url) return agent.image_url;
    // 유저 생성 에이전트(UUID): 서명 URL 리다이렉트 API 사용 시 이미지가 확실히 로드됨
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      return `/api/agents/${encodeURIComponent(id)}/avatar`;
    }
    return `/agents/images/${id}.png`;
  };

  const renderAgentCard = (agent: Agent, keyPrefix: string) => (
    <TrendingAgentCard
      key={`${keyPrefix}-${agent.id}`}
      agent={agent}
      isSubscribed={subscribedMap[agent.id] ?? false}
      isLoggedIn={!!user}
      onToggleSubscribe={() => handleToggleSubscribe(agent.id)}
      onHover={(rect) => setAgentPopup({ agent, rect })}
      onHoverEnd={() => setAgentPopup(null)}
      className="w-32"
    />
  );

  const renderClipCard = (clip: ClipCard, keyPrefix: string) => (
    <ClipCardColor
      key={`${keyPrefix}-${clip.id}`}
      clipId={clip.id}
      speakerImgUrls={getClipSpeakers(clip.id).slice(0, 2).map((sid) => getAgentImageUrl(sid))}
      storedColors={getClipSpeakers(clip.id).slice(0, 2).map((sid) => agentsById.get(sid)?.dominant_color)}
      className="rounded-3xl clip-card transition-all flex flex-col p-4 min-h-[11rem] cursor-pointer"
      onClick={() => { window.location.href = `/clips/${encodeURIComponent(clip.id)}`; }}
    >
      <div className="text-xs font-semibold clip-card-muted truncate min-h-[1rem]">
        {clip.episodeNumber ? (
          <span className="inline-flex items-center justify-center align-middle mr-1.5 text-[8px] leading-none px-1 h-[13px] rounded-full bg-white/80 text-purple-500 font-semibold whitespace-nowrap">
            EP.{clip.episodeNumber}
          </span>
        ) : null}
        {clip.seriesTitle
          ? clip.seriesTitle
          : getClipSpeakers(clip.id).map((sid) => agentsById.get(sid)?.name ?? sid).join(" & ")}
      </div>
      <div className="mt-1.5 text-base font-bold clip-card-text line-clamp-2 min-h-[2.5rem]">
        {clip.title ?? tc("untitled")}
      </div>
      <div className="flex-1" />
      <div className="mt-auto flex items-end justify-between gap-3">
        <button
          type="button"
          className="z-10 -ml-1 -mb-1 group flex items-center gap-1.5 rounded-xl px-1 py-0.5 disabled:opacity-70"
          onClick={(e) => { e.stopPropagation(); if (user) { setLikePopClipId(clip.id); void toggleLikeClip(clip.id); } }}
          disabled={!user || likingClipId === clip.id}
          aria-label={clip.liked ? "Liked" : "Like"}
          title={user ? (clip.liked ? "Unlike" : "Like") : t("loginToLike")}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-5 w-5 ${clip.liked ? "text-red-500" : "text-white"}${likePopClipId === clip.id ? " like-pop" : ""}`}
            aria-hidden="true"
            onAnimationEnd={() => setLikePopClipId(null)}
          >
            {!clip.liked ? (
              <path
                d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                fill="currentColor"
                className="opacity-0 transition-opacity group-hover:opacity-25"
              />
            ) : null}
            <path
              d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
              fill={clip.liked ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="text-sm font-semibold clip-card-muted">{(clip.likeCount ?? 0) > 0 ? clip.likeCount : ""}</span>
        </button>
        <div className="flex items-center gap-2">
          {getClipSpeakers(clip.id).map((speakerId) => (
            <Link
              key={speakerId}
              href={`/agents/${encodeURIComponent(speakerId)}`}
              onClick={(e) => e.stopPropagation()}
            >
              <img
                className="h-14 w-14 sm:h-16 sm:w-16 rounded-xl object-cover ring-1 ring-zinc-300/80 shadow-sm hover:ring-2 hover:ring-emerald-400 transition"
                src={getAgentImageUrl(speakerId)}
                alt={agentsById.get(speakerId)?.name ?? speakerId}
              />
            </Link>
          ))}
        </div>
      </div>
    </ClipCardColor>
  );

  useEffect(() => {
    let cancelled = false;
    async function loadAgents() {
      try {
        const headers: Record<string, string> = {};
        if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
        const res = await fetch("/api/agents", { method: "GET", headers });
        const payload = (await res.json()) as { agents?: Agent[]; error?: string };
        if (!res.ok) {
          throw new Error(payload.error || "Failed to load agents");
        }
        if (!cancelled) {
          setAgents(Array.isArray(payload.agents) ? payload.agents : []);
        }
      } catch (e) {
        if (!cancelled) {
          setAgentsError(e instanceof Error ? e.message : "Failed to load agents");
        }
      } finally {
        if (!cancelled) {
          setAgentsLoading(false);
        }
      }
    }
    loadAgents();
    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  return (
    <div className="h-dvh overflow-x-hidden overflow-y-auto text-zinc-100 lg-pl-sidebar relative">

      <SiteHeader />

      <PageContainer className="space-y-14">
        {/* Search Bar */}
        <div className="relative">
          <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-zinc-400">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-xl bg-white/5 border border-white/10 pl-11 pr-10 py-3 text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-emerald-400/50 transition-colors text-sm"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute inset-y-0 right-3 flex items-center text-zinc-400 hover:text-zinc-200"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Search Results */}
        {searchQuery.trim() ? (
          <div className="space-y-10">
            {searchLoading ? (
              <div className="text-zinc-500 text-sm">{t("searching")}</div>
            ) : searchAgents.length === 0 && searchClips.length === 0 && searchSeries.length === 0 ? (
              <div className="text-zinc-500 text-sm">{t("noResultsFor", { query: searchQuery })}</div>
            ) : (
              <>
                {searchSeries.length > 0 && (
                  <section>
                    <h2 className="text-2xl font-bold text-gray-100 mb-4">{t("seriesResults")}</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {searchSeries.map((s) => (
                        <Link
                          key={s.id}
                          href={`/series/${encodeURIComponent(s.id)}`}
                          className="rounded-xl border border-white/10 bg-zinc-900/80 p-3 hover:border-purple-400/40 hover:bg-zinc-800/80 transition-all group"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0">
                              <div className="flex items-center -space-x-2 shrink-0">
                                {s.agent1ImageUrl ? (
                                  <img src={s.agent1ImageUrl} alt="" className="w-8 h-8 rounded-full object-cover border-2 border-zinc-900" />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-purple-500/20 border-2 border-zinc-900" />
                                )}
                                {s.agent2ImageUrl ? (
                                  <img src={s.agent2ImageUrl} alt="" className="w-8 h-8 rounded-full object-cover border-2 border-zinc-900" />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-emerald-500/20 border-2 border-zinc-900" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-zinc-100 line-clamp-2 group-hover:text-purple-200 transition-colors">
                                  {s.title}
                                </div>
                                {s.setting ? (
                                  <p className="mt-0.5 text-[11px] text-zinc-500 line-clamp-1">{s.setting}</p>
                                ) : null}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-zinc-500 shrink-0 pt-0.5">
                              <span className="flex items-center gap-0.5">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
                                {s.episodeCount} EP
                              </span>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </section>
                )}
                {searchAgents.length > 0 && (
                  <section>
                    <h2 className="text-2xl font-bold text-gray-100 mb-4">{t("agentsResults")}</h2>
                    <div className="flex gap-3 overflow-x-auto pb-2 scroll-smooth" style={{ scrollbarWidth: "none" }}>
                      {searchAgents.map((agent) => renderAgentCard(agent, "search-agent"))}
                    </div>
                  </section>
                )}
                {searchClips.length > 0 && (
                  <section>
                    <h2 className="text-2xl font-bold text-gray-100 mb-4">{t("clipsSection")}</h2>
                    <div className="mt-2 grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
                      {searchClips.map((clip) => renderClipCard(clip, "search-clip"))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        ) : null}

        {/* Trending Series */}
        {!searchQuery.trim() && trendingSeries.length > 0 ? (
          <section>
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-gray-100">{t("trendingSeries")}</h2>
              <p className="mt-0.5 text-sm text-zinc-500">{t("popularOngoingSeries")}</p>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2">
              {trendingSeries.slice(0, 10).map((s) => (
                <Link
                  key={s.id}
                  href={`/series/${encodeURIComponent(s.id)}`}
                  className="rounded-lg border border-white/10 overflow-hidden hover:border-purple-400/40 transition-all group flex flex-col relative"
                  style={{ background: "#18181b" }}
                >
                  {/* Background image */}
                  <div className="relative w-full aspect-[4/3]">
                    {s.ep1BackgroundUrl ? (
                      <img src={s.ep1BackgroundUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/40 to-zinc-900" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                    {/* Avatars overlaid on background */}
                    <div className="absolute bottom-1.5 left-1.5 flex items-center -space-x-1.5">
                      {s.agent1ImageUrl ? (
                        <img src={s.agent1ImageUrl} alt="" className="w-5 h-5 rounded-full object-cover border-[1.5px] border-black/60" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-purple-500/30 border-[1.5px] border-black/60" />
                      )}
                      {s.agent2ImageUrl ? (
                        <img src={s.agent2ImageUrl} alt="" className="w-5 h-5 rounded-full object-cover border-[1.5px] border-black/60" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-emerald-500/30 border-[1.5px] border-black/60" />
                      )}
                    </div>
                    {/* EP badge */}
                    <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 text-[9px] font-semibold text-white/80 bg-black/50 rounded px-1 py-0.5 backdrop-blur-sm">
                      <svg className="w-2 h-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" /></svg>
                      {s.episodeCount}
                    </div>
                  </div>
                  {/* Title */}
                  <div className="px-2 py-1.5">
                    <div className="text-[11px] font-bold text-zinc-100 line-clamp-2 leading-snug group-hover:text-purple-200 transition-colors">
                      {s.title}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* Trending Agents */}
        {!searchQuery.trim() && !agentsLoading && agents.length > 0 ? (
          <section>
            <div className="flex items-end justify-between gap-4 mb-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-100">{t("trendingAgents")}</h2>
                <p className="mt-0.5 text-sm text-zinc-500">{t("trendingAgentsSubtitle")}</p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/agents"
                  className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors shrink-0 mr-2"
                >
                  {t("viewAll")}
                </Link>
                <button
                  type="button"
                  onClick={() => scrollHorizontal(trendingAgentsScrollRef, "left")}
                  aria-label={t("scrollLeft")}
                  className="w-8 h-8 flex items-center justify-center rounded-full border border-white/20 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white transition"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => scrollHorizontal(trendingAgentsScrollRef, "right")}
                  aria-label={t("scrollRight")}
                  className="w-8 h-8 flex items-center justify-center rounded-full border border-white/20 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white transition"
                >
                  ›
                </button>
              </div>
            </div>
            <div ref={trendingAgentsScrollRef} className="flex gap-3 overflow-x-auto pb-2 scroll-smooth" style={{ scrollbarWidth: "none" }}>
              {agents.slice(0, 12).map((agent) => renderAgentCard(agent, "trending-agent"))}
            </div>
          </section>
        ) : null}

        {/* Subscribed Agents */}
        {!searchQuery.trim() && user && subscribedAgents.length > 0 ? (
          <section>
            <div className="flex items-end justify-between gap-4 mb-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-100">{t("subscribedAgents")}</h2>
                <p className="mt-0.5 text-sm text-zinc-500">{t("subscribedAgentsSubtitle")}</p>
              </div>
              <Link
                href="/agents/subscribed"
                className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors shrink-0"
              >
                {t("viewAll")}
              </Link>
            </div>
            <div className="flex gap-5 overflow-x-auto py-2" style={{ scrollbarWidth: "none" }}>
              {subscribedAgents.map((agent) => (
                <SubscribedAgentCard
                  key={`sub-agent-${agent.id}`}
                  agent={agent}
                  onHover={(rect) => setAgentPopup({ agent, rect })}
                  onHoverEnd={() => setAgentPopup(null)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* Clips from Subscribed Agents */}
        {!searchQuery.trim() && user && subscribedClips.length > 0 ? (
          <section>
            <div className="mb-4">
              <h2 className="text-2xl font-bold text-gray-100">{t("fromSubscribedAgents")}</h2>
              <p className="mt-0.5 text-sm text-zinc-500">{t("fromSubscribedSubtitle")}</p>
            </div>
            <div className="flex gap-4 overflow-x-auto pt-2 pb-4 px-1 -mx-1" style={{ scrollbarWidth: "none" }}>
              {subscribedClips.slice(0, 15).map((clip) => (
                <TrendingClipCard
                  key={`sub-clip-${clip.id}`}
                  clip={clip}
                  speakerIds={getClipSpeakers(clip.id).slice(0, 2)}
                  agentsById={agentsById}
                  getAgentImageUrl={getAgentImageUrl}
                  isLoggedIn={!!user}
                  likingClipId={likingClipId}
                  likePopClipId={likePopClipId}
                  setLikePopClipId={setLikePopClipId}
                  onToggleLike={toggleLikeClip}
                />
              ))}
            </div>
          </section>
        ) : null}

        {/* Creator Rewards Banner */}
        {!searchQuery.trim() && (
          <section>
            <Link
              href="/rewards"
              className="group relative block overflow-hidden rounded-2xl border border-emerald-500/20 p-8 sm:p-10 transition-all hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/10"
              style={{
                background: "linear-gradient(135deg, rgba(4, 120, 87, 0.3), rgba(5, 150, 105, 0.15))",
              }}
            >
              <div className="pointer-events-none absolute -right-20 -top-20 h-[250px] w-[250px] rounded-full bg-emerald-400/10 blur-[80px]" />
              <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-white">
                    {t("rewardsBannerTitle")}
                  </h2>
                  <p className="mt-3 max-w-lg text-sm leading-relaxed text-zinc-300">
                    {t("rewardsBannerDesc")}
                    <br className="hidden sm:block" />
                    {t("rewardsBannerDesc2")}
                  </p>
                  <div className="mt-5 flex flex-col gap-2 text-sm text-zinc-300 sm:flex-row sm:gap-x-6">
                    <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> {t("rewardsBullet1")}</span>
                    <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> {t("rewardsBullet2")}</span>
                    <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> {t("rewardsBullet3")}</span>
                  </div>
                </div>
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-3xl transition-transform group-hover:scale-110">
                  💰
                </div>
              </div>
              <span className="absolute right-6 top-1/2 -translate-y-1/2 text-emerald-400/50 text-xl transition-transform group-hover:translate-x-1 hidden sm:block">→</span>
            </Link>
          </section>
        )}

        {/* All Clips */}
        {!searchQuery.trim() && <section>
          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h2 className="text-2xl font-bold text-gray-100">
                {t("allClips")}
              </h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                {activeTab === "new"
                  ? t("mostRecentClips")
                  : t("mostListenedClips")}
              </p>
            </div>
            <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1 mb-0.5">
              {(["new", "trending"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
                  style={
                    activeTab === tab
                      ? { background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#003d2b" }
                      : { color: "#a1a1aa", background: "transparent" }
                  }
                >
                  {tab === "new" ? t("newClips") : t("trending")}
                </button>
              ))}
            </div>
          </div>

          <div>

            {clipsLoading ? (
              <div className="mt-5 text-sm text-zinc-500">{tc("loading")}</div>
            ) : null}
            {clipsError ? (
              <div className="mt-5 text-sm text-red-500">{clipsError}</div>
            ) : null}

            <div className="mt-5 grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
              {paginatedClips.map((clip) => renderClipCard(clip, "new"))}
              {!clipsLoading && clipsForTab.length === 0 ? (
                <div className="col-span-full rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-500">
                  {t("noClipsFound")}
                </div>
              ) : null}
            </div>

            {clipsForTab.length > CLIPS_PER_PAGE ? (
              <div className="mt-8 flex items-center justify-center gap-4">
                <button
                  type="button"
                  className="px-5 py-2.5 rounded-xl backdrop-blur-xl bg-zinc-800/70 border border-zinc-700/70 text-zinc-300 hover:bg-zinc-700/70 transition-all disabled:opacity-50"
                  disabled={clipPage <= 1}
                  onClick={() => setClipPage((p) => Math.max(1, p - 1))}
                >
                  {t("previous")}
                </button>
                <span className="text-sm text-zinc-400 font-medium">
                  {clipPage} / {totalPages}
                </span>
                <button
                  type="button"
                  className="px-5 py-2.5 rounded-xl backdrop-blur-xl bg-zinc-800/70 border border-zinc-700/70 text-zinc-300 hover:bg-zinc-700/70 transition-all disabled:opacity-50"
                  disabled={clipPage >= totalPages}
                  onClick={() => setClipPage((p) => Math.min(totalPages, p + 1))}
                >
                  {t("next")}
                </button>
              </div>
            ) : null}
          </div>
        </section>}
      </PageContainer>

      {agentPopup ? (
        <HomeAgentPopup agent={agentPopup.agent} rect={agentPopup.rect} />
      ) : null}
    </div>
  );
}

const AGENT_POPUP_WIDTH = 300;

function HomeAgentPopup({ agent, rect }: { agent: Agent; rect: DOMRect }) {
  const t = useTranslations("home");
  const rightSpace = window.innerWidth - rect.right;
  const showRight = rightSpace >= AGENT_POPUP_WIDTH + 20;
  const x = showRight ? rect.right + 12 : rect.left - AGENT_POPUP_WIDTH - 12;
  const y = Math.max(8, Math.min(rect.top, window.innerHeight - 360));
  const introText = agent.intro_line || agent.personality || "";

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: x,
        top: y,
        width: AGENT_POPUP_WIDTH,
        zIndex: 9999,
        pointerEvents: "none",
        animation: "agentPopupIn 0.15s ease",
      }}
    >
      <style>{`
        @keyframes agentPopupIn {
          from { opacity: 0; transform: translateX(${showRight ? "-6px" : "6px"}); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {/* Arrow */}
      <div
        style={{
          position: "absolute",
          top: 20,
          [showRight ? "left" : "right"]: -6,
          width: 0,
          height: 0,
          borderTop: "6px solid transparent",
          borderBottom: "6px solid transparent",
          [showRight ? "borderRight" : "borderLeft"]: "6px solid rgba(255,255,255,0.12)",
        }}
      />

      <div
        className="rounded-2xl border border-white/12 shadow-2xl overflow-hidden"
        style={{ background: "rgba(15,20,25,0.92)", backdropFilter: "blur(20px)" }}
      >
        {agent.image_url ? (
          <div className="relative h-60 w-full overflow-hidden">
            <img
              src={agent.image_url}
              alt={agent.name}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0f1419]/90 to-transparent" />
          </div>
        ) : (
          <div className="h-16 w-full bg-gradient-to-br from-emerald-900/40 to-zinc-900" />
        )}

        <div className="p-4 flex flex-col gap-2">
          <div className="text-[10px] uppercase tracking-widest text-emerald-400">
            {agent.source === "user" ? t("communityAgent") : t("presetAgent")}
          </div>
          <div className="text-base font-bold text-white leading-tight">{agent.name}</div>
          {introText ? (
            <p className="text-xs text-zinc-400 line-clamp-3 leading-relaxed">{introText}</p>
          ) : null}
        </div>
      </div>
    </div>,
    document.body
  );
}

// 두 RGB 색상이 비슷하면(색상 거리 기준) 밝은 쪽 명도를 올려 대비를 만든다
function ensureContrast(a: string, b: string): [string, string] {
  const parse = (s: string) => s.split(",").map((v) => parseInt(v.trim(), 10)) as [number, number, number];
  const lum = (r: number, g: number, b: number) => r * 0.299 + g * 0.587 + b * 0.114;
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  // 유클리드 색상 거리
  const dist = Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
  if (dist > 90) return [a, b]; // 충분히 다른 색
  // 더 밝은 쪽을 흰색 방향으로 밀기
  const lift = 0.6;
  if (lum(r1, g1, b1) >= lum(r2, g2, b2)) {
    const nr = Math.round(r1 + (255 - r1) * lift);
    const ng = Math.round(g1 + (255 - g1) * lift);
    const nb = Math.round(b1 + (255 - b1) * lift);
    return [`${nr}, ${ng}, ${nb}`, b];
  } else {
    const nr = Math.round(r2 + (255 - r2) * lift);
    const ng = Math.round(g2 + (255 - g2) * lift);
    const nb = Math.round(b2 + (255 - b2) * lift);
    return [a, `${nr}, ${ng}, ${nb}`];
  }
}

/* ── Trending clip card (extracts dominant color from speaker avatars) ── */

function TrendingClipCard({
  clip,
  speakerIds,
  agentsById,
  getAgentImageUrl,
  isLoggedIn,
  likingClipId,
  likePopClipId,
  setLikePopClipId,
  onToggleLike,
}: {
  clip: ClipCard;
  speakerIds: string[];
  agentsById: Map<string, Agent>;
  getAgentImageUrl: (id: string) => string;
  isLoggedIn: boolean;
  likingClipId: string | null;
  likePopClipId: string | null;
  setLikePopClipId: (id: string | null) => void;
  onToggleLike: (clipId: string) => Promise<void>;
}) {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const agent1 = speakerIds[0] ? agentsById.get(speakerIds[0]) : undefined;
  const agent2 = speakerIds[1] ? agentsById.get(speakerIds[1]) : undefined;
  const stored1 = agent1?.dominant_color ? applyColorTransform(agent1.dominant_color, VIVID_COLOR_OPTS) : null;
  const stored2 = agent2?.dominant_color ? applyColorTransform(agent2.dominant_color, VIVID_COLOR_OPTS) : null;
  const extracted1 = useDominantColorVivid(stored1 ? undefined : (speakerIds[0] ? getAgentImageUrl(speakerIds[0]) : undefined));
  const extracted2 = useDominantColorVivid(stored2 ? undefined : (speakerIds[1] ? getAgentImageUrl(speakerIds[1]) : undefined));
  const color1 = stored1 ?? extracted1;
  const color2 = stored2 ?? extracted2;
  const ready = color1 !== null || color2 !== null;
  const [c1, c2] = ensureContrast(color1 ?? fallbackColor(clip.id), color2 ?? fallbackColor(clip.id + "x"));

  return (
    <Link
      href={`/clips/${encodeURIComponent(clip.id)}`}
      className="flex-shrink-0 w-40 rounded-2xl clip-card transition-all group relative overflow-hidden"
      style={{ background: "rgba(255,255,255,0.93)" }}
    >
      {/* gradient bg layer — fades in over mint base when color is ready */}
      <div
        style={{
          position: "absolute", inset: 0, borderRadius: "inherit",
          background: `linear-gradient(135deg, rgba(${c1}, 0.8), rgba(${c2}, 0.8))`,
          opacity: ready ? 1 : 0,
          transition: "opacity 0.6s ease",
        }}
      />
      <div className="relative z-10 p-3 pb-10">
        <div className="mb-3">
          <div className="flex items-center gap-2">
            {speakerIds.map((speakerId) => (
              <img
                key={speakerId}
                className="h-8 w-8 rounded-lg object-cover ring-1 ring-white/20"
                src={getAgentImageUrl(speakerId)}
                alt={agentsById.get(speakerId)?.name ?? speakerId}
              />
            ))}
          </div>
          <div className="mt-1.5 text-xs font-semibold clip-card-muted truncate">
            {speakerIds.map((sid) => agentsById.get(sid)?.name ?? sid).join(" & ")}
          </div>
        </div>
        <div className="text-xs font-bold clip-card-text line-clamp-2 min-h-[2rem]">
          {clip.title ?? tc("untitled")}
        </div>
        <div className="absolute left-3 right-3 bottom-3 flex items-center justify-between">
          <button
            type="button"
            className="group flex items-center gap-1 text-xs font-semibold clip-card-muted hover:opacity-90 disabled:opacity-60"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (isLoggedIn) {
                setLikePopClipId(clip.id);
                void onToggleLike(clip.id);
              }
            }}
            disabled={!isLoggedIn || likingClipId === clip.id}
            aria-label={clip.liked ? "Liked" : "Like"}
            title={isLoggedIn ? (clip.liked ? "Unlike" : "Like") : t("loginToLike")}
          >
            <svg
              viewBox="0 0 24 24"
              className={`h-4 w-4 ${clip.liked ? "text-red-500" : "text-white"}${likePopClipId === clip.id ? " like-pop" : ""}`}
              aria-hidden="true"
              onAnimationEnd={() => setLikePopClipId(null)}
            >
              {!clip.liked ? (
                <path
                  d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                  fill="currentColor"
                  className="opacity-0 transition-opacity group-hover:opacity-25"
                />
              ) : null}
              <path
                d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                fill={clip.liked ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {(clip.likeCount ?? 0) > 0 ? <span>{clip.likeCount}</span> : null}
          </button>
          {(clip.viewCount ?? 0) > 0 ? (
            <span className="text-xs font-semibold clip-card-muted">{t("plays", { count: clip.viewCount as number })}</span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

/* ── Grid clip card wrapper (dominant-color gradient from both speakers) ── */

function ClipCardColor({
  clipId,
  speakerImgUrls,
  storedColors,
  className,
  onClick,
  children,
}: {
  clipId: string;
  speakerImgUrls: (string | undefined)[];
  storedColors?: (string | undefined)[];
  className: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const sc1 = storedColors?.[0] ? applyColorTransform(storedColors[0], VIVID_COLOR_OPTS) : null;
  const sc2 = storedColors?.[1] ? applyColorTransform(storedColors[1], VIVID_COLOR_OPTS) : null;
  const extracted1 = useDominantColorVivid(sc1 ? undefined : speakerImgUrls[0]);
  const extracted2 = useDominantColorVivid(sc2 ? undefined : speakerImgUrls[1]);
  const color1 = sc1 ?? extracted1;
  const color2 = sc2 ?? extracted2;
  const ready = color1 !== null || color2 !== null;
  const [c1, c2] = ensureContrast(color1 ?? fallbackColor(clipId), color2 ?? fallbackColor(clipId + "x"));

  return (
    <div
      className={className}
      style={{ position: "relative", overflow: "hidden", background: "rgba(255,255,255,0.93)" }}
      onClick={onClick}
    >
      <div
        style={{
          position: "absolute", inset: 0, borderRadius: "inherit",
          background: `linear-gradient(135deg, rgba(${c1}, 0.8), rgba(${c2}, 0.8))`,
          opacity: ready ? 1 : 0,
          transition: "opacity 0.6s ease",
          zIndex: 0,
        }}
      />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1 }}>
        {children}
      </div>
    </div>
  );
}

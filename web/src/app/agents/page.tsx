"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/AuthProvider";
import { SiteHeader } from "@/components/SiteHeader";
import { PageContainer } from "@/components/PageContainer";
import { trackEvent } from "@/lib/analytics";
import type { Agent } from "@/types/agent";
import { useFetchAccessToken } from "@/hooks/useFetchWithAuth";
import { useDominantColor } from "@/hooks/useDominantColor";
import { applyColorTransform } from "@/lib/colorUtils";
import { TrendingAgentCard } from "@/components/cards/TrendingAgentCard";
import { SubscribedAgentCard } from "@/components/cards/SubscribedAgentCard";
import { useLocaleSettings } from "@/components/LocaleProvider";
import { LANG_FLAGS } from "@/lib/langFlags";

type AllAgentsTab = "popular" | "latest";

export default function AgentsPage() {
  const t = useTranslations("agents");
  const tc = useTranslations("common");
  const { user } = useAuth();
  const { contentLanguages } = useLocaleSettings();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscribedMap, setSubscribedMap] = useState<Record<string, boolean>>({});
  const [subscriberCountMap, setSubscriberCountMap] = useState<Record<string, number>>({});
  const [allTab, setAllTab] = useState<AllAgentsTab>("popular");
  const [search, setSearch] = useState("");
  const [popup, setPopup] = useState<{ agent: Agent; rect: DOMRect } | null>(null);

  const handleCardHover = useCallback((agent: Agent, rect: DOMRect) => {
    setPopup({ agent, rect });
  }, []);
  const handleCardHoverEnd = useCallback(() => setPopup(null), []);

  useEffect(() => {
    void trackEvent("page_view", { page: "agents" });
  }, []);

  const fetchAccessToken = useFetchAccessToken();

  useEffect(() => {
    let cancelled = false;
    async function loadAgents() {
      try {
        const token = await fetchAccessToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch("/api/agents", { method: "GET", headers });
        const payload = (await res.json()) as { agents?: Agent[]; error?: string };
        if (!res.ok) {
          throw new Error(payload.error || "Failed to load agents");
        }
        if (!cancelled) {
          const list = Array.isArray(payload.agents) ? payload.agents : [];
          setAgents(list);
          const subMap: Record<string, boolean> = {};
          const countMap: Record<string, number> = {};
          for (const a of list) {
            subMap[a.id] = a.is_subscribed ?? false;
            countMap[a.id] = a.subscriber_count ?? 0;
          }
          setSubscribedMap(subMap);
          setSubscriberCountMap(countMap);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load agents");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    loadAgents();
    return () => {
      cancelled = true;
    };
  }, [fetchAccessToken]);

  const handleToggleSubscribe = useCallback(async (agentId: string) => {
    const token = await fetchAccessToken();
    if (!token) return;
    const currentlySubscribed = subscribedMap[agentId] ?? false;
    setSubscribedMap((prev) => ({ ...prev, [agentId]: !currentlySubscribed }));
    setSubscriberCountMap((prev) => ({
      ...prev,
      [agentId]: Math.max(0, (prev[agentId] ?? 0) + (currentlySubscribed ? -1 : 1)),
    }));
    try {
      const res = await fetch(`/api/agents/${agentId}/subscribe`, {
        method: currentlySubscribed ? "DELETE" : "POST",
        headers: { Authorization: `Bearer ${token}` },
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
  }, [fetchAccessToken, subscribedMap]);

  // 인기 에이전트: subscriber_count 상위 6개
  const popularAgents = useMemo(() => {
    return [...agents]
      .sort((a, b) => (subscriberCountMap[b.id] ?? 0) - (subscriberCountMap[a.id] ?? 0))
      .slice(0, 15);
  }, [agents, subscriberCountMap]);

  // 구독한 에이전트
  const subscribedAgents = useMemo(() => {
    return agents.filter((a) => subscribedMap[a.id] === true);
  }, [agents, subscribedMap]);

  // 전체 에이전트 (탭에 따라 정렬 + 검색 필터)
  const allAgentsSorted = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? agents.filter(
          (a) =>
            a.name.toLowerCase().includes(q) ||
            (a.personality ?? "").toLowerCase().includes(q) ||
            (a.speaking_style ?? "").toLowerCase().includes(q) ||
            (a.intro_line ?? "").toLowerCase().includes(q) ||
            (a.concept ?? "").toLowerCase().includes(q)
        )
      : agents;

    // Soft sorting: same-language agents first, then by tab criteria
    const langSet = new Set<string>(contentLanguages);
    const isPreferred = (a: Agent) => langSet.has(a.language ?? "en") ? 0 : 1;

    if (allTab === "popular") {
      return [...filtered].sort(
        (a, b) => isPreferred(a) - isPreferred(b) || (subscriberCountMap[b.id] ?? 0) - (subscriberCountMap[a.id] ?? 0)
      );
    }
    return [...filtered].sort((a, b) => {
      const langDiff = isPreferred(a) - isPreferred(b);
      if (langDiff !== 0) return langDiff;
      if (a.created_at && b.created_at) {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      return 0;
    });
  }, [agents, subscriberCountMap, allTab, search, contentLanguages]);

  function cardProps(agent: Agent) {
    return {
      agent,
      isSubscribed: subscribedMap[agent.id] ?? false,
      isLoggedIn: !!user,
      onToggleSubscribe: () => handleToggleSubscribe(agent.id),
      onHover: (rect: DOMRect) => handleCardHover(agent, rect),
      onHoverEnd: handleCardHoverEnd,
    };
  }

  return (
    <div className="h-dvh overflow-x-hidden overflow-y-auto relative text-zinc-100 lg-pl-sidebar">
      <SiteHeader />

      <PageContainer className="space-y-14">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="text-left">
            <h1
              className="inline-block text-3xl font-bold leading-[1.2] pb-1"
              style={{ background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
            >
              {t("pageTitle")}
            </h1>
            <p className="mt-1 text-zinc-400 text-sm">{t("pageSubtitle")}</p>
          </div>
          <Link
            href="/agents/create"
            className="shrink-0 mt-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95"
            style={{ background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#002e1f" }}
          >
            {t("createAgent")}
          </Link>
        </div>

        {loading ? (
          <div className="text-sm text-zinc-500">{t("loadingAgents")}</div>
        ) : null}
        {error ? <div className="text-sm text-red-500">{error}</div> : null}

        {!loading && !error ? (
          <>
            {/* Section 1: 인기 에이전트 */}
            <TrendingSection>
              {popularAgents.length > 0 ? (
                popularAgents.map((agent) => (
                  <TrendingAgentCard key={agent.id} {...cardProps(agent)} className="w-32" />
                ))
              ) : (
                <EmptyState message={t("noAgentsYet")} />
              )}
            </TrendingSection>

            {/* Section 2: 구독한 에이전트 (로그인 시에만) */}
            {user ? (
              <section>
                <SectionHeader title={t("subscribedSection")} subtitle={t("subscribedSubtitle")} />
                {subscribedAgents.length > 0 ? (
                  <div className="mt-5 flex gap-5 overflow-x-auto py-2">
                    {subscribedAgents.map((agent) => (
                      <SubscribedAgentCard
                        key={agent.id}
                        agent={agent}
                        onHover={(rect) => handleCardHover(agent, rect)}
                        onHoverEnd={handleCardHoverEnd}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState message={t("noSubscribed")} />
                )}
              </section>
            ) : null}

            {/* Section 3: 전체 에이전트 */}
            <section>
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <SectionHeader title={t("allAgents")} subtitle={t("allAgentsSubtitle")} />
                {/* 탭 */}
                <div className="flex gap-1 bg-white/5 border border-white/10 rounded-xl p-1 mb-0.5">
                  {(["popular", "latest"] as AllAgentsTab[]).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setAllTab(tab)}
                      className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
                      style={
                        allTab === tab
                          ? { background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#003d2b" }
                          : { color: "#a1a1aa", background: "transparent" }
                      }
                    >
                      {tab === "popular" ? t("popular") : t("latest")}
                    </button>
                  ))}
                </div>
              </div>

              {/* 검색창 */}
              <div className="mt-4 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none text-sm">
                  🔍
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-400/50 focus:bg-white/8 transition"
                />
                {search ? (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 text-lg leading-none transition"
                  >
                    ×
                  </button>
                ) : null}
              </div>

              {allAgentsSorted.length > 0 ? (
                <div className="mt-5 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
                  {allAgentsSorted.map((agent) => (
                    <AgentCard key={agent.id} {...cardProps(agent)} />
                  ))}
                </div>
              ) : (
                <EmptyState message={search.trim() ? t("noSearchResults", { query: search.trim() }) : t("noAgentsYet")} />
              )}
            </section>
          </>
        ) : null}
      </PageContainer>

      {popup ? (
        <AgentPopup
          agent={popup.agent}
          rect={popup.rect}
        />
      ) : null}
    </div>
  );
}



function TrendingSection({ children }: { children: React.ReactNode }) {
  const t = useTranslations("agents");
  const scrollRef = useRef<HTMLDivElement>(null);

  function scroll(dir: "left" | "right") {
    const el = scrollRef.current;
    if (!el) return;
    const cardWidth = el.firstElementChild
      ? (el.firstElementChild as HTMLElement).offsetWidth + 12
      : 260;
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

  return (
    <section>
      <div className="flex items-end justify-between gap-4">
        <SectionHeader title={t("trending")} subtitle={t("trendingSubtitle")} />
        <div className="flex gap-2 mb-0.5">
          <button
            type="button"
            onClick={() => scroll("left")}
            aria-label="Scroll left"
            className="w-8 h-8 flex items-center justify-center rounded-full border border-white/20 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white transition"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => scroll("right")}
            aria-label="Scroll right"
            className="w-8 h-8 flex items-center justify-center rounded-full border border-white/20 bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white transition"
          >
            ›
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="mt-5 flex gap-3 overflow-x-auto pb-2 scroll-smooth"
        style={{ scrollbarWidth: "none" }}
      >
        {children}
      </div>
    </section>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-100">{title}</h2>
      <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-500">
      {message}
    </div>
  );
}


function AgentCard({
  agent,
  isSubscribed,
  isLoggedIn,
  onToggleSubscribe,
}: {
  agent: Agent;
  isSubscribed: boolean;
  isLoggedIn: boolean;
  onToggleSubscribe: () => void;
}) {
  const tc = useTranslations("common");
  const router = useRouter();
  const [toggling, setToggling] = useState(false);
  const storedColor = agent.dominant_color ? applyColorTransform(agent.dominant_color) : null;
  const extractedColor = useDominantColor(storedColor ? undefined : agent.image_url);
  const dominantColor = storedColor ?? extractedColor;
  const introText = agent.intro_line || agent.personality || "No intro.";
  const profileHref = `/agents/${encodeURIComponent(agent.id)}`;
  const createHref = `/series/create`;

  async function handleSubscribeClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!isLoggedIn || toggling) return;
    setToggling(true);
    try {
      await onToggleSubscribe();
    } finally {
      setToggling(false);
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(profileHref)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(profileHref);
        }
      }}
      className="rounded-2xl border border-white/10 shadow-xl hover:shadow-2xl hover:shadow-emerald-500/15 hover:border-white/20 transition flex flex-col cursor-pointer p-3"
      style={{
        background: dominantColor
          ? `linear-gradient(160deg, rgba(${dominantColor}, 0.45), rgba(${dominantColor}, 0.15))`
          : "rgba(255,255,255,0.04)",
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="relative">
          {agent.image_url ? (
            <img
              className="h-16 w-16 rounded-2xl object-cover"
              src={agent.image_url}
              alt={agent.name}
            />
          ) : (
            <div className="h-16 w-16 rounded-2xl bg-emerald-900/40 border border-white/10" />
          )}
          {agent.language && agent.language !== "en" && LANG_FLAGS[agent.language] ? (
            <span className="absolute -bottom-1 -right-1 text-xs leading-none bg-black/60 rounded-md px-1 py-0.5 border border-white/10">
              {LANG_FLAGS[agent.language]}
            </span>
          ) : null}
        </div>
        {(agent.is_public !== false || agent.mine === true) ? (
          <Link
            href={createHref}
            className="px-2.5 py-1.5 rounded-lg border border-emerald-400/40 text-emerald-200 text-xs hover:bg-emerald-500/10 transition"
            onClick={(e) => e.stopPropagation()}
          >
            {tc("useInSeries")}
          </Link>
        ) : null}
      </div>

      {/* Text section with dark backdrop for readability */}
      <div className="mt-3 -mx-1 px-2.5 py-2 rounded-xl bg-black/35 backdrop-blur-sm flex-1 flex flex-col">
        <div className="text-xs uppercase tracking-widest text-emerald-300">Agent</div>
        <div className="mt-1 text-base font-medium text-white line-clamp-1">{agent.name}</div>
        <div className="mt-1.5 text-xs text-zinc-300 flex-1 line-clamp-3">{introText}</div>

        {/* Subscribe button */}
        {agent.source === "user" && agent.is_public !== false && isLoggedIn ? (
          <div className="mt-2.5 flex items-center justify-end">
            <button
              type="button"
              disabled={toggling}
              onClick={handleSubscribeClick}
              className={`shrink-0 min-w-[4.75rem] flex items-center justify-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition disabled:opacity-50 ${
                isSubscribed
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40"
                  : "bg-emerald-500 text-white hover:bg-emerald-400"
              }`}
            >
              <span>{isSubscribed ? "★" : "☆"}</span>
              {isSubscribed ? tc("subscribed") : tc("subscribe")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const POPUP_WIDTH = 300;

function AgentPopup({
  agent,
  rect,
}: {
  agent: Agent;
  rect: DOMRect;
}) {
  const t = useTranslations("agents");
  const rightSpace = window.innerWidth - rect.right;
  const showRight = rightSpace >= POPUP_WIDTH + 20;
  const x = showRight ? rect.right + 12 : rect.left - POPUP_WIDTH - 12;
  const y = Math.max(8, Math.min(rect.top, window.innerHeight - 360));
  const introText = agent.intro_line || agent.personality || "";

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: x,
        top: y,
        width: POPUP_WIDTH,
        zIndex: 9999,
        pointerEvents: "none",
        animation: "fadeSlideIn 0.15s ease",
      }}
    >
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateX(${showRight ? "-6px" : "6px"}); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {/* 화살표 */}
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
        {/* 상단 이미지 배너 */}
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

        {/* 본문 */}
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

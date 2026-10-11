"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useState } from "react";
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

export default function SubscribedAgentsPage() {
  const t = useTranslations("subscribedAgents");
  const tc = useTranslations("common");
  const { user } = useAuth();
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subscribedMap, setSubscribedMap] = useState<Record<string, boolean>>({});
  const [subscriberCountMap, setSubscriberCountMap] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");

  const fetchAccessToken = useFetchAccessToken();

  useEffect(() => {
    void trackEvent("page_view", { page: "agents_subscribed" });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadAgents() {
      try {
        const token = await fetchAccessToken();
        if (!token) {
          if (!cancelled) setError("Please sign in to view subscribed agents.");
          if (!cancelled) setLoading(false);
          return;
        }
        const res = await fetch("/api/agents", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = (await res.json()) as { agents?: Agent[]; error?: string };
        if (!res.ok) throw new Error(payload.error || "Failed to load agents");
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
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load agents");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadAgents();
    return () => { cancelled = true; };
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

  const subscribedAgents = useMemo(() => {
    const q = search.trim().toLowerCase();
    const subbed = agents.filter((a) => subscribedMap[a.id] === true);
    if (!q) return subbed;
    return subbed.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.personality ?? "").toLowerCase().includes(q) ||
        (a.speaking_style ?? "").toLowerCase().includes(q) ||
        (a.intro_line ?? "").toLowerCase().includes(q) ||
        (a.concept ?? "").toLowerCase().includes(q)
    );
  }, [agents, subscribedMap, search]);

  return (
    <div className="h-dvh overflow-x-hidden overflow-y-auto relative text-zinc-100 lg-pl-sidebar">
      <SiteHeader />

      <PageContainer className="space-y-10">
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
            href="/agents"
            className="shrink-0 mt-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-zinc-300 border border-white/10 hover:bg-white/5 transition-all active:scale-95"
          >
            {t("browseAll")}
          </Link>
        </div>

        {!user && !loading ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
            <p className="text-zinc-400 text-sm">{t("signInRequired")}</p>
          </div>
        ) : null}

        {loading ? (
          <div className="text-sm text-zinc-500">{tc("loading")}</div>
        ) : null}
        {error ? <div className="text-sm text-red-500">{error}</div> : null}

        {!loading && !error && user ? (
          <>
            {/* Search */}
            <div className="relative">
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

            {/* Agent Grid */}
            {subscribedAgents.length > 0 ? (
              <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
                {subscribedAgents.map((agent) => (
                  <SubscribedAgentGridCard
                    key={agent.id}
                    agent={agent}
                    isSubscribed={subscribedMap[agent.id] ?? false}
                    onToggleSubscribe={() => handleToggleSubscribe(agent.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center">
                <p className="text-zinc-400 text-sm">
                  {search.trim()
                    ? t("noSearchResults", { query: search.trim() })
                    : t("emptyState")}
                </p>
                {!search.trim() ? (
                  <Link
                    href="/agents"
                    className="inline-block mt-4 px-5 py-2 rounded-xl text-sm font-semibold transition-all active:scale-95"
                    style={{ background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#002e1f" }}
                  >
                    {t("browseAgents")}
                  </Link>
                ) : null}
              </div>
            )}
          </>
        ) : null}
      </PageContainer>
    </div>
  );
}

function SubscribedAgentGridCard({
  agent,
  isSubscribed,
  onToggleSubscribe,
}: {
  agent: Agent;
  isSubscribed: boolean;
  onToggleSubscribe: () => void;
}) {
  const t = useTranslations("subscribedAgents");
  const tc = useTranslations("common");
  const router = useRouter();
  const [toggling, setToggling] = useState(false);
  const storedColor = agent.dominant_color ? applyColorTransform(agent.dominant_color) : null;
  const extractedColor = useDominantColor(storedColor ? undefined : agent.image_url);
  const dominantColor = storedColor ?? extractedColor;
  const introText = agent.intro_line || agent.personality || t("noIntro");
  const profileHref = `/agents/${encodeURIComponent(agent.id)}`;
  const createHref = `/series/create`;

  async function handleUnsubscribe(e: React.MouseEvent) {
    e.stopPropagation();
    if (toggling) return;
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
        {agent.image_url ? (
          <img
            className="h-16 w-16 rounded-2xl object-cover"
            src={agent.image_url}
            alt={agent.name}
          />
        ) : (
          <div className="h-16 w-16 rounded-2xl bg-emerald-900/40 border border-white/10" />
        )}
        {agent.is_public !== false ? (
          <Link
            href={createHref}
            className="px-2.5 py-1.5 rounded-lg border border-emerald-400/40 text-emerald-200 text-xs hover:bg-emerald-500/10 transition"
            onClick={(e) => e.stopPropagation()}
          >
            {tc("useInSeries")}
          </Link>
        ) : null}
      </div>

      <div className="mt-3 -mx-1 px-2.5 py-2 rounded-xl bg-black/35 backdrop-blur-sm flex-1 flex flex-col">
        <div className="text-xs uppercase tracking-widest text-emerald-300">{tc("agents")}</div>
        <div className="mt-1 text-base font-medium text-white line-clamp-1">{agent.name}</div>
        <div className="mt-1.5 text-xs text-zinc-300 flex-1 line-clamp-3">{introText}</div>

        <div className="mt-2.5 flex items-center justify-end">
          <button
            type="button"
            disabled={toggling}
            onClick={handleUnsubscribe}
            className="shrink-0 min-w-[4.75rem] flex items-center justify-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition disabled:opacity-50 bg-emerald-500/20 text-emerald-300 border border-emerald-400/40"
          >
            <span>★</span>
            {isSubscribed ? tc("subscribed") : tc("subscribe")}
          </button>
        </div>
      </div>
    </div>
  );
}

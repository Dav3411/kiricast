"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/AuthProvider";
import { SiteHeader } from "@/components/SiteHeader";
import { PageContainer } from "@/components/PageContainer";
import { useFetchWithAuth } from "@/hooks/useFetchWithAuth";
import { useJobQueue } from "@/components/JobQueueProvider";

type Episode = {
  id: string;
  title: string | null;
  durationSec: number | null;
  episodeNumber: number | null;
  episodeType: string | null;
  publishedAt: string | null;
};

type SeriesData = {
  id: string;
  title: string;
  agent1Id: string;
  agent2Id: string;
  setting: string;
  relationshipContext: string;
  totalEpisodes: number | null;
  storyContext: unknown[];
  status: string;
  locked: boolean;
  seriesDocument: {
    characters: { name: string; concept?: string; background?: string; personality: string; secret: string; speech_examples: string[] }[];
    genre: { main: string; sub: string };
    worldview: { time_period: string; space: string; tone: string };
    main_conflicts: { surface: string; internal: string; relationship: string };
  } | null;
  arcDocument: {
    season_goal: string;
    act1_transition_event: string;
    mid_reversal: string;
    climax_conditions: string;
  } | null;
  rollingMemory: string;
  coreMemory: { key_events?: string[]; revealed_secrets?: string[]; relationship_status?: Record<string, string> } | null;
  characterFsm: Record<string, Record<string, number>> | null;
  createdAt: string;
  ownerId?: string;
  isOwner?: boolean;
};

function timeAgo(dateStr: string, t: (key: string, values?: Record<string, number>) => string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return t("minutesAgo", { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("hoursAgo", { count: hrs });
  const days = Math.floor(hrs / 24);
  return t("daysAgo", { count: days });
}

type NextEpisodeOption = {
  label: string;
  title: string;
  setting: string;
  situation: string;
  core_emotion?: string;
  relationship_state?: string;
  tone?: string;
  episode_type?: string;
};

type AgentInfo = {
  id: string;
  name: string;
  image_url?: string;
  concept?: string;
  personality?: string;
  speaking_style?: string;
  appearance?: string;
  intro_line?: string;
};

function CollapsibleSection({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-purple-400/30 bg-white/70 backdrop-blur-xl shadow-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-purple-50/30 transition"
      >
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        <svg
          className={`w-4 h-4 text-purple-500 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-5 pb-5 border-t border-purple-200/30">{children}</div>}
    </div>
  );
}

export default function SeriesPage() {
  const t = useTranslations("seriesDetail");
  const tc = useTranslations("common");
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { fetchWithAuth } = useFetchWithAuth();
  const { jobs, addJob } = useJobQueue();

  const [series, setSeries] = useState<SeriesData | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [agent1, setAgent1] = useState<AgentInfo | null>(null);
  const [agent2, setAgent2] = useState<AgentInfo | null>(null);
  const [hoveredCharIndex, setHoveredCharIndex] = useState<number | null>(null);
  const [cardPosition, setCardPosition] = useState<{ top: number; left: number } | null>(null);
  const characterRefs = useRef<(HTMLDivElement | null)[]>([]);
  const leaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [loadingData, setLoadingData] = useState(true);
  const hadActiveJobRef = useRef(false);

  // Continue story — inline options
  const [continueOpen, setContinueOpen] = useState(false);
  const [continueLoading, setContinueLoading] = useState(false);
  const [continueOptions, setContinueOptions] = useState<NextEpisodeOption[]>([]);
  const [forcedNextType, setForcedNextType] = useState<string | null>(null);
  const [continueSeriesData, setContinueSeriesData] = useState<{
    seriesId: string;
    agent1Id: string;
    agent2Id: string;
    nextEpisodeNumber: number;
    setting?: string;
  } | null>(null);
  const [continueCreating, setContinueCreating] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);
  const [selectedOptionIdx, setSelectedOptionIdx] = useState<number | null>(null);

  const handleContinueOpen = useCallback(async () => {
    if (!id) return;
    setContinueOpen(true);
    setContinueLoading(true);
    setContinueError(null);
    setContinueOptions([]);
    setContinueSeriesData(null);
    setSelectedOptionIdx(null);
    setForcedNextType(null);

    try {
      const res = await fetchWithAuth(`/api/series/${encodeURIComponent(id)}/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to load options");

      setContinueSeriesData({
        seriesId: data.seriesId,
        agent1Id: data.agent1Id,
        agent2Id: data.agent2Id,
        nextEpisodeNumber: data.nextEpisodeNumber,
        setting: data.setting ?? "",
      });
      const raw = data.nextEpisodeOptions;
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        setForcedNextType(raw.forced_next_type ?? null);
        setContinueOptions(Array.isArray(raw.options) ? raw.options : []);
      } else {
        setForcedNextType(null);
        setContinueOptions(Array.isArray(raw) ? raw : []);
      }
    } catch (e) {
      setContinueError(e instanceof Error ? e.message : "Failed to load options");
    } finally {
      setContinueLoading(false);
    }
  }, [id, fetchWithAuth]);

  const handleSelectOption = useCallback(async (option: NextEpisodeOption) => {
    if (!continueSeriesData || continueCreating) return;
    setContinueCreating(true);
    setContinueError(null);

    try {
      const epTitle = `${option.title || "Next Episode"}`.slice(0, 60);
      const res = await fetchWithAuth("/api/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent1Id: continueSeriesData.agent1Id,
          agent2Id: continueSeriesData.agent2Id,
          title: epTitle,
          setting: (option.setting || "").slice(0, 300),
          situation: (option.situation || "").slice(0, 300),
          core_emotion: (option.core_emotion || "").slice(0, 150),
          relationship_state: (option.relationship_state || "").slice(0, 150),
          tone: (option.tone || "").slice(0, 100),
          seriesId: continueSeriesData.seriesId,
          episodeNumber: continueSeriesData.nextEpisodeNumber,
          ...(option.episode_type ? { episodeType: option.episode_type } : {}),
        }),
      });
      if (res.status === 402) {
        router.push(`/credits?return=${encodeURIComponent(`/series/${id}`)}`);
        return;
      }
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to create episode");

      const jobId = data.jobId;
      if (jobId) {
        addJob({
          id: jobId,
          kind: "clip",
          name: `${series?.title || epTitle} EP.${continueSeriesData.nextEpisodeNumber}`,
          seriesId: continueSeriesData.seriesId,
          episodeNumber: continueSeriesData.nextEpisodeNumber,
        });
      }
      setContinueOpen(false);
    } catch (e) {
      setContinueError(e instanceof Error ? e.message : "Failed to create episode");
    } finally {
      setContinueCreating(false);
    }
  }, [continueSeriesData, continueCreating, fetchWithAuth, router, id, addJob, series?.title]);

  const handleSoftResetConfirm = useCallback(async () => {
    if (!continueSeriesData || continueCreating) return;
    setContinueCreating(true);
    setContinueError(null);

    try {
      const epTitle = `EP.${continueSeriesData.nextEpisodeNumber} — Soft Reset`;
      const res = await fetchWithAuth("/api/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent1Id: continueSeriesData.agent1Id,
          agent2Id: continueSeriesData.agent2Id,
          title: epTitle,
          setting: continueSeriesData.setting || "",
          situation: "",
          core_emotion: "",
          relationship_state: "",
          tone: "",
          seriesId: continueSeriesData.seriesId,
          episodeNumber: continueSeriesData.nextEpisodeNumber,
          episodeType: "soft_reset",
        }),
      });
      if (res.status === 402) {
        router.push(`/credits?return=${encodeURIComponent(`/series/${id}`)}`);
        return;
      }
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to create episode");

      const jobId = data.jobId;
      if (jobId) {
        addJob({
          id: jobId,
          kind: "clip",
          name: `${series?.title || epTitle} EP.${continueSeriesData.nextEpisodeNumber}`,
          seriesId: continueSeriesData.seriesId,
          episodeNumber: continueSeriesData.nextEpisodeNumber,
        });
      }
      setContinueOpen(false);
    } catch (e) {
      setContinueError(e instanceof Error ? e.message : "Failed to create episode");
    } finally {
      setContinueCreating(false);
    }
  }, [continueSeriesData, continueCreating, fetchWithAuth, router, id, addJob, series?.title]);

  // 캐릭터 호버 시 카드 위치: 이미지와 겹치지 않게 캐릭터 아래(또는 위)에 배치 (ref 타이밍을 위해 rAF 사용)
  useLayoutEffect(() => {
    if (hoveredCharIndex === null) {
      setCardPosition(null);
      return;
    }
    const id = requestAnimationFrame(() => {
      const el = characterRefs.current[hoveredCharIndex];
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cardW = 320;
      const gap = 8;
      const maxH = Math.min(400, window.innerHeight * 0.6);
      let left = rect.left + rect.width / 2 - cardW / 2;
      left = Math.max(16, Math.min(left, window.innerWidth - cardW - 16));
      let top = rect.bottom + gap;
      if (top + maxH > window.innerHeight - 16) {
        top = rect.top - maxH - gap;
        top = Math.max(16, top);
      }
      setCardPosition({ top, left });
    });
    return () => cancelAnimationFrame(id);
  }, [hoveredCharIndex]);

  useEffect(() => {
    if (authLoading || !id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/series/${encodeURIComponent(id)}`);
        const data = (await res.json()) as {
          series?: SeriesData;
          episodes?: Episode[];
          error?: string;
        };
        if (!res.ok || data.error) throw new Error(data.error ?? "Failed to load series");
        if (cancelled) return;
        setSeries(data.series ?? null);
        setEpisodes(data.episodes ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load series");
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    })();
    return () => { cancelled = true; };
  }, [authLoading, user, id, fetchWithAuth]);

  // 에이전트 정보 로드 (시리즈에 agent1Id/agent2Id 있을 때)
  useEffect(() => {
    if (!series?.agent1Id && !series?.agent2Id) return;
    let cancelled = false;
    (async () => {
      if (series.agent1Id) {
        try {
          const res = await fetchWithAuth(`/api/agents/${encodeURIComponent(series.agent1Id)}`);
          const data = (await res.json()) as { agent?: AgentInfo };
          if (!cancelled && data.agent) setAgent1(data.agent);
        } catch { /* ignore */ }
      }
      if (series.agent2Id) {
        try {
          const res = await fetchWithAuth(`/api/agents/${encodeURIComponent(series.agent2Id)}`);
          const data = (await res.json()) as { agent?: AgentInfo };
          if (!cancelled && data.agent) setAgent2(data.agent);
        } catch { /* ignore */ }
      }
    })();
    return () => { cancelled = true; };
  }, [series?.agent1Id, series?.agent2Id, fetchWithAuth]);

  // 잡이 완료되면 에피소드 목록 refetch
  const activeJob = jobs.find(
    (j) => j.seriesId === id && (j.status === "queued" || j.status === "processing")
  );
  useEffect(() => {
    if (activeJob) {
      hadActiveJobRef.current = true;
      return;
    }
    if (!hadActiveJobRef.current) return;
    hadActiveJobRef.current = false;
    if (!user || !id) return;
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/series/${encodeURIComponent(id)}`);
        const data = (await res.json()) as { series?: SeriesData; episodes?: Episode[]; error?: string };
        if (!res.ok || data.error) return;
        setSeries(data.series ?? null);
        setEpisodes(data.episodes ?? []);
      } catch { /* ignore */ }
    })();
  }, [activeJob, user, id, fetchWithAuth]);

  if (authLoading || loadingData) {
    return (
      <div className="h-dvh overflow-x-hidden overflow-y-auto relative lg-pl-sidebar">
        <SiteHeader />
        <PageContainer>
          <div className="max-w-2xl mx-auto py-20 flex justify-center">
            <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          </div>
        </PageContainer>
      </div>
    );
  }

  if (error || !series) {
    return (
      <div className="h-dvh overflow-x-hidden overflow-y-auto relative lg-pl-sidebar">
        <SiteHeader />
        <PageContainer>
          <div className="max-w-2xl mx-auto py-20 text-center">
            <div className="rounded-2xl backdrop-blur-xl bg-red-50/70 border border-red-300/40 shadow-xl p-6">
              <p className="text-red-600 font-medium">{error ?? t("notFound")}</p>
            </div>
          </div>
        </PageContainer>
      </div>
    );
  }

  const currentEpisodeCount = episodes.length;
  const doc = series.seriesDocument;

  return (
    <div className="h-dvh overflow-x-hidden overflow-y-auto relative lg-pl-sidebar">
      <SiteHeader />
      <PageContainer>
        <div className="max-w-2xl mx-auto py-8 space-y-5">
          {/* Header */}
          <div
            className="rounded-2xl border border-purple-400/40 shadow-xl p-6 relative overflow-hidden"
            style={{ background: "linear-gradient(135deg, rgba(147,51,234,0.25) 0%, rgba(88,28,135,0.4) 100%)" }}
          >
            <div className="relative z-10">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-purple-300/80 mb-2">
                {doc?.genre && <span>{doc.genre.main} / {doc.genre.sub}</span>}
                {doc?.genre && <span className="text-purple-500/40">|</span>}
                <span>{t("episodeCount", { count: currentEpisodeCount })}</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-3xl font-extrabold text-white leading-tight">{series.title}</h1>
              </div>
              {(series.setting || doc?.worldview.tone) && (
                <p className="mt-2 text-sm text-purple-200/70">
                  {series.setting}
                  {series.setting && doc?.worldview.tone ? " · " : ""}
                  {doc?.worldview.tone}
                </p>
              )}
            </div>
          </div>

          {/* Series Document — Characters: 이미지만 표시, hover 시 뷰포트 고정 카드로 설명 */}
          {doc && (
            <div className="space-y-4">
              <CollapsibleSection title={t("characters")} defaultOpen>
                <div className="flex flex-wrap gap-8 mt-3">
                  {doc.characters.map((char, i) => {
                    const imageUrl = i === 0 ? agent1?.image_url : i === 1 ? agent2?.image_url : undefined;
                    return (
                      <div
                        key={i}
                        ref={(el) => { characterRefs.current[i] = el; }}
                        className="flex flex-col items-center cursor-pointer"
                        onMouseEnter={() => {
                          if (leaveTimeoutRef.current) {
                            clearTimeout(leaveTimeoutRef.current);
                            leaveTimeoutRef.current = null;
                          }
                          setHoveredCharIndex(i);
                        }}
                        onMouseLeave={() => {
                          leaveTimeoutRef.current = setTimeout(() => {
                            leaveTimeoutRef.current = null;
                            setHoveredCharIndex(null);
                          }, 300);
                        }}
                      >
                        <div className="w-24 h-24 rounded-2xl bg-purple-100/50 border border-purple-200/50 overflow-hidden shrink-0 ring-2 ring-transparent transition-all hover:ring-purple-400/50">
                          {imageUrl ? (
                            <img src={imageUrl} alt={char.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-purple-400 text-2xl font-bold">
                              {char.name.slice(0, 1)}
                            </div>
                          )}
                        </div>
                        <span className="mt-2 text-sm font-medium text-gray-800">{char.name}</span>
                      </div>
                    );
                  })}
                </div>
              </CollapsibleSection>
            </div>
          )}

          {/* 호버 시 캐릭터와 겹치지 않는 위치에 카드 (portal). 캐릭터 또는 카드 위에 마우스가 있으면 유지, 둘 다 떠나면 닫힘 */}
          {mounted && doc && hoveredCharIndex !== null && cardPosition && doc.characters[hoveredCharIndex] && typeof document !== "undefined" && createPortal(
            <div
              className="fixed z-50 w-[320px] max-h-[60vh] overflow-y-auto rounded-2xl border border-purple-300/50 bg-white shadow-2xl p-6 [scrollbar-color:rgb(147,51,234)_rgb(243,232,255)]"
              style={{
                top: cardPosition.top,
                left: cardPosition.left,
              }}
              onMouseEnter={() => {
                if (leaveTimeoutRef.current) {
                  clearTimeout(leaveTimeoutRef.current);
                  leaveTimeoutRef.current = null;
                }
              }}
              onMouseLeave={() => {
                leaveTimeoutRef.current = setTimeout(() => {
                  leaveTimeoutRef.current = null;
                  setHoveredCharIndex(null);
                }, 200);
              }}
              aria-hidden
            >
              {(() => {
                const char = doc.characters[hoveredCharIndex!];
                return (
                  <>
                    <h4 className="text-lg font-semibold text-gray-900 mb-4">{char.name}</h4>
                    <div className="text-sm text-gray-600 space-y-2">
                      {char.concept && <p><span className="font-medium text-purple-700">{t("concept")}</span> {char.concept}</p>}
                      {!char.concept && char.background && <p><span className="font-medium text-purple-700">{t("background")}</span> {char.background}</p>}
                      <p><span className="font-medium text-purple-700">{t("personalityLabel")}</span> {char.personality}</p>
                      {char.speech_examples?.length > 0 && (
                        <div>
                          <span className="font-medium text-purple-700">{t("speechExamples")}</span>
                          <ul className="mt-1 ml-4 list-disc text-gray-500 space-y-0.5">
                            {char.speech_examples.map((ex, j) => <li key={j}>&ldquo;{ex}&rdquo;</li>)}
                          </ul>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>,
            document.body
          )}

          {/* Episode list */}
          {episodes.length > 0 && (
            <div>
              <h3 className="text-sm font-bold text-gray-800 mb-3">{t("episodesHeading")}</h3>
              <div className="space-y-2">
                {episodes.map((ep) => (
                  <Link
                    key={ep.id}
                    href={`/clips/${encodeURIComponent(ep.id)}`}
                    className="flex items-center gap-3 rounded-xl border border-purple-400/20 bg-white/70 backdrop-blur-xl px-4 py-3 hover:border-purple-400/60 hover:bg-purple-50/20 transition-all"
                  >
                    <span className="w-8 h-8 rounded-full bg-purple-600/20 text-purple-400 flex items-center justify-center text-sm font-bold shrink-0">
                      {ep.episodeNumber ?? "?"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">
                        {ep.title ?? tc("untitled")}
                      </div>
                      <div className="text-xs text-gray-500 flex items-center gap-2">
                        {ep.durationSec != null && <span>{ep.durationSec}s</span>}
                        {ep.episodeType && <span className="text-purple-400">{ep.episodeType}</span>}
                        {ep.publishedAt && <span>{timeAgo(ep.publishedAt, t)}</span>}
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-purple-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Progress bar — active job (any episode, including EP.1) */}
          {activeJob && (
            <div className="w-full rounded-xl px-4 py-3 border border-purple-400/30 bg-white/70 backdrop-blur-xl shadow-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-purple-900">
                  {t("episodeGenerating", { number: activeJob.episodeNumber ?? currentEpisodeCount + 1 })}
                </span>
                <span className="text-xs text-purple-500">
                  {activeJob.progress ?? 0}%
                </span>
              </div>
              <div className="w-full h-1.5 bg-purple-200/50 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-400 to-purple-600 rounded-full transition-all duration-500"
                  style={{ width: `${activeJob.progress ?? 0}%` }}
                />
              </div>
            </div>
          )}

          {/* Continue story — inline options */}
          {currentEpisodeCount > 0 && !activeJob && (
            <div>
              {!continueOpen ? (
                <button
                  type="button"
                  className="block w-full text-center rounded-2xl px-5 py-3.5 font-semibold text-lg shadow-xl shadow-purple-600/25 hover:shadow-purple-600/40 hover:scale-[1.01] active:scale-[0.99] transition-all"
                  style={{ background: "linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)", color: "#fff" }}
                  onClick={() => {
                    if (!user) {
                      router.push("/login");
                      return;
                    }
                    void handleContinueOpen();
                  }}
                >
                  {t("continueStory", { number: currentEpisodeCount + 1 })}
                </button>
              ) : continueLoading ? (
                <div
                  className="rounded-2xl border border-purple-500/25 shadow-xl backdrop-blur-xl p-6"
                  style={{ background: "rgba(88,28,135,0.15)" }}
                >
                  <div className="flex items-center justify-center gap-3 py-4">
                    <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-purple-300/80">{t("loadingChoices")}</span>
                  </div>
                </div>
              ) : continueCreating ? (
                <div
                  className="rounded-2xl border border-purple-500/25 shadow-xl backdrop-blur-xl p-6"
                  style={{ background: "rgba(88,28,135,0.15)" }}
                >
                  <div className="flex items-center justify-center gap-3 py-4">
                    <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm text-purple-300/80">{t("creatingEpisode")}</span>
                  </div>
                </div>
              ) : (
                <div
                  className="rounded-2xl border border-purple-500/25 shadow-xl backdrop-blur-xl p-5"
                  style={{ background: "rgba(88,28,135,0.15)" }}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-purple-400/80">
                      {t("episodeLabel", { number: continueSeriesData?.nextEpisodeNumber ?? "?" })}
                    </span>
                    <span className="text-purple-500/30">—</span>
                    <span className="text-sm font-semibold text-zinc-100">
                      {forcedNextType === "soft_reset" ? t("softReset") : t("chooseDirection")}
                    </span>
                  </div>

                  {continueError && (
                    <div className="rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-300 mb-3" style={{ background: "rgba(220,38,38,0.1)" }}>
                      {continueError}
                    </div>
                  )}

                  {forcedNextType === "soft_reset" ? (
                    <div className="rounded-xl border border-amber-500/30 p-4 text-center" style={{ background: "rgba(217,119,6,0.1)" }}>
                      <div className="text-sm font-semibold text-amber-300 mb-1">{t("standaloneEpisode")}</div>
                      <div className="text-xs text-amber-400/60">{t("standaloneDesc")}</div>
                    </div>
                  ) : continueOptions.length > 0 ? (
                    <div className="flex flex-col gap-2.5">
                      {continueOptions.map((opt, i) => {
                        const isSelected = selectedOptionIdx === i;
                        return (
                          <button
                            key={i}
                            type="button"
                            className={`w-full text-left rounded-xl border transition-all duration-200 ${
                              isSelected
                                ? "border-purple-400/60 shadow-lg shadow-purple-500/15 ring-1 ring-purple-400/30"
                                : "border-zinc-700/50 hover:border-purple-500/40"
                            }`}
                            style={{ background: isSelected ? "rgba(147,51,234,0.12)" : "rgba(255,255,255,0.03)" }}
                            onClick={() => setSelectedOptionIdx(isSelected ? null : i)}
                          >
                            <div className="p-3.5">
                              <div className="flex items-start gap-3">
                                <span className={`shrink-0 mt-0.5 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-colors ${
                                  isSelected ? "bg-purple-500 text-white" : "bg-zinc-800 text-zinc-400 border border-zinc-700/60"
                                }`}>
                                  {String.fromCharCode(65 + i)}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className={`text-sm font-medium leading-snug ${isSelected ? "text-purple-200" : "text-zinc-200"}`}>{opt.label}</div>
                                  {opt.episode_type && (
                                    <span className="inline-block mt-1 text-[10px] px-2 py-0.5 rounded-full font-medium bg-purple-500/20 text-purple-300 border border-purple-500/20">
                                      {opt.episode_type.replace(/_/g, " ")}
                                    </span>
                                  )}
                                </div>
                                <svg className={`shrink-0 mt-1 w-4 h-4 transition-transform duration-200 ${isSelected ? "rotate-180 text-purple-400" : "text-zinc-500"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="6 9 12 15 18 9"/>
                                </svg>
                              </div>
                            </div>
                            <div className={`overflow-hidden transition-all duration-200 ${isSelected ? "max-h-48 opacity-100" : "max-h-0 opacity-0"}`}>
                              <div className="px-3.5 pb-3.5 ml-10 space-y-2 border-t border-purple-500/10 pt-3">
                                {opt.situation && (
                                  <div className="text-xs leading-relaxed text-zinc-400">
                                    <span className="text-purple-400 font-medium">{t("situation")}</span>
                                    <p className="mt-0.5">{opt.situation}</p>
                                  </div>
                                )}
                                {opt.setting && (
                                  <div className="text-xs leading-relaxed text-zinc-400">
                                    <span className="text-purple-400 font-medium">{t("settingLabel")}</span>
                                    <p className="mt-0.5">{opt.setting}</p>
                                  </div>
                                )}
                                {opt.core_emotion && (
                                  <div className="text-xs leading-relaxed text-zinc-400">
                                    <span className="text-purple-400 font-medium">{t("emotion")}</span>
                                    <p className="mt-0.5">{opt.core_emotion}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : !continueError ? (
                    <div className="text-sm text-zinc-500 text-center py-4">{t("noChoicesYet")}</div>
                  ) : null}

                  <div className="flex gap-2.5 mt-5">
                    <button
                      type="button"
                      className="flex-1 rounded-xl border border-zinc-700/60 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition"
                      onClick={() => setContinueOpen(false)}
                    >
                      {tc("cancel")}
                    </button>
                    <button
                      type="button"
                      className="flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-purple-600/25 hover:scale-[1.01] active:scale-[0.99]"
                      style={{
                        background: (forcedNextType === "soft_reset" || selectedOptionIdx !== null)
                          ? "linear-gradient(135deg, #a78bfa, #7c3aed)"
                          : "#27272a",
                        color: (forcedNextType === "soft_reset" || selectedOptionIdx !== null) ? "#fff" : "#71717a",
                      }}
                      disabled={forcedNextType === "soft_reset" ? false : selectedOptionIdx === null}
                      onClick={() => {
                        if (forcedNextType === "soft_reset") {
                          void handleSoftResetConfirm();
                        } else if (selectedOptionIdx !== null) {
                          void handleSelectOption(continueOptions[selectedOptionIdx]!);
                        }
                      }}
                    >
                      {t("createWithCredits", { cost: Number(process.env.NEXT_PUBLIC_CLIP_CREDIT_COST ?? "100") || 100 })}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </PageContainer>
    </div>
  );
}

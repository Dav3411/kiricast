"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/AuthProvider";
import { SiteHeader } from "@/components/SiteHeader";
import { trackEvent } from "@/lib/analytics";
import { features } from "@/lib/featuresClient";
import type { ClipPayload } from "@/types/clip";
import { ClipCard } from "@/components/ClipCard";

type Profile = { userId: string; nickname: string };

type Clip = ClipPayload;

type SeriesSummary = {
  id: string;
  title: string;
  currentEpisode: number;
  totalEpisodes: number | null;
  status: string;
  createdAt: string;
};

type SeriesEpisode = {
  id: string;
  title: string | null;
  durationSec: number | null;
  episodeNumber: number | null;
  publishedAt: string | null;
};

type SeriesWithEpisodes = {
  series: SeriesSummary;
  episodes: SeriesEpisode[];
};

import type { Agent } from "@/types/agent";

export default function UserHomePage() {
  const params = useParams();
  const router = useRouter();
  const t = useTranslations("userProfile");
  const tc = useTranslations("common");
  const { user, session, loading: authLoading } = useAuth();
  const id = typeof params?.id === "string" ? params.id : "";
  const token = session?.access_token ?? "";

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [clipsLoading, setClipsLoading] = useState(true);
  const [clipsError, setClipsError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [seriesList, setSeriesList] = useState<SeriesSummary[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(true);
  const [seriesError, setSeriesError] = useState<string | null>(null);
  const [seriesWithEpisodes, setSeriesWithEpisodes] = useState<SeriesWithEpisodes[]>([]);
  const [seriesEpisodesLoading, setSeriesEpisodesLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"clips" | "agents" | "series">("series");

  const isOwnProfile = !!user && !!id && user.id === id;

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(`/users/${id}`)}`);
      return;
    }
    if (!id) return;
    void trackEvent("page_view", { page: "user_home", userId: id });
  }, [authLoading, user, id, router]);

  useEffect(() => {
    if (!id || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(id)}/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { nickname?: string; userId?: string; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setProfileError(data.error ?? "Profile not found");
          return;
        }
        setProfile({ userId: data.userId ?? id, nickname: data.nickname ?? "User" });
      } catch {
        if (!cancelled) setProfileError("Failed to load profile");
      }
    })();
    return () => { cancelled = true; };
  }, [id, token]);

  useEffect(() => {
    if (!id || !token) return;
    let cancelled = false;
    setClipsLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(id)}/clips?limit=24`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { clips?: Clip[]; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setClipsError(data.error ?? "Failed to load clips");
        } else {
          setClips(Array.isArray(data.clips) ? data.clips : []);
        }
      } catch {
        if (!cancelled) setClipsError("Failed to load clips");
      } finally {
        if (!cancelled) setClipsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, token]);

  useEffect(() => {
    if (!id || !token) return;
    let cancelled = false;
    setAgentsLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(id)}/agents?limit=24`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { agents?: Agent[]; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setAgentsError(data.error ?? "Failed to load agents");
        } else {
          setAgents(Array.isArray(data.agents) ? data.agents : []);
        }
      } catch {
        if (!cancelled) setAgentsError("Failed to load agents");
      } finally {
        if (!cancelled) setAgentsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, token]);

  useEffect(() => {
    if (!id || !token || !isOwnProfile) {
      setSeriesLoading(false);
      return;
    }
    let cancelled = false;
    setSeriesLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/series", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { series?: SeriesSummary[]; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setSeriesError(data.error ?? "Failed to load series");
        } else {
          setSeriesList(Array.isArray(data.series) ? data.series : []);
        }
      } catch {
        if (!cancelled) setSeriesError("Failed to load series");
      } finally {
        if (!cancelled) setSeriesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, token, isOwnProfile]);

  useEffect(() => {
    if (!token || seriesList.length === 0) {
      setSeriesWithEpisodes([]);
      return;
    }
    let cancelled = false;
    setSeriesEpisodesLoading(true);
    (async () => {
      try {
        const results = await Promise.all(
          seriesList.map(async (s) => {
            const res = await fetch(`/api/series/${encodeURIComponent(s.id)}`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            const data = (await res.json()) as {
              series?: unknown;
              episodes?: Array<{
                id: string;
                title: string | null;
                durationSec: number | null;
                episodeNumber: number | null;
                publishedAt: string | null;
              }>;
              error?: string;
            };
            if (!res.ok || !data.episodes) return { series: s, episodes: [] as SeriesEpisode[] };
            return {
              series: s,
              episodes: (data.episodes ?? []).map((ep) => ({
                id: ep.id,
                title: ep.title,
                durationSec: ep.durationSec,
                episodeNumber: ep.episodeNumber,
                publishedAt: ep.publishedAt ?? null,
              })),
            };
          })
        );
        if (!cancelled) setSeriesWithEpisodes(results);
      } finally {
        if (!cancelled) setSeriesEpisodesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, seriesList]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center lg-pl-sidebar">
        <div className="text-zinc-500">{tc("loading")}</div>
      </div>
    );
  }

  if (!id) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-500">{t("invalidUser")}</div>
      </div>
    );
  }

  return (
    <div className="h-dvh overflow-x-hidden overflow-y-auto relative text-zinc-100 lg-pl-sidebar">
      <SiteHeader />

      <main className="max-w-5xl mx-auto px-6 py-10 relative z-10">
        {profileError ? (
          <div className="text-red-500">{profileError}</div>
        ) : (
          <>
            <div className="mb-6 rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10 p-6 flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h1 className="text-2xl font-semibold text-gray-100">
                  {isOwnProfile ? t("myPage") : (profile ? profile.nickname : tc("loading"))}
                </h1>
                <p className="mt-1 text-sm text-zinc-400">
                  {isOwnProfile ? t("ownSubtitle") : t("otherSubtitle")}
                </p>
              </div>
              {isOwnProfile ? (
                <Link href="/account" className="px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-emerald-400/25 border-0" style={{ background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#002e1f" }}>
                  {tc("account")}
                </Link>
              ) : null}
            </div>

            <div className="mb-6 flex items-center gap-1 rounded-xl backdrop-blur-xl bg-white/5 border border-white/10 p-1 w-fit">
              {isOwnProfile && (
                <button
                  type="button"
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === "series" ? "shadow-lg shadow-emerald-400/20" : "text-zinc-400 hover:text-zinc-200"}`}
                  style={activeTab === "series" ? { background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#003d2b" } : {}}
                  onClick={() => setActiveTab("series")}
                >
                  {t("tabSeries")}
                </button>
              )}
              <button
                type="button"
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === "clips" ? "shadow-lg shadow-emerald-400/20" : "text-zinc-400 hover:text-zinc-200"}`}
                style={activeTab === "clips" ? { background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#003d2b" } : {}}
                onClick={() => setActiveTab("clips")}
              >
                {t("tabClips")}
              </button>
              <button
                type="button"
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === "agents" ? "shadow-lg shadow-emerald-400/20" : "text-zinc-400 hover:text-zinc-200"}`}
                style={activeTab === "agents" ? { background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#003d2b" } : {}}
                onClick={() => setActiveTab("agents")}
              >
                {t("tabAgents")}
              </button>
            </div>

            {activeTab === "clips" && (
              <section>
                <h2 className="text-lg font-medium text-gray-100">{t("tabClips")}</h2>
                {clipsLoading ? (
                  <p className="mt-2 text-sm text-zinc-500">{t("loadingClips")}</p>
                ) : clipsError ? (
                  <p className="mt-2 text-sm text-red-500">{clipsError}</p>
                ) : clips.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">{t("noClipsYet")}</p>
                ) : (
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {clips.map((clip) => (
                      <div key={clip.id} className="relative group">
                        <ClipCard clip={clip} />
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {activeTab === "agents" && (
              <section>
                <h2 className="text-lg font-medium text-gray-100">{t("tabAgents")}</h2>
                {agentsLoading ? (
                  <p className="mt-2 text-sm text-zinc-500">{t("loadingAgents")}</p>
                ) : agentsError ? (
                  <p className="mt-2 text-sm text-red-500">{agentsError}</p>
                ) : agents.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">{t("noAgentsYet")}</p>
                ) : (
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {agents.map((agent) => {
                      const href = features.agentPages
                        ? `/agents/${encodeURIComponent(agent.id)}`
                        : `/series/create`;
                      return (
                        <Link
                          key={agent.id}
                          href={href}
                          className="block rounded-2xl p-4 backdrop-blur-xl bg-white/5 border border-white/10 hover:border-white/20 hover:shadow-lg hover:shadow-emerald-500/10 transition"
                        >
                          {agent.image_url ? (
                            <img
                              src={agent.image_url}
                              alt={agent.name}
                              className="w-full aspect-square object-cover rounded-xl"
                            />
                          ) : (
                            <div className="w-full aspect-square rounded-xl bg-emerald-900/30 flex items-center justify-center text-emerald-400 text-sm">
                              {tc("noImage")}
                            </div>
                          )}
                          <div className="mt-3 text-sm font-medium text-zinc-100">{agent.name}</div>
                          {agent.personality ? (
                            <div className="mt-1 text-xs text-zinc-500 line-clamp-2">{agent.personality}</div>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {activeTab === "series" && (
              <section>
                <h2 className="text-lg font-medium text-gray-100">{t("tabSeries")}</h2>
                {seriesLoading ? (
                  <p className="mt-2 text-sm text-zinc-500">{t("loadingSeries")}</p>
                ) : seriesError ? (
                  <p className="mt-2 text-sm text-red-500">{seriesError}</p>
                ) : seriesList.length === 0 ? (
                  <p className="mt-2 text-sm text-zinc-500">{t("noSeriesYet")}</p>
                ) : (
                  <div className="mt-4 space-y-6">
                    {(seriesWithEpisodes.length > 0 ? seriesWithEpisodes : seriesList.map((s) => ({ series: s, episodes: [] as SeriesEpisode[] }))).map(
                      ({ series: s, episodes }) => (
                        <div key={s.id} className="relative group rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10 overflow-hidden">
                          <div className="p-4 flex items-start justify-between gap-4 flex-wrap">
                            <Link
                              href={`/series/${encodeURIComponent(s.id)}`}
                              className="min-w-0 flex-1"
                            >
                              <div className="text-sm font-medium text-zinc-100 truncate">{s.title}</div>
                              <div className="mt-1.5 flex items-center gap-2 text-xs text-zinc-500">
                                <span>{t("episodeCount", { count: s.currentEpisode })}</span>
                                {s.totalEpisodes != null && (
                                  <span className="text-zinc-600">/ {s.totalEpisodes}</span>
                                )}
                              </div>
                              <div className="mt-2 flex items-center gap-2">
                                <span
                                  className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                    s.status === "completed"
                                      ? "bg-emerald-500/15 text-emerald-400"
                                      : "bg-purple-500/15 text-purple-400"
                                  }`}
                                >
                                  {s.status === "completed" ? tc("completed") : tc("inProgress")}
                                </span>
                              </div>
                            </Link>
                          </div>
                          <div className="px-4 pb-4">
                            {seriesEpisodesLoading ? (
                              <p className="text-xs text-zinc-500">{t("loadingEpisodes")}</p>
                            ) : episodes.length === 0 ? (
                              <p className="text-xs text-zinc-500">{t("noEpisodesYet")}</p>
                            ) : (
                              <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-zinc-600 scrollbar-track-transparent">
                                {episodes.map((ep) => (
                                  <Link
                                    key={ep.id}
                                    href={`/clips/${encodeURIComponent(ep.id)}`}
                                    className="shrink-0 w-36 rounded-xl p-3 backdrop-blur-xl bg-white/5 border border-white/10 hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/10 transition text-left"
                                  >
                                    <div className="text-[11px] font-medium text-emerald-400/90">
                                      EP.{ep.episodeNumber ?? "?"}
                                    </div>
                                    <div className="mt-1 text-xs text-zinc-100 line-clamp-2">
                                      {ep.title ?? tc("untitled")}
                                    </div>
                                    {ep.durationSec != null && (
                                      <div className="mt-1 text-[10px] text-zinc-500">
                                        {Math.floor(ep.durationSec / 60)}:{String(Math.floor(ep.durationSec % 60)).padStart(2, "0")}
                                      </div>
                                    )}
                                  </Link>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    )}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

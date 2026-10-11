"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { useJobQueue } from "@/components/JobQueueProvider";
import { SiteHeader } from "@/components/SiteHeader";
import { PageContainer } from "@/components/PageContainer";
import { trackEvent } from "@/lib/analytics";
import type { Agent, VoiceOption, CreateJobResponse, JobStatus } from "@/types/agent";
import { useFetchWithAuth } from "@/hooks/useFetchWithAuth";
import { useVoices } from "@/hooks/useVoices";
import { useTranslations } from "next-intl";
import { useLocaleSettings } from "@/components/LocaleProvider";
import { SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config";

type JobStatusResponse = {
  job?: {
    id: string;
    status: JobStatus;
    progress: number | null;
    error: string | null;
    result?: unknown;
  };
  error?: string;
};

type AgentPipelineStep =
  | "queued"
  | "generating_spec"
  | "creating_avatar"
  | "selecting_voice"
  | "uploading"
  | "saving"
  | "done";

const AGENT_PIPELINE_STEPS: { key: AgentPipelineStep; labelKey: string }[] = [
  { key: "queued", labelKey: "waitingForWorker" },
  { key: "generating_spec", labelKey: "generatingSpec" },
  { key: "creating_avatar", labelKey: "creatingAvatar" },
  { key: "selecting_voice", labelKey: "selectingVoice" },
  { key: "uploading", labelKey: "uploadingAssets" },
  { key: "saving", labelKey: "savingAgent" },
  { key: "done", labelKey: "complete" },
];

// Time thresholds for interpolation during generator phase (progress 10→40)
const SPEC_SEC = 8;    // 0~8s: generating spec
const AVATAR_SEC = 20; // 8~20s: creating avatar
// 20s+: selecting voice (until server reports 40)

function extractAgentIdFromResult(result: unknown) {
  if (!result || typeof result !== "object") return null;
  const v = (result as Record<string, unknown>)["agent_id"];
  return typeof v === "string" ? v : null;
}

export default function CreateAgentPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { creationLanguage, updateLanguageSettings } = useLocaleSettings();
  const t = useTranslations("agentCreate");
  const tc = useTranslations("common");

  const AGENT_CREDIT_COST = Number(process.env.NEXT_PUBLIC_AGENT_CREDIT_COST ?? "150");
  const [planAllowsPrivate, setPlanAllowsPrivate] = useState(false);
  const [planAllowsVoiceSelect, setPlanAllowsVoiceSelect] = useState(false);

  const [agentName, setAgentName] = useState("");
  const [agentConcept, setAgentConcept] = useState("");
  const [agentPersonality, setAgentPersonality] = useState("");
  const [speakingStyle, setSpeakingStyle] = useState("");
  const [appearance, setAppearance] = useState("");
  const [introLine, setIntroLine] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [aiAssisting, setAiAssisting] = useState(false);
  // AI Assist로 받은 전체 spec — 사용자가 필드를 수정하면 null로 리셋
  const [assistSpec, setAssistSpec] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatusResponse | null>(null);
  const [createdAgent, setCreatedAgent] = useState<Agent | null>(null);
  const [pipelineStep, setPipelineStep] = useState<AgentPipelineStep>("queued");
  const generatorPhaseStartRef = useRef<number | null>(null);

  // Voice selection
  const { voices, loading: voicesLoading, loadingMore: voicesLoadingMore } = useVoices();
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [voiceGenderFilter, setVoiceGenderFilter] = useState("");
  const [voiceAccentFilter, setVoiceAccentFilter] = useState("");
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Derived: unique accents for filter dropdown
  const voiceAccents = Array.from(
    new Set(voices.map((v) => v.accent).filter((a): a is string => !!a))
  ).sort();

  const [visibleVoiceCount, setVisibleVoiceCount] = useState(200);

  // Derived: filtered voices based on search + filters
  const filteredVoices = voices.filter((v) => {
    const q = voiceSearch.toLowerCase();
    if (q) {
      const haystack = `${v.name} ${v.gender ?? ""} ${v.accent ?? ""} ${v.age ?? ""} ${v.description ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (voiceGenderFilter && v.gender !== voiceGenderFilter) return false;
    if (voiceAccentFilter && v.accent !== voiceAccentFilter) return false;
    return true;
  });
  const displayedVoices = filteredVoices.slice(0, visibleVoiceCount);

  const { fetchWithAuth } = useFetchWithAuth();
  const { addJob, jobs } = useJobQueue();

  // Resume an in-progress agent job on mount
  useEffect(() => {
    if (jobId || createdAgent) return;
    const activeAgentJob = jobs.find(
      (j) => j.kind === "agent" && (j.status === "queued" || j.status === "processing")
    );
    if (activeAgentJob) {
      setJobId(activeAgentJob.id);
      if (activeAgentJob.name) setAgentName(activeAgentJob.name);
      // Immediately restore pipeline step from current progress
      const progress = activeAgentJob.progress ?? 0;
      if (activeAgentJob.status === "queued") {
        setPipelineStep("queued");
      } else if (progress < 40) {
        // Generator phase — skip time interpolation, show latest plausible step
        setPipelineStep("creating_avatar");
        generatorPhaseStartRef.current = Date.now() - AVATAR_SEC * 1000;
      } else if (progress < 70) {
        setPipelineStep("uploading");
      } else if (progress < 100) {
        setPipelineStep("saving");
      } else {
        setPipelineStep("done");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent("/agents/create")}`);
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (user?.id) {
      void trackEvent("page_view", { page: "agents_create" });
    }
  }, [user?.id]);

  function playVoicePreview(voiceId: string, previewUrl: string | null) {
    if (!previewUrl) return;
    if (playingVoiceId === voiceId && previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
      setPlayingVoiceId(null);
      return;
    }
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
    }
    const audio = new Audio(previewUrl);
    previewAudioRef.current = audio;
    setPlayingVoiceId(voiceId);
    audio.play().catch(() => {});
    audio.onended = () => {
      setPlayingVoiceId(null);
      previewAudioRef.current = null;
    };
  }

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth("/api/subscription/plan", { cache: "no-store" });
        const payload = (await res.json()) as { plan?: { canCreatePrivateAgent?: boolean; canSelectVoiceManually?: boolean }; error?: string };
        if (cancelled) return;
        setPlanAllowsPrivate(payload.plan?.canCreatePrivateAgent ?? false);
        setPlanAllowsVoiceSelect(payload.plan?.canSelectVoiceManually ?? false);
      } catch {
        if (!cancelled) {
          setPlanAllowsPrivate(false);
          setPlanAllowsVoiceSelect(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, fetchWithAuth]);

  useEffect(() => {
    if (!jobId || !user?.id) return;
    let cancelled = false;
    let timeoutId: number | null = null;

    async function poll() {
      if (cancelled) return;
      try {
        const res = await fetchWithAuth(`/api/jobs/${jobId}`, { method: "GET" });
        const payload = (await res.json()) as JobStatusResponse;
        if (!res.ok) {
          throw new Error(payload.error || "Failed to fetch job");
        }
        if (!cancelled) {
          setJobStatus(payload);

          // Map server progress → pipeline step with time-based interpolation
          const progress = payload.job?.progress ?? 0;
          const serverStatus = payload.job?.status;

          if (serverStatus === "queued") {
            setPipelineStep("queued");
          } else if (progress <= 10) {
            // Worker just started (validation phase) — begin generator interpolation
            if (!generatorPhaseStartRef.current) generatorPhaseStartRef.current = Date.now();
            const elapsed = (Date.now() - generatorPhaseStartRef.current) / 1000;
            if (elapsed < SPEC_SEC) setPipelineStep("generating_spec");
            else if (elapsed < AVATAR_SEC) setPipelineStep("creating_avatar");
            else setPipelineStep("selecting_voice");
          } else if (progress < 70) {
            // Generator done (40), uploading assets
            setPipelineStep("uploading");
            generatorPhaseStartRef.current = null;
          } else if (progress < 100) {
            // Saving agent to DB (70-90)
            setPipelineStep("saving");
          } else {
            setPipelineStep("done");
          }
        }
        const status = payload.job?.status;
        if (status !== "succeeded" && status !== "failed") {
          timeoutId = window.setTimeout(poll, 2000);
          return;
        }
        if (status === "failed") {
          setError(payload.job?.error ?? "Failed to create agent");
          void trackEvent("agent_create_fail", { message: payload.job?.error ?? null });
          setJobId(null);
          setJobStatus(null);
          setPipelineStep("queued");
          generatorPhaseStartRef.current = null;
          return;
        }
        const agentId = extractAgentIdFromResult(payload.job?.result);
        if (agentId) {
          try {
            const listRes = await fetchWithAuth("/api/agents", { method: "GET", cache: "no-store" });
            const listPayload = (await listRes.json()) as { agents?: Agent[] };
            if (listRes.ok && Array.isArray(listPayload.agents)) {
              const found = listPayload.agents.find((a) => a.id === agentId) ?? null;
              if (!cancelled) setCreatedAgent(found);
            }
          } catch {
            if (!cancelled) setCreatedAgent({ id: agentId, name: agentName });
          }
          void trackEvent("agent_create_success", { agentId });
        }
        setPipelineStep("done");
        generatorPhaseStartRef.current = null;
        setJobId(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to fetch job");
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [jobId, user?.id, fetchWithAuth, agentName]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white text-zinc-900 p-6 lg-pl-sidebar">
        <SiteHeader />
        <div className="max-w-xl mx-auto py-10">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="h-dvh overflow-x-hidden overflow-y-auto relative lg-pl-sidebar">
      {/* Animated background blobs */}

      <SiteHeader />

      <PageContainer maxWidth="md" className="space-y-5 sm:space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="flex justify-center mb-2 sm:mb-4">
            <div
              className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center shadow-lg"
              style={{ background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)" }}
            >
              <span className="text-2xl sm:text-3xl">✨</span>
            </div>
          </div>
          <h1 className="text-2xl sm:text-4xl font-bold text-gray-800 mb-1 sm:mb-2">{t("pageTitle")}</h1>
          <p className="text-sm sm:text-base text-gray-600">{t("pageSubtitle")}</p>
          <div className="mt-3 sm:mt-5 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-2xl border border-zinc-700/70 bg-zinc-900/70 p-1.5 backdrop-blur-xl">
              <Link
                href="/series/create"
                className="px-4 py-2 rounded-xl text-sm font-semibold text-zinc-200 hover:bg-[#A4F4CF]/20 transition-colors"
              >
                {t("createSeriesTab")}
              </Link>
              <Link
                href="/agents/create"
                className="px-4 py-2 rounded-xl text-sm font-semibold shadow-lg shadow-emerald-500/30"
                style={{ background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#006949" }}
              >
                {t("createAgentTab")}
              </Link>
            </div>
          </div>

          {/* Creation language selector */}
          <div className="mt-3 flex items-center justify-center gap-2 text-sm text-zinc-400">
            <span>🌐 {tc("creationLanguage")}:</span>
            <select
              value={creationLanguage}
              onChange={async (e) => {
                await updateLanguageSettings({ creationLanguage: e.target.value as Locale });
              }}
              className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-2 py-1 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
            >
              {SUPPORTED_LOCALES.map((loc) => (
                <option key={loc} value={loc}>
                  {LOCALE_LABELS[loc]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {createdAgent ? (
            <div className="rounded-2xl overflow-hidden border border-white/10 shadow-2xl" style={{ background: "rgba(15,20,25,0.92)", backdropFilter: "blur(20px)" }}>
              {/* Hero image */}
              <Link
                href={`/agents/${encodeURIComponent(createdAgent.id)}`}
                className="block relative group"
              >
                {createdAgent.image_url ? (
                  <div className="relative h-[28rem] w-full overflow-hidden">
                    <img
                      src={createdAgent.image_url}
                      alt={createdAgent.name}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0f1419] via-[#0f1419]/30 to-transparent" />
                  </div>
                ) : (
                  <div className="h-40 w-full bg-gradient-to-br from-emerald-900/40 to-zinc-900" />
                )}
                {/* Success badge */}
                <div
                  className="absolute top-4 left-4 px-3 py-1 rounded-full text-xs font-semibold backdrop-blur-sm border border-emerald-400/30"
                  style={{ background: "rgba(16,185,129,0.25)", color: "#A4F4CF" }}
                >
                  ✓ {t("created")}
                </div>
                {/* Name overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <div className="text-[10px] uppercase tracking-widest text-emerald-400 mb-1">Agent</div>
                  <div className="text-2xl font-bold text-white">{createdAgent.name}</div>
                </div>
              </Link>

              {/* Content */}
              <div className="p-5 space-y-4">
                {createdAgent.intro_line ? (
                  <p className="text-base text-zinc-200 italic leading-relaxed">
                    &ldquo;{createdAgent.intro_line}&rdquo;
                  </p>
                ) : null}
                {createdAgent.personality ? (
                  <p className="text-sm text-zinc-500 line-clamp-2 leading-relaxed">
                    {createdAgent.personality.slice(0, 160)}
                  </p>
                ) : null}

                {/* Action buttons */}
                <div className="grid grid-cols-3 gap-2">
                  <Link
                    href={`/agents/${encodeURIComponent(createdAgent.id)}`}
                    className="flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-semibold transition-all hover:brightness-110 active:scale-95"
                    style={{ background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#002e1f" }}
                  >
                    {t("viewAgent")}
                  </Link>
                  <Link
                    href="/series/create"
                    className="flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-semibold border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10 transition-all active:scale-95"
                  >
                    {t("useInSeriesBtn")}
                  </Link>
                  <button
                    type="button"
                    className="flex items-center justify-center px-4 py-2.5 rounded-xl text-sm font-semibold border border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 transition-all active:scale-95"
                    onClick={() => {
                      setCreatedAgent(null);
                      setError(null);
                      setAgentName("");
                      setAgentConcept("");
                      setAgentPersonality("");
                      setSpeakingStyle("");
                      setAppearance("");
                      setIntroLine("");
                      setJobId(null);
                      setJobStatus(null);
                      setPipelineStep("queued");
                      setSelectedVoiceId("");
                    }}
                  >
                    {t("createAnother")}
                  </button>
                </div>
              </div>
            </div>
        ) : jobId ? (
            <div className="max-w-md mx-auto rounded-2xl backdrop-blur-xl bg-white/70 border border-emerald-400/40 shadow-xl p-8 flex flex-col items-center">
              <h2 className="text-xl font-bold text-gray-800 mb-6">{t("creatingAgent")}</h2>
              <div className="space-y-3 w-fit">
                {AGENT_PIPELINE_STEPS.map((ps) => {
                  const currentIdx = AGENT_PIPELINE_STEPS.findIndex((s) => s.key === pipelineStep);
                  const thisIdx = AGENT_PIPELINE_STEPS.findIndex((s) => s.key === ps.key);
                  const isActive = ps.key === pipelineStep && ps.key !== "done";
                  const isDone = thisIdx < currentIdx || pipelineStep === "done";

                  return (
                    <div key={ps.key} className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0">
                        {isDone ? (
                          <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center">
                            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                        ) : isActive ? (
                          <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center">
                            <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                          </div>
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center">
                            <div className="w-2 h-2 rounded-full bg-gray-300" />
                          </div>
                        )}
                      </div>
                      <span
                        className={`text-sm font-medium ${
                          isDone
                            ? "text-emerald-600"
                            : isActive
                              ? "text-gray-800"
                              : "text-gray-400"
                        }`}
                      >
                        {t(ps.labelKey)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
        ) : (
          <div className="space-y-5 sm:space-y-6">
              {/* Basic Info Card */}
              <div className="rounded-2xl backdrop-blur-xl bg-white/70 border border-white/40 shadow-xl overflow-hidden">
                <div className="px-6 pt-6 pb-2 flex items-start justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-800">{t("basicInfo")}</h2>
                    <p className="text-sm text-gray-500 mt-1">{t("basicInfoDesc")}</p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 h-9 px-4 rounded-xl text-xs font-semibold shadow-md shadow-emerald-500/20 hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 flex items-center gap-1.5 cursor-pointer"
                    style={{ background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#006949" }}
                    disabled={aiAssisting || (!agentConcept.trim() && !agentPersonality.trim())}
                    onClick={async () => {
                      setAiAssisting(true);
                      try {
                        const res = await fetchWithAuth("/api/agents/assist", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            name: agentName.trim() || undefined,
                            concept: agentConcept.trim() || undefined,
                            personality: agentPersonality.trim() || undefined,
                            speaking_style: speakingStyle.trim() || undefined,
                            appearance: appearance.trim() || undefined,
                          }),
                        });
                        const data = (await res.json()) as { ok?: boolean; result?: Record<string, string>; error?: string };
                        if (res.status === 429) {
                          setError(data.error ?? "AI Assist rate limit exceeded. Try again later.");
                        } else if (res.ok && data.result) {
                          if (data.result.name && !agentName.trim()) setAgentName(data.result.name.slice(0, 50));
                          if (data.result.concept) setAgentConcept(data.result.concept.slice(0, 700));
                          if (data.result.personality) setAgentPersonality(data.result.personality.slice(0, 700));
                          if (data.result.speaking_style) setSpeakingStyle(data.result.speaking_style.slice(0, 500));
                          if (data.result.appearance) setAppearance(data.result.appearance.slice(0, 700));
                          if (data.result.intro_script) setIntroLine(data.result.intro_script.slice(0, 300));
                          setAssistSpec(data.result);
                        }
                      } catch { /* ignore */ }
                      finally { setAiAssisting(false); }
                    }}
                  >
                    {aiAssisting ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-[#006949] border-t-transparent rounded-full animate-spin" />
                        {t("enhancing")}
                      </>
                    ) : `✨ ${t("aiAssist")}`}
                  </button>
                </div>
                <div className="px-4 pb-4 sm:px-6 sm:pb-6 space-y-3 sm:space-y-5">
              <div className="space-y-2">
                <label className="block text-base font-semibold text-gray-700">{t("nameLabel")}</label>
                <input
                  className="mt-1 w-full h-12 rounded-xl backdrop-blur-xl bg-white/50 border border-white/40 px-4 outline-none focus:ring-2 focus:ring-[#00BC7D]/50 focus:border-2 focus:border-[#00BC7D] text-gray-800 text-base"
                  value={agentName}
                  onChange={(e) => { if (e.target.value.length <= 50) setAgentName(e.target.value); }}
                  placeholder={t("namePlaceholder")}
                  maxLength={50}
                />
                <div className="flex justify-end">
                  <span className={`text-xs ${agentName.length >= 50 ? "text-red-500" : "text-gray-400"}`}>{agentName.length}/50</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-base font-semibold text-gray-700">
                  {t("conceptLabel")}
                </label>
                <textarea
                  className="mt-1 w-full min-h-16 sm:min-h-24 rounded-xl backdrop-blur-xl bg-white/50 border border-white/40 px-4 py-3 outline-none focus:ring-2 focus:ring-[#00BC7D]/50 focus:border-2 focus:border-[#00BC7D] text-gray-800 text-base resize-none"
                  style={{ fieldSizing: "content" } as React.CSSProperties}
                  value={agentConcept}
                  onChange={(e) => { if (e.target.value.length <= 700) { setAgentConcept(e.target.value); setAssistSpec(null); } }}
                  placeholder={t("conceptPlaceholder")}
                  maxLength={700}
                />
                <div className="flex justify-between">
                  <p className="text-xs text-gray-500">{t("conceptHelp")}</p>
                  <span className={`text-xs ${agentConcept.length >= 700 ? "text-red-500" : "text-gray-400"}`}>{agentConcept.length}/700</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-base font-semibold text-gray-700">
                  {t("personalityLabel")}
                </label>
                <textarea
                  className="mt-1 w-full min-h-16 sm:min-h-24 rounded-xl backdrop-blur-xl bg-white/50 border border-white/40 px-4 py-3 outline-none focus:ring-2 focus:ring-[#00BC7D]/50 focus:border-2 focus:border-[#00BC7D] text-gray-800 text-base resize-none"
                  style={{ fieldSizing: "content" } as React.CSSProperties}
                  value={agentPersonality}
                  onChange={(e) => { if (e.target.value.length <= 700) { setAgentPersonality(e.target.value); setAssistSpec(null); } }}
                  placeholder={t("personalityPlaceholder")}
                  maxLength={700}
                />
                <div className="flex justify-between">
                  <p className="text-xs text-gray-500">{t("personalityHelp")}</p>
                  <span className={`text-xs ${agentPersonality.length >= 700 ? "text-red-500" : "text-gray-400"}`}>{agentPersonality.length}/700</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-base font-semibold text-gray-700">
                  {t("speakingStyleLabel")}
                </label>
                <textarea
                  className="mt-1 w-full min-h-14 sm:min-h-20 rounded-xl backdrop-blur-xl bg-white/50 border border-white/40 px-4 py-3 outline-none focus:ring-2 focus:ring-[#00BC7D]/50 focus:border-2 focus:border-[#00BC7D] text-gray-800 text-base resize-none"
                  style={{ fieldSizing: "content" } as React.CSSProperties}
                  value={speakingStyle}
                  onChange={(e) => { if (e.target.value.length <= 500) { setSpeakingStyle(e.target.value); setAssistSpec(null); } }}
                  placeholder={t("speakingStylePlaceholder")}
                  maxLength={500}
                />
                <div className="flex justify-between">
                  <p className="text-xs text-gray-500">{t("speakingStyleHelp")}</p>
                  <span className={`text-xs ${speakingStyle.length >= 500 ? "text-red-500" : "text-gray-400"}`}>{speakingStyle.length}/500</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-base font-semibold text-gray-700">
                  {t("appearanceLabel")}
                </label>
                <textarea
                  className="mt-1 w-full min-h-14 sm:min-h-20 rounded-xl backdrop-blur-xl bg-white/50 border border-white/40 px-4 py-3 outline-none focus:ring-2 focus:ring-[#00BC7D]/50 focus:border-2 focus:border-[#00BC7D] text-gray-800 text-base resize-none"
                  style={{ fieldSizing: "content" } as React.CSSProperties}
                  value={appearance}
                  onChange={(e) => { if (e.target.value.length <= 700) { setAppearance(e.target.value); setAssistSpec(null); } }}
                  placeholder={t("appearancePlaceholder")}
                  maxLength={700}
                />
                <div className="flex justify-between">
                  <p className="text-xs text-gray-500">{t("appearanceHelp")}</p>
                  <span className={`text-xs ${appearance.length >= 700 ? "text-red-500" : "text-gray-400"}`}>{appearance.length}/700</span>
                </div>
              </div>
              <div className="space-y-2">
                <label className="block text-base font-semibold text-gray-700">
                  {t("introLineLabel")}
                </label>
                <textarea
                  className="mt-1 w-full min-h-14 sm:min-h-20 rounded-xl backdrop-blur-xl bg-white/50 border border-white/40 px-4 py-3 outline-none focus:ring-2 focus:ring-[#00BC7D]/50 focus:border-2 focus:border-[#00BC7D] text-gray-800 text-base resize-none"
                  style={{ fieldSizing: "content" } as React.CSSProperties}
                  value={introLine}
                  onChange={(e) => { if (e.target.value.length <= 300) { setIntroLine(e.target.value); setAssistSpec(null); } }}
                  placeholder={t("introLinePlaceholder")}
                  maxLength={300}
                />
                <div className="flex justify-between">
                  <p className="text-xs text-gray-500">{t("introLineHelp")}</p>
                  <span className={`text-xs ${introLine.length >= 300 ? "text-red-500" : "text-gray-400"}`}>{introLine.length}/300</span>
                </div>
              </div>
                </div>
              </div>
              {/* Voice Selection Card */}
              <div className="rounded-2xl backdrop-blur-xl bg-white/70 border border-white/40 shadow-xl overflow-hidden">
                <div className="px-6 pt-6 pb-2">
                  <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                    <span className="text-emerald-600">🎤</span> {t("voiceSelection")}
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {planAllowsVoiceSelect ? t("voiceSubtitleManual") : t("voiceSubtitleAuto")}
                  </p>
                </div>
                <div className="px-6 pb-6">
                {!planAllowsVoiceSelect ? (
                  <div className="mt-2 rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 px-4 py-3 text-sm text-gray-500">
                    {t("voiceAutoInfo")}
                  </div>
                ) : voicesLoading ? (
                  <div className="mt-2 text-sm text-gray-500">{t("loadingVoices")}</div>
                ) : voices.length > 0 ? (
                  <div className="mt-2 space-y-3">
                    {/* Selected voice badge */}
                    {selectedVoiceId ? (() => {
                      const sel = voices.find((v) => v.voice_id === selectedVoiceId);
                      if (!sel) return null;
                      return (
                        <div className="flex items-center gap-3 rounded-xl border-2 border-emerald-500 bg-emerald-50 px-4 py-3">
                          <div className="w-10 h-10 rounded-full bg-emerald-200 flex items-center justify-center text-emerald-700 font-bold text-lg shrink-0">
                            {sel.gender === "female" ? "♀" : sel.gender === "male" ? "♂" : "◎"}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-gray-800 truncate">{sel.name}</div>
                            <div className="text-xs text-gray-600">
                              {[sel.gender, sel.age, sel.accent].filter(Boolean).join(" · ")}
                              {sel.description ? ` — ${sel.description}` : ""}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {sel.preview_url ? (
                              <button
                                type="button"
                                className="px-3 py-1.5 rounded-lg border border-emerald-300 bg-white text-xs font-medium hover:bg-emerald-100 transition-colors"
                                onClick={() => playVoicePreview(sel.voice_id, sel.preview_url)}
                              >
                                {playingVoiceId === sel.voice_id ? `■ ${t("stopVoice")}` : `▶ ${t("playVoice")}`}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="px-3 py-1.5 rounded-lg border border-red-200 bg-white text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                              onClick={() => setSelectedVoiceId("")}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      );
                    })() : (
                      <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50/30 px-4 py-3 text-sm text-gray-500">
                        {t("voiceAutoSelect")}
                      </div>
                    )}

                    {/* Search + filters */}
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        className="flex-1 min-w-[180px] h-10 rounded-xl backdrop-blur-xl bg-white/50 border border-white/40 px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500/50 text-gray-800 placeholder:text-gray-400"
                        placeholder={t("searchVoices")}
                        value={voiceSearch}
                        onChange={(e) => { setVoiceSearch(e.target.value); setVisibleVoiceCount(200); }}
                      />
                      <select
                        className="h-10 rounded-xl backdrop-blur-xl bg-white/50 border border-white/40 px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500/50 text-gray-800"
                        value={voiceGenderFilter}
                        onChange={(e) => { setVoiceGenderFilter(e.target.value); setVisibleVoiceCount(200); }}
                      >
                        <option value="">{t("allGenders")}</option>
                        <option value="male">{t("male")}</option>
                        <option value="female">{t("female")}</option>
                        <option value="non-binary">{t("nonBinary")}</option>
                      </select>
                      <select
                        className="h-10 rounded-xl backdrop-blur-xl bg-white/50 border border-white/40 px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500/50 text-gray-800"
                        value={voiceAccentFilter}
                        onChange={(e) => { setVoiceAccentFilter(e.target.value); setVisibleVoiceCount(200); }}
                      >
                        <option value="">{t("allAccents")}</option>
                        {voiceAccents.map((a) => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                      </select>
                    </div>

                    {/* Voice grid */}
                    <div className="max-h-[200px] sm:max-h-[320px] overflow-y-auto rounded-xl border border-white/40 bg-white/50">
                      {displayedVoices.length === 0 ? (
                        <div className="p-6 text-center text-sm text-gray-400">{t("noVoicesMatch")}</div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-0 divide-y divide-gray-100">
                          {displayedVoices.map((v) => {
                            const isSelected = selectedVoiceId === v.voice_id;
                            return (
                              <div
                                key={v.voice_id}
                                role="button"
                                tabIndex={0}
                                className={`flex items-center gap-3 px-4 py-3 text-left transition-all w-full ${
                                  isSelected
                                    ? "bg-emerald-50 border-l-2 border-l-emerald-500"
                                    : "hover:bg-emerald-50/50"
                                }`}
                                onClick={() => setSelectedVoiceId(isSelected ? "" : v.voice_id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    setSelectedVoiceId(isSelected ? "" : v.voice_id);
                                  }
                                }}
                              >
                                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                                  isSelected
                                    ? "bg-emerald-500 text-white"
                                    : "bg-emerald-100 text-emerald-600"
                                }`}>
                                  {v.gender === "female" ? "♀" : v.gender === "male" ? "♂" : "◎"}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm font-medium text-gray-800 truncate">{v.name}</div>
                                  <div className="text-xs text-gray-500 truncate">
                                    {[v.accent, v.age].filter(Boolean).join(" · ")}
                                    {v.description ? ` — ${v.description}` : ""}
                                  </div>
                                </div>
                                {v.preview_url ? (
                                  <button
                                    type="button"
                                    className="px-2 py-1 rounded-lg border border-white/40 bg-white/70 text-xs hover:bg-white/90 transition-colors shrink-0"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      playVoicePreview(v.voice_id, v.preview_url);
                                    }}
                                  >
                                    {playingVoiceId === v.voice_id ? "■" : "▶"}
                                  </button>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    {filteredVoices.length > visibleVoiceCount ? (
                      <button
                        type="button"
                        className="w-full py-2 rounded-xl backdrop-blur-xl bg-white/50 border border-white/40 text-sm font-medium text-emerald-700 hover:bg-white/80 transition-colors"
                        onClick={() => setVisibleVoiceCount((c) => c + 500)}
                      >
                        {t("showMore", { count: filteredVoices.length - visibleVoiceCount })}
                      </button>
                    ) : null}
                    <div className="text-xs text-gray-500">
                      {t("showingMatches", { showing: displayedVoices.length, total: filteredVoices.length })} · {voices.length} total voices
                      {voicesLoadingMore ? " · Loading more voices..." : ""}
                    </div>
                  </div>
                ) : (
                  <div className="mt-1 text-sm text-gray-500">{t("noVoicesAvailable")}</div>
                )}
                </div>
              </div>

              {/* Submit Card */}
              <div className="rounded-2xl backdrop-blur-xl bg-white/70 border border-white/40 shadow-xl p-4 sm:p-6 space-y-4">
                {planAllowsPrivate ? (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isPublic}
                      onChange={(e) => setIsPublic(e.target.checked)}
                      className="rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <span className="text-base text-gray-800">
                      {t("publicCheckbox")}
                    </span>
                  </label>
                ) : (
                  <div className="text-base text-gray-700">
                    {t("publicRequired")}
                  </div>
                )}
                {/* Content Policy Notice */}
                <details className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-xs leading-relaxed group">
                  <summary className="flex items-center gap-1.5 font-semibold text-zinc-200 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <span aria-hidden="true">🛡️</span>
                    {t("contentPolicy")}
                    <span className="ml-auto text-zinc-500 text-[10px] group-open:hidden">{t("contentPolicyTap")}</span>
                  </summary>
                  <ul className="mt-2 text-zinc-400 space-y-1 list-disc list-inside">
                    <li>{t("policyRule1")}</li>
                    <li>{t("policyRule2")}</li>
                    <li>{t("policyRule3")}</li>
                    <li>{t("policyRule4")}</li>
                  </ul>
                  <p className="mt-2 text-zinc-500 border-t border-white/5 pt-2">
                    {t("policyFooter")}
                  </p>
                </details>
                <button
                  className="w-full h-14 rounded-xl text-lg font-semibold text-white shadow-lg shadow-emerald-500/30 disabled:opacity-50 cursor-pointer transition-all hover:brightness-110"
                  style={{ background: 'linear-gradient(135deg, #A4F4CF, #7CEDA3)', color: '#006949' }}
                  type="button"
                  disabled={
                    submitting
                    || agentName.trim().length < 2
                    || agentConcept.trim().length < 20
                    || agentPersonality.trim().length < 20
                    || speakingStyle.trim().length < 10
                    || appearance.trim().length < 10
                    || introLine.trim().length < 10
                  }
                  onClick={async () => {
                    setSubmitting(true);
                    setError(null);
                    void trackEvent("agent_create_start", {
                      nameLength: agentName.trim().length,
                      conceptLength: agentConcept.trim().length,
                      personalityLength: agentPersonality.trim().length,
                    });
                    try {
                      // Build pre_spec from user fields — always skip generate_agent_spec
                      const userSpec: Record<string, string> = {
                        ...(assistSpec ?? {}),
                        name: agentName.trim(),
                        concept: agentConcept.trim(),
                        personality: agentPersonality.trim(),
                        speaking_style: speakingStyle.trim(),
                        appearance: appearance.trim(),
                        intro_script: introLine.trim(),
                      };
                      const res = await fetchWithAuth("/api/agents/create-job", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: agentName.trim(),
                          concept: agentConcept.trim(),
                          personality: agentPersonality.trim(),
                          speakingStyle: speakingStyle.trim(),
                          appearance: appearance.trim(),
                          introLine: introLine.trim(),
                          preSpec: userSpec,
                          ...(planAllowsVoiceSelect && selectedVoiceId
                            ? { elevenlabsVoiceId: selectedVoiceId }
                            : voices.length > 0
                              ? {
                                  voiceCandidates: voices.map((v) => ({
                                    id: v.voice_id,
                                    name: v.name,
                                    gender: v.gender ?? null,
                                    age: v.age ?? null,
                                    accent: v.accent ?? null,
                                    desc: (v.description ?? "").slice(0, 40) || null,
                                  })),
                                }
                              : {}),
                          isPublic: planAllowsPrivate ? isPublic : true,
                          language: creationLanguage,
                        }),
                      });
                      const payload = (await res.json()) as CreateJobResponse;
                      if (!res.ok || !payload.jobId) {
                        if (res.status === 402) {
                          router.push("/credits");
                          return;
                        }
                        throw new Error(payload.error || "Failed to create agent");
                      }
                      setJobId(payload.jobId);
                      addJob({ id: payload.jobId, kind: "agent", name: agentName.trim() });
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Failed to create agent");
                      void trackEvent("agent_create_fail", {
                        message: e instanceof Error ? e.message : null,
                      });
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                >
                  {submitting ? t("creating") : `✨ ${t("createAgentBtn", { cost: AGENT_CREDIT_COST })}`}
                </button>
                {error ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <div className="font-semibold">{t("creationFailed")}</div>
                    <div className="mt-1 break-words">{error}</div>
                  </div>
                ) : null}
              </div>
          </div>
        )}
      </PageContainer>
    </div>
  );
}

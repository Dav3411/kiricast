"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { useLocaleSettings } from "@/components/LocaleProvider";
import { SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config";
import { useTranslations } from "next-intl";
import { SiteHeader } from "@/components/SiteHeader";
import { PageContainer } from "@/components/PageContainer";
import { useFetchWithAuth } from "@/hooks/useFetchWithAuth";
import { useVoices } from "@/hooks/useVoices";
import { useJobQueue, type QueuedJob } from "@/components/JobQueueProvider";
import { AgentSelectorPanel } from "@/components/AgentSelectorPanel";
import type { Agent } from "@/types/agent";

type Step = "input" | "generating_doc" | "review" | "creating";

type PipelineSubStep =
  | "creating_agents"  // 제안 에이전트 2명 생성 (proposedAgents 플로우일 때만)
  | "locking"          // 시리즈 생성 + Lock
  | "scenario"         // 4-1 시나리오 생성
  | "script"           // 4-2 스크립트 생성
  | "tts"              // 4-3 TTS 클립 생성
  | "memory"           // 4-4 요약 및 메모리 업데이트
  | "next_options"     // 4-5 다음 화 선택지
  | "done";            // 완료

const PIPELINE_STEPS: { key: PipelineSubStep; labelKey: string }[] = [
  { key: "creating_agents", labelKey: "creatingAgents" },
  { key: "locking", labelKey: "lockingDocuments" },
  { key: "scenario", labelKey: "generatingScenario" },
  { key: "script", labelKey: "writingScript" },
  { key: "tts", labelKey: "generatingTts" },
  { key: "memory", labelKey: "updatingMemory" },
  { key: "next_options", labelKey: "creatingNextChoices" },
  { key: "done", labelKey: "complete" },
];

type CharacterDoc = {
  agent_id: string;
  name: string;
  concept?: string;
  personality: string;
  /** 기존 플로우(에이전트 2명 선택 후 생성) */
  speech_examples?: string[];
  secret?: string;
  /** 오토 제안 플로우(에이전트 생성과 동일 6필드) */
  speaking_style?: string;
  appearance?: string;
  intro_line?: string;
  /** Voice casting (오토 제안 / refine 반영) */
  gender?: string;
  age?: string;
};

/** Generator가 Main Idea 기반으로 제안한 에이전트 (에이전트 생성과 동일 6필드 + voice용 gender/age) */
type ProposedAgentConcept = {
  name: string;
  concept?: string;
  personality: string;
  speaking_style?: string;
  appearance?: string;
  intro_line?: string;
  /** Voice casting: "male" | "female". Generator가 생성. */
  gender?: string;
  /** Voice casting: "young" | "middle_aged" | "old". Generator가 생성. */
  age?: string;
};

type SeriesDocument = {
  characters: CharacterDoc[];
  genre: { main: string; sub: string };
  worldview: { time_period: string; space: string; tone: string };
  main_conflicts: { surface: string; internal: string; relationship: string };
  character_fsm_schema?: { agent1: string[]; agent2: string[] };
};

type ArcDocument = {
  season_goal: string;
  act1_transition_event: string;
  mid_reversal: string;
  climax_conditions: string;
};

export default function SeriesCreatePage() {
  return (
    <Suspense fallback={
      <div className="h-dvh overflow-x-hidden overflow-y-auto relative lg-pl-sidebar">
        <SiteHeader />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 4rem)" }}>
          <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    }>
      <SeriesCreateContent />
    </Suspense>
  );
}

function SeriesCreateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { creationLanguage, updateLanguageSettings } = useLocaleSettings();
  const { fetchWithAuth } = useFetchWithAuth();
  const { addJob, getJob } = useJobQueue();
  const { voices, waitForVoices } = useVoices();
  const t = useTranslations("seriesCreate");
  const tc = useTranslations("common");

  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);

  const [step, setStep] = useState<Step>("input");
  const [agent1Id, setAgent1Id] = useState("");
  const [agent2Id, setAgent2Id] = useState("");
  const [idea, setIdea] = useState("");
  /** Main Idea와 어울리는 에이전트를 자동 제안받을지 여부. true면 에이전트 선택 생략. */
  const [autoGenerateAgents, setAutoGenerateAgents] = useState(false);
  /** Generator가 제안한 에이전트 콘셉트 2개. Lock 시 이걸로 에이전트 생성 후 시리즈/클립 생성. */
  const [proposedAgents, setProposedAgents] = useState<ProposedAgentConcept[] | null>(null);
  /** Pro+ 플랜: 오토 서제스트 에이전트 생성 시 public 여부 선택 가능. */
  const [planAllowsPrivate, setPlanAllowsPrivate] = useState(false);
  /** 오토 서제스트 에이전트를 public으로 생성할지 (Pro+만 선택 가능, 기본 true). */
  const [proposedAgentsIsPublic, setProposedAgentsIsPublic] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 2: Documents
  const [seriesTitle, setSeriesTitle] = useState("");
  const [seriesDoc, setSeriesDoc] = useState<SeriesDocument | null>(null);
  const [arcDoc, setArcDoc] = useState<ArcDocument | null>(null);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [refining, setRefining] = useState(false);

  // Job polling refs
  const genJobPollRef = useRef<number | null>(null);
  const refineJobPollRef = useRef<number | null>(null);

  // Step 4: Creating — pipeline sub-step tracking
  const [locking, setLocking] = useState(false);
  const [pipelineSubStep, setPipelineSubStep] = useState<PipelineSubStep>("locking");
  const [createdSeriesId, setCreatedSeriesId] = useState<string | null>(null);

  const CLIP_CREDIT_COST = Number(process.env.NEXT_PUBLIC_CLIP_CREDIT_COST ?? "100") || 100;
  const AGENT_CREDIT_COST = Number(process.env.NEXT_PUBLIC_AGENT_CREDIT_COST ?? "150") || 150;
  const confirmCredits = proposedAgents && proposedAgents.length >= 2
    ? CLIP_CREDIT_COST + 2 * AGENT_CREDIT_COST
    : CLIP_CREDIT_COST;

  // Derived agent categories (same pattern as create clip page)
  const userAgents = useMemo(() => allAgents.filter((a) => a.source === "user"), [allAgents]);
  const myAgents = useMemo(() => userAgents.filter((a) => !!a.mine), [userAgents]);
  const subscribedAgents = useMemo(() => userAgents.filter((a) => a.is_subscribed && !a.mine), [userAgents]);
  const communityAgents = useMemo(() => userAgents.filter((a) => !a.mine), [userAgents]);
  const selectedAgent1 = useMemo(() => allAgents.find((a) => a.id === agent1Id) ?? null, [allAgents, agent1Id]);
  const selectedAgent2 = useMemo(() => allAgents.find((a) => a.id === agent2Id) ?? null, [allAgents, agent2Id]);

  // Persist series creation state to localStorage so it survives page navigation
  // Keys are scoped per user to avoid cross-account leaks
  const uid = user?.id ?? "";
  const ACTIVE_KEY = uid ? `kiricast_series_create_active_${uid}` : "";
  const STORAGE_KEY = uid ? `kiricast_series_create_state_${uid}` : "";
  const DISCARDED_KEY = uid ? `kiricast_series_create_discarded_${uid}` : "";
  // Clean up legacy (non-scoped) keys from before per-user migration
  useEffect(() => {
    localStorage.removeItem("kiricast_series_create_active");
    localStorage.removeItem("kiricast_series_create_state");
  }, []);
  useEffect(() => {
    if (!ACTIVE_KEY) return;
    if (step === "input" && !seriesDoc && !generating) {
      localStorage.removeItem(ACTIVE_KEY);
      if (STORAGE_KEY) localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(ACTIVE_KEY, step);
      // Save full state when on review step
      if (step === "review" && seriesDoc && arcDoc) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          step, agent1Id, agent2Id, idea, seriesTitle, seriesDoc, arcDoc,
          autoGenerateAgents: autoGenerateAgents || undefined,
          proposedAgents: proposedAgents ?? undefined,
          proposedAgentsIsPublic,
        }));
      }
    }
    window.dispatchEvent(new Event("kiricast_series_create_change"));
  }, [step, seriesDoc, arcDoc, generating, agent1Id, agent2Id, idea, seriesTitle, autoGenerateAgents, proposedAgents, proposedAgentsIsPublic, ACTIVE_KEY, STORAGE_KEY]);

  // Redirect if not logged in
  useEffect(() => {
    if (!authLoading && !user) router.push("/login");
  }, [authLoading, user, router]);

  // Load agents
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth("/api/agents", { method: "GET", cache: "no-store" });
        const payload = (await res.json()) as { agents?: Agent[]; error?: string };
        if (!res.ok) throw new Error(payload.error || "Failed to load agents");
        if (!cancelled) setAllAgents(Array.isArray(payload.agents) ? payload.agents : []);
      } catch {
        // silently fail — agents list will be empty
      } finally {
        if (!cancelled) setAgentsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, fetchWithAuth]);

  // Plan: Pro+ can choose public/private for auto-suggest agents
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth("/api/subscription/plan", { cache: "no-store" });
        const payload = (await res.json()) as { plan?: { canCreatePrivateAgent?: boolean }; error?: string };
        if (!cancelled) setPlanAllowsPrivate(payload.plan?.canCreatePrivateAgent ?? false);
      } catch {
        if (!cancelled) setPlanAllowsPrivate(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, fetchWithAuth]);

  // Poll a job until it completes, then call onResult or onError
  const pollJob = useCallback(
    (jobId: string, onResult: (result: unknown) => void, onError: (msg: string) => void, pollRef: React.MutableRefObject<number | null>) => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(async () => {
        try {
          const res = await fetchWithAuth(`/api/jobs/${jobId}`, { method: "GET" });
          if (!res.ok) return;
          const data = await res.json();
          const job = data.job ?? data;
          if (job.status === "succeeded") {
            if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
            onResult(job.result);
          } else if (job.status === "failed") {
            if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
            onError(job.error ?? "Job failed");
          }
        } catch { /* keep polling */ }
      }, 2000);
    },
    [fetchWithAuth],
  );

  // Cleanup poll intervals on unmount
  useEffect(() => {
    return () => {
      if (genJobPollRef.current) window.clearInterval(genJobPollRef.current);
      if (refineJobPollRef.current) window.clearInterval(refineJobPollRef.current);
    };
  }, []);

  // Restore in-progress series creation automatically.
  // Priority: 1) explicit jobId query param, 2) any active series_doc or EP.1 clip job in queue.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !user) return;

    const restoreFromJob = async (jobId: string) => {
      const res = await fetchWithAuth(`/api/jobs/${encodeURIComponent(jobId)}`, { method: "GET" });
      if (!res.ok) return false;
      const data = await res.json();
      const job = data.job ?? data;
      const payload = job.payload as Record<string, unknown> | null;
      const kind = payload?.kind as string | undefined;

      if (kind === "series_doc") {
        if (payload?.agent1_id) setAgent1Id(payload.agent1_id as string);
        if (payload?.agent2_id) setAgent2Id(payload.agent2_id as string);

        if (job.status === "succeeded" && job.result) {
          const r = job.result as Record<string, unknown>;
          if (r.series_title) setSeriesTitle(r.series_title as string);
          setSeriesDoc(r.series_document as SeriesDocument);
          setArcDoc(r.arc_document as ArcDocument);
          if (Array.isArray(r.proposed_agents) && r.proposed_agents.length >= 2) {
            setProposedAgents(r.proposed_agents as ProposedAgentConcept[]);
          } else {
            setProposedAgents(null);
          }
          setStep("review");
        } else if (job.status === "processing" || job.status === "queued") {
          setStep("generating_doc");
          setGenerating(true);
          pollJob(
            jobId,
            (result) => {
              const r = result as Record<string, unknown>;
              if (r.series_title) setSeriesTitle(r.series_title as string);
              setSeriesDoc(r.series_document as SeriesDocument);
              setArcDoc(r.arc_document as ArcDocument);
              if (Array.isArray(r.proposed_agents) && r.proposed_agents.length >= 2) {
                setProposedAgents(r.proposed_agents as ProposedAgentConcept[]);
              } else {
                setProposedAgents(null);
              }
              setStep("review");
              setGenerating(false);
            },
            (errMsg) => {
              setError(errMsg);
              setStep("input");
              setGenerating(false);
            },
            genJobPollRef,
          );
        } else if (job.status === "failed") {
          setError(job.error ?? "Job failed");
          setStep("input");
        }
        return true;
      }

      // Clip job (EP.1) — show creating pipeline step
      const seriesId = (payload?.series_id as string) ?? null;
      if (seriesId) setCreatedSeriesId(seriesId);

      if (job.status === "succeeded") {
        if (seriesId) router.push(`/series/${encodeURIComponent(seriesId)}`);
        return true;
      } else if (job.status === "processing" || job.status === "queued") {
        setStep("creating");
        setLocking(true);
        // 복귀 직후 현재 progress 즉시 반영 (첫 폴링까지 5초 대기 방지)
        const initProgress = job.progress ?? 0;
        if (initProgress <= 10) setPipelineSubStep("scenario");
        else if (initProgress < 70) setPipelineSubStep("tts");
        else if (initProgress < 85) setPipelineSubStep("memory");
        else if (initProgress < 100) setPipelineSubStep("next_options");
        else setPipelineSubStep("done");
        const ep1PollJob = async () => {
          const maxPolls = 120;
          // 시간 기반 보간: 제너레이터 구간(progress 10→40)은 서버가 중간값을 안 보내므로 시간으로 추정
          let genPhaseStart: number | null = initProgress <= 10 ? Date.now() : null;
          const GEN_SCENARIO = 12;
          const GEN_SCRIPT = 25;
          for (let i = 0; i < maxPolls; i++) {
            await new Promise((r) => setTimeout(r, 5000));
            try {
              const statusRes = await fetchWithAuth(`/api/jobs/${encodeURIComponent(jobId)}`);
              const statusData = await statusRes.json();
              const j = statusData.job ?? statusData;
              const progress = j.progress ?? 0;

              if (progress <= 10) {
                if (!genPhaseStart) genPhaseStart = Date.now();
                const elapsed = (Date.now() - genPhaseStart) / 1000;
                if (elapsed < GEN_SCENARIO) setPipelineSubStep("scenario");
                else if (elapsed < GEN_SCRIPT) setPipelineSubStep("script");
                else setPipelineSubStep("tts");
              } else if (progress < 70) {
                setPipelineSubStep("tts");
                genPhaseStart = null;
              } else if (progress < 85) {
                setPipelineSubStep("memory");
                genPhaseStart = null;
              } else if (progress < 100) {
                setPipelineSubStep("next_options");
                genPhaseStart = null;
              } else {
                setPipelineSubStep("done");
                genPhaseStart = null;
              }

              if (j.status === "done" || j.status === "completed" || j.status === "succeeded") {
                setPipelineSubStep("done");
                if (ACTIVE_KEY) localStorage.removeItem(ACTIVE_KEY);
                if (STORAGE_KEY) localStorage.removeItem(STORAGE_KEY);
                window.dispatchEvent(new Event("kiricast_series_create_change"));
                await new Promise((r) => setTimeout(r, 1000));
                if (seriesId) router.push(`/series/${encodeURIComponent(seriesId)}`);
                return;
              }
              if (j.status === "error" || j.status === "failed") {
                setError("Episode generation failed");
                setStep("input");
                setLocking(false);
                return;
              }
            } catch { /* keep polling */ }
          }
          if (seriesId) router.push(`/series/${encodeURIComponent(seriesId)}`);
        };
        ep1PollJob();
        return true;
      } else if (job.status === "failed") {
        setError(job.error ?? "Episode generation failed");
        setStep("input");
        return true;
      }
      return false;
    };

    restoredRef.current = true;

    (async () => {
      try {
        // 1) Explicit jobId from query param
        const jobIdParam = searchParams.get("jobId");
        if (jobIdParam) {
          await restoreFromJob(jobIdParam);
          return;
        }

        // If user previously clicked Discard, do not restore from localStorage or jobs
        if (DISCARDED_KEY && typeof sessionStorage !== "undefined" && sessionStorage.getItem(DISCARDED_KEY)) {
          sessionStorage.removeItem(DISCARDED_KEY);
          return;
        }

        // 2) Fetch jobs first — 진행 중인 파이프라인이 있으면 review 대신 진행 상태(creating) 화면으로 복원
        const res = await fetchWithAuth("/api/jobs?limit=20", { method: "GET" });
        if (!res.ok) return;
        const data = (await res.json()) as { jobs?: QueuedJob[] };
        const jobs = Array.isArray(data.jobs) ? data.jobs : [];

        // 2a) Active EP.1 clip job → creating + poll (진행 상태 화면)
        const activeEp1Job = jobs.find(
          (j) => j.kind === "clip" && j.episodeNumber === 1 && (j.status === "queued" || j.status === "processing")
        );
        if (activeEp1Job) {
          await restoreFromJob(activeEp1Job.id);
          return;
        }

        // 2b) Active agent jobs (Confirm 후 에이전트 생성 중) → creating_agents 진행 상태로 복원 후 resume
        const allAgentJobs = jobs.filter((j) => j.kind === "agent");
        const hasActiveAgentJob = allAgentJobs.some((j) => j.status === "queued" || j.status === "processing");
        const recentSeriesDocJob = jobs.find((j) => j.kind === "series_doc" && j.status === "succeeded");
        const hasEp1ClipJob = jobs.some((j) => j.kind === "clip" && j.episodeNumber === 1);

        if (allAgentJobs.length >= 2 && hasActiveAgentJob && recentSeriesDocJob && !hasEp1ClipJob) {
          const docRes = await fetchWithAuth(`/api/jobs/${encodeURIComponent(recentSeriesDocJob.id)}`, { method: "GET" });
          if (docRes.ok) {
            const docData = await docRes.json();
            const docJob = docData.job ?? docData;
            const result = docJob.result as Record<string, unknown> | null;
            if (result?.series_document && result?.arc_document) {
              setSeriesTitle((result.series_title as string) ?? "");
              setSeriesDoc(result.series_document as SeriesDocument);
              setArcDoc(result.arc_document as ArcDocument);
              if (Array.isArray(result.proposed_agents) && result.proposed_agents.length >= 2) {
                setProposedAgents(result.proposed_agents as ProposedAgentConcept[]);
              }
              setStep("creating");
              setPipelineSubStep("creating_agents");
              setLocking(true);

              const agentJobIds = allAgentJobs.slice(0, 2).map((j) => j.id);
              const waitForJobSucceeded = (jid: string): Promise<Record<string, unknown>> =>
                new Promise((resolve, reject) => {
                  const interval = setInterval(async () => {
                    try {
                      const r = await fetchWithAuth(`/api/jobs/${encodeURIComponent(jid)}`, { method: "GET" });
                      if (!r.ok) return;
                      const d = await r.json();
                      const j = d.job ?? d;
                      if (j.status === "succeeded") {
                        clearInterval(interval);
                        resolve((j.result as Record<string, unknown>) ?? {});
                      } else if (j.status === "failed") {
                        clearInterval(interval);
                        reject(new Error(j.error ?? "Job failed"));
                      }
                    } catch (e) {
                      clearInterval(interval);
                      reject(e);
                    }
                  }, 2000);
                });

              (async () => {
                try {
                  const results = await Promise.all(agentJobIds.map((jid) => waitForJobSucceeded(jid)));
                  const aid1 = results[0]?.agent_id as string | undefined;
                  const aid2 = results[1]?.agent_id as string | undefined;
                  if (!aid1 || !aid2) {
                    setError("Agent creation did not return IDs");
                    setStep("review");
                    setLocking(false);
                    return;
                  }
                  const sdForTitle = result.series_document as SeriesDocument;
                  const title =
                    (result.series_title as string) ||
                    (sdForTitle.characters?.map((c) => c.name).join(" & ") + " — " + (sdForTitle.genre?.main ?? "")).slice(0, 200);
                  const setting =
                    `${(result.series_document as SeriesDocument).worldview?.time_period ?? ""}, ${(result.series_document as SeriesDocument).worldview?.space ?? ""}`.trim() || "Modern day";
                  const seriesId = crypto.randomUUID();
                  const sd = result.series_document as SeriesDocument;
                  const ep1Title = `${String(title).slice(0, 60)} - EP.1`.slice(0, 60);
                  const ep1Setting = setting.slice(0, 300);
                  const ep1Situation = (sd.main_conflicts?.surface ?? "First encounter").slice(0, 300);
                  const ep1CoreEmotion = (sd.main_conflicts?.internal ?? "").slice(0, 150);
                  const ep1RelationshipState = (sd.main_conflicts?.relationship ?? "").slice(0, 150);
                  const relCtx = sd.main_conflicts?.relationship ?? "";

                  const createRes = await fetchWithAuth("/api/create", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      agent1Id: aid1,
                      agent2Id: aid2,
                      title: ep1Title,
                      setting: ep1Setting,
                      situation: ep1Situation,
                      core_emotion: ep1CoreEmotion,
                      relationship_state: ep1RelationshipState,
                      tone: "",
                      seriesId,
                      episodeNumber: 1,
                      seriesDocument: result.series_document,
                      arcDocument: result.arc_document,
                      relationshipContext: relCtx,
                      totalEpisodes: (sd as { total_episodes?: number }).total_episodes,
                      language: creationLanguage,
                    }),
                  });
                  const createData = await createRes.json();
                  if (!createRes.ok || createData.error) {
                    if (createRes.status === 402) router.push(`/credits?return=${encodeURIComponent("/series/create")}`);
                    else setError(createData.error ?? "Failed to create episode 1");
                    setStep("review");
                    setLocking(false);
                    return;
                  }
                  const seriesRes = await fetchWithAuth("/api/series", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      id: seriesId,
                      title: String(title).slice(0, 200),
                      agent1Id: aid1,
                      agent2Id: aid2,
                      setting: setting.slice(0, 300),
                      relationshipContext: relCtx,
                      seriesDocument: result.series_document,
                      arcDocument: result.arc_document,
                      locked: true,
                      language: creationLanguage,
                    }),
                  });
                  const seriesData = await seriesRes.json();
                  if (!seriesRes.ok || seriesData.error) {
                    setError(seriesData.error ?? "Failed to create series");
                    setLocking(false);
                    return;
                  }
                  setCreatedSeriesId(seriesId);
                  setPipelineSubStep("locking");
                  const clipJobId = createData.jobId as string;
                  addJob({
                    id: clipJobId,
                    kind: "clip",
                    name: String(title).slice(0, 50) || "Series EP.1",
                    seriesId,
                    episodeNumber: 1,
                  });
                  await restoreFromJob(clipJobId);
                } catch (e) {
                  setError(e instanceof Error ? e.message : "Resume failed");
                  setStep("review");
                  setLocking(false);
                }
              })();
              return;
            }
          }
        }

        // 2c) Active series_doc job (generating/refining document)
        const activeSeriesDocJob = jobs.find(
          (j) => j.kind === "series_doc" && (j.status === "queued" || j.status === "processing")
        );
        if (activeSeriesDocJob) {
          await restoreFromJob(activeSeriesDocJob.id);
          return;
        }

        // 2d) Recently succeeded series_doc, no EP.1 clip, no active agent jobs → review
        if (recentSeriesDocJob && !hasEp1ClipJob && !hasActiveAgentJob) {
          await restoreFromJob(recentSeriesDocJob.id);
          return;
        }

        // 3) Restore from localStorage (review step saved state) when no in-progress pipeline
        try {
          const saved = STORAGE_KEY ? localStorage.getItem(STORAGE_KEY) : null;
          if (saved) {
            const s = JSON.parse(saved) as {
              step: Step; agent1Id?: string; agent2Id?: string; idea: string;
              seriesTitle: string; seriesDoc: SeriesDocument; arcDoc: ArcDocument;
              autoGenerateAgents?: boolean; proposedAgents?: ProposedAgentConcept[];
              proposedAgentsIsPublic?: boolean;
            };
            if (s.step === "review" && s.seriesDoc && s.arcDoc) {
              setAgent1Id(s.agent1Id ?? "");
              setAgent2Id(s.agent2Id ?? "");
              setIdea(s.idea);
              setSeriesTitle(s.seriesTitle);
              setSeriesDoc(s.seriesDoc);
              setArcDoc(s.arcDoc);
              setAutoGenerateAgents(!!s.autoGenerateAgents);
              setProposedAgents(Array.isArray(s.proposedAgents) && s.proposedAgents.length >= 2 ? s.proposedAgents : null);
              setProposedAgentsIsPublic(s.proposedAgentsIsPublic !== false);
              setStep("review");
              return;
            }
          }
        } catch { /* ignore parse errors */ }
      } catch { /* ignore restoration errors */ }
    })();
  }, [user, searchParams, fetchWithAuth, pollJob, router, addJob]);

  const handleGenerate = useCallback(async () => {
    const canGenerate = idea.trim() && (autoGenerateAgents || (agent1Id && agent2Id));
    if (!canGenerate) return;
    setGenerating(true);
    setError(null);
    setProposedAgents(null);
    setStep("generating_doc");

    try {
      const res = await fetchWithAuth("/api/series/generate-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(agent1Id ? { agent1Id } : {}),
          ...(agent2Id ? { agent2Id } : {}),
          idea: idea.trim(),
          autoGenerateAgents: autoGenerateAgents || undefined,
          language: creationLanguage,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to generate document");

      const jobId = data.jobId;
      addJob({ id: jobId, kind: "series_doc", name: "Generating series document" });

      // Poll for result
      pollJob(
        jobId,
        (result) => {
          const r = result as Record<string, unknown>;
          if (r.series_title) setSeriesTitle(r.series_title as string);
          setSeriesDoc(r.series_document as SeriesDocument);
          setArcDoc(r.arc_document as ArcDocument);
          if (Array.isArray(r.proposed_agents) && r.proposed_agents.length >= 2) {
            setProposedAgents(r.proposed_agents as ProposedAgentConcept[]);
          } else {
            setProposedAgents(null);
          }
          setStep("review");
          setGenerating(false);
        },
        (errMsg) => {
          setError(errMsg);
          setStep("input");
          setGenerating(false);
        },
        genJobPollRef,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate document");
      setStep("input");
      setGenerating(false);
    }
  }, [agent1Id, agent2Id, idea, autoGenerateAgents, fetchWithAuth, addJob, pollJob]);

  const handleRefine = useCallback(async () => {
    if (!seriesDoc || !arcDoc || !refineInstruction.trim()) return;
    setRefining(true);
    setError(null);

    try {
      const res = await fetchWithAuth("/api/series/refine-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seriesDocument: seriesDoc,
          arcDocument: arcDoc,
          instruction: refineInstruction.trim(),
          seriesTitle: seriesTitle || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to refine document");

      const jobId = data.jobId;
      addJob({ id: jobId, kind: "series_doc", name: "Refining series document" });

      // Poll for result
      pollJob(
        jobId,
        (result) => {
          const r = result as Record<string, unknown>;
          if (r.series_title) setSeriesTitle(r.series_title as string);
          const newSeriesDoc = r.series_document as SeriesDocument;
          setSeriesDoc(newSeriesDoc);
          setArcDoc(r.arc_document as ArcDocument);
          // 오토 서제스트: refine으로 바뀐 캐릭터(이미지/성격 등)를 proposedAgents에 반영
          const chars = newSeriesDoc?.characters ?? [];
          if (chars.length >= 2) {
            setProposedAgents(
              chars.slice(0, 2).map((c) => ({
                name: c.name ?? "",
                concept: c.concept ?? "",
                personality: c.personality ?? "",
                speaking_style: c.speaking_style,
                appearance: c.appearance,
                intro_line: c.intro_line,
                gender: c.gender,
                age: c.age,
              }))
            );
          }
          setRefineInstruction("");
          setRefining(false);
        },
        (errMsg) => {
          setError(errMsg);
          setRefining(false);
        },
        refineJobPollRef,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to refine document");
      setRefining(false);
    }
  }, [seriesDoc, arcDoc, refineInstruction, seriesTitle, fetchWithAuth, addJob, pollJob]);

  const handleLockAndCreate = useCallback(async () => {
    if (!seriesDoc || !arcDoc) return;
    const useProposed = proposedAgents && proposedAgents.length >= 2;
    if (!useProposed && (!agent1Id || !agent2Id)) return;

    setLocking(true);
    setError(null);
    setStep("creating");
    setPipelineSubStep(useProposed ? "creating_agents" : "locking");
    if (STORAGE_KEY) localStorage.removeItem(STORAGE_KEY);

    let effectiveAgent1Id = agent1Id;
    let effectiveAgent2Id = agent2Id;

    try {
      // 제안 에이전트 플로우: 먼저 두 에이전트 생성 후 ID 확보
      if (useProposed && proposedAgents) {
        // 보이스 후보 로딩이 완료될 때까지 최대 10초 대기
        await waitForVoices(10_000);
        const createAgentJob = async (p: ProposedAgentConcept, alreadyUsedVoiceIds?: string[]): Promise<string> => {
          const name = p.name.trim();
          const concept = ((p.concept ?? "").trim() || p.personality).slice(0, 700);
          const personality = p.personality.trim().slice(0, 700);
          const speakingStyle = ((p.speaking_style ?? "").trim() || personality).slice(0, 500);
          const appearance = ((p.appearance ?? "").trim() || concept).slice(0, 700);
          const introLine = ((p.intro_line ?? "").trim() || personality).slice(0, 300);
          const conceptOk = concept.length >= 20 ? concept : `${concept}. Character for series.`.slice(0, 700);
          const personalityOk = personality.length >= 20 ? personality : `${personality} (series character).`.slice(0, 700);
          const speakingStyleOk = speakingStyle.length >= 10 ? speakingStyle : "Natural conversational style matching the character.";
          const appearanceOk = appearance.length >= 10 ? appearance : "Appearance aligned with character concept and personality.";
          const introLineOk = introLine.length >= 10 ? introLine : "Nice to meet you. Looking forward to the story.";
          const genderRaw = (p.gender ?? "").trim().toLowerCase();
          const gender = genderRaw === "male" || genderRaw === "female" ? genderRaw : "";
          const ageRaw = (p.age ?? "").trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
          const age = ["young", "middle_aged", "old"].includes(ageRaw) ? ageRaw : "";
          const preSpec: Record<string, string> = {
            name,
            concept: conceptOk,
            personality: personalityOk,
            speaking_style: speakingStyleOk,
            appearance: appearanceOk,
            intro_script: introLineOk,
            ...(gender ? { gender } : {}),
            ...(age ? { age } : {}),
          };
          const createRes = await fetchWithAuth("/api/agents/create-job", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              concept: conceptOk,
              personality: personalityOk,
              speakingStyle: speakingStyleOk,
              appearance: appearanceOk,
              introLine: introLineOk,
              preSpec,
              ...(voices.length > 0
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
              ...(alreadyUsedVoiceIds && alreadyUsedVoiceIds.length > 0 ? { alreadyUsedVoiceIds } : {}),
              isPublic: planAllowsPrivate ? proposedAgentsIsPublic : true,
            }),
          });
          const createData = await createRes.json();
          if (!createRes.ok || createData.error) throw new Error(createData.error ?? "Failed to create agent job");
          const jobId = createData.jobId as string;
          addJob({ id: jobId, kind: "agent", name: `Creating agent: ${name}` });
          return jobId;
        };

        const job1Id = await createAgentJob(proposedAgents[0]);
        const waitForAgentId = (jid: string): Promise<{ agentId: string; elevenlabsVoiceId: string | null }> =>
          new Promise((resolve, reject) => {
            const interval = setInterval(async () => {
              try {
                const statusRes = await fetchWithAuth(`/api/jobs/${encodeURIComponent(jid)}`, { method: "GET" });
                if (!statusRes.ok) return;
                const statusData = await statusRes.json();
                const job = statusData.job ?? statusData;
                if (job.status === "succeeded") {
                  clearInterval(interval);
                  const aid = (job.result as Record<string, unknown>)?.agent_id as string;
                  const voiceId = (job.result as Record<string, unknown>)?.elevenlabs_voice_id as string | undefined;
                  resolve({ agentId: aid ?? "", elevenlabsVoiceId: voiceId ?? null });
                } else if (job.status === "failed") {
                  clearInterval(interval);
                  reject(new Error(job.error ?? "Agent creation failed"));
                }
              } catch (e) {
                clearInterval(interval);
                reject(e);
              }
            }, 2000);
          });

        const result1 = await waitForAgentId(job1Id);
        effectiveAgent1Id = result1.agentId;
        const job2Id = await createAgentJob(
          proposedAgents[1],
          result1.elevenlabsVoiceId ? [result1.elevenlabsVoiceId] : undefined
        );

        const result2 = await waitForAgentId(job2Id);
        effectiveAgent2Id = result2.agentId;
        if (!effectiveAgent1Id || !effectiveAgent2Id) throw new Error("Agent creation did not return IDs");
        setPipelineSubStep("locking");
      }

      // STEP 3 → Lock: 1화 잡 먼저 생성, 성공 시 시리즈 row insert
      const seriesId = crypto.randomUUID();
      const title = seriesTitle || seriesDoc.characters.map((c) => c.name).join(" & ") + " — " + seriesDoc.genre.main;
      const setting = `${seriesDoc.worldview.time_period}, ${seriesDoc.worldview.space}`;
      setPipelineSubStep("scenario");
      const ep1Title = `${title} - EP.1`.slice(0, 60);
      const ep1Setting = setting.slice(0, 300);
      const ep1Situation = (seriesDoc.main_conflicts.surface || "First encounter").slice(0, 300);
      const ep1CoreEmotion = (seriesDoc.main_conflicts.internal || "").slice(0, 150);
      const ep1RelationshipState = (seriesDoc.main_conflicts.relationship || "").slice(0, 150);

      const jobRes = await fetchWithAuth("/api/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent1Id: effectiveAgent1Id,
          agent2Id: effectiveAgent2Id,
          title: ep1Title,
          setting: ep1Setting,
          situation: ep1Situation,
          core_emotion: ep1CoreEmotion,
          relationship_state: ep1RelationshipState,
          tone: "",
          seriesId,
          episodeNumber: 1,
          seriesDocument: seriesDoc,
          arcDocument: arcDoc,
          relationshipContext: seriesDoc.main_conflicts.relationship,
          totalEpisodes: (seriesDoc as { total_episodes?: number }).total_episodes,
          language: creationLanguage,
        }),
      });
      const jobData = await jobRes.json();
      if (!jobRes.ok || jobData.error) {
        if (jobRes.status === 402) {
          router.push(`/credits?return=${encodeURIComponent(`/series/create`)}`);
          return;
        }
        throw new Error(jobData.error ?? "Failed to create episode 1 job");
      }

      const res = await fetchWithAuth("/api/series", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: seriesId,
          title,
          agent1Id: effectiveAgent1Id,
          agent2Id: effectiveAgent2Id,
          setting,
          relationshipContext: seriesDoc.main_conflicts.relationship,
          seriesDocument: seriesDoc,
          arcDocument: arcDoc,
          locked: true,
          language: creationLanguage,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to create series");

      setCreatedSeriesId(seriesId);
      addJob({
        id: jobData.jobId,
        kind: "clip",
        name: seriesTitle || ep1Title || "Series EP.1",
        seriesId: seriesId,
        episodeNumber: 1,
      });

      // 잡 진행 상황 폴링
      const jobId = jobData.jobId;
      const pollJob = async () => {
        const maxPolls = 120; // 최대 10분 (5초 간격)
        // 제너레이터 구간(progress 10→40)은 단일 API 호출이라 서버가 중간 progress를 보고하지 않음.
        // 시간 기반으로 scenario→script→tts를 순차 전환 (총 ~40초 추정).
        let generatorPhaseStart: number | null = null;
        const SCENARIO_SEC = 12;  // 0~12초: scenario
        const SCRIPT_SEC = 25;    // 12~25초: script
        // 25초 이후: tts (서버가 40으로 갱신될 때까지)

        for (let i = 0; i < maxPolls; i++) {
          await new Promise((r) => setTimeout(r, 5000));
          try {
            const statusRes = await fetchWithAuth(`/api/jobs/${jobId}`);
            const statusData = await statusRes.json();
            const job = statusData.job ?? statusData;
            const progress = job.progress ?? 0;

            // Worker progress: 10=agents loaded, 40=generator done, 70=audio uploaded, 85=transcript, 95=clip+memory
            if (progress <= 10) {
              // 제너레이터 구간: 시간 기반 보간
              if (!generatorPhaseStart) generatorPhaseStart = Date.now();
              const elapsed = (Date.now() - generatorPhaseStart) / 1000;
              if (elapsed < SCENARIO_SEC) setPipelineSubStep("scenario");
              else if (elapsed < SCRIPT_SEC) setPipelineSubStep("script");
              else setPipelineSubStep("tts");
            } else if (progress < 70) {
              // 40~69: 오디오 업로드 중 (제너레이터 완료 직후)
              setPipelineSubStep("tts");
              generatorPhaseStart = null;
            } else if (progress < 85) {
              // 70~84: 메모리 업데이트
              setPipelineSubStep("memory");
              generatorPhaseStart = null;
            } else if (progress < 100) {
              // 85~99: 다음 선택지 생성
              setPipelineSubStep("next_options");
              generatorPhaseStart = null;
            } else {
              setPipelineSubStep("done");
              generatorPhaseStart = null;
            }

            if (job.status === "done" || job.status === "completed" || job.status === "succeeded") {
              setPipelineSubStep("done");
              if (ACTIVE_KEY) localStorage.removeItem(ACTIVE_KEY);
              if (STORAGE_KEY) localStorage.removeItem(STORAGE_KEY);
              window.dispatchEvent(new Event("kiricast_series_create_change"));
              await new Promise((r) => setTimeout(r, 1000));
              router.push(`/series/${encodeURIComponent(seriesId)}`);
              return;
            }
            if (job.status === "error" || job.status === "failed") {
              throw new Error("Episode generation failed");
            }
          } catch {
            // 폴링 실패 시 계속 시도
          }
        }
        // 타임아웃 — 시리즈 페이지로 이동
        router.push(`/series/${encodeURIComponent(seriesId)}`);
      };

      await pollJob();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create series");
      setStep("review");
    } finally {
      setLocking(false);
    }
  }, [seriesDoc, arcDoc, agent1Id, agent2Id, proposedAgents, seriesTitle, voices, waitForVoices, planAllowsPrivate, proposedAgentsIsPublic, fetchWithAuth, addJob, router]);

  if (authLoading || agentsLoading) {
    return (
      <div className="h-dvh overflow-x-hidden overflow-y-auto relative lg-pl-sidebar">
        <SiteHeader />
        <div className="flex items-center justify-center" style={{ minHeight: "calc(100vh - 4rem)" }}>
          <div className="w-6 h-6 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh overflow-x-hidden overflow-y-auto relative lg-pl-sidebar">
      <SiteHeader />

      <PageContainer maxWidth="md" className="space-y-5 sm:space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="flex justify-center mb-2 sm:mb-4">
            <div
              className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center shadow-lg"
              style={{ background: "linear-gradient(135deg, #C4B5FD, #A78BFA)" }}
            >
              <span className="text-2xl sm:text-3xl">🎬</span>
            </div>
          </div>
          <h1 className="text-2xl sm:text-4xl font-bold text-gray-800 mb-1 sm:mb-2">{t("pageTitle")}</h1>
          <p className="text-sm sm:text-base text-gray-600">{t("pageSubtitle")}</p>
          <div className="mt-3 sm:mt-5 flex justify-center">
            <div className="inline-flex items-center gap-2 rounded-2xl border border-zinc-700/70 bg-zinc-900/70 p-1.5 backdrop-blur-xl">
              <Link
                href="/series/create"
                className="px-4 py-2 rounded-xl text-sm font-semibold shadow-lg shadow-purple-500/30"
                style={{ background: "linear-gradient(135deg, #C4B5FD, #A78BFA)", color: "#3B0764" }}
              >
                {t("createSeriesTab")}
              </Link>
              <Link
                href="/agents/create"
                className="px-4 py-2 rounded-xl text-sm font-semibold text-zinc-200 hover:bg-purple-400/20 transition-colors"
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
              className="bg-zinc-800/60 border border-zinc-700 rounded-lg px-2 py-1 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-purple-500 cursor-pointer"
            >
              {SUPPORTED_LOCALES.map((loc) => (
                <option key={loc} value={loc}>
                  {LOCALE_LABELS[loc]}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Step indicator — matches pipeline doc STEP 1~4 */}
        {(() => {
          const steps: { key: Step; num: string; label: string }[] = [
            { key: "input", num: "1", label: t("stepUserInput") },
            { key: "generating_doc", num: "2", label: t("stepSeriesDocument") },
            { key: "review", num: "3", label: t("stepVerifyLock") },
            { key: "creating", num: "4", label: t("stepEpisodeGeneration") },
          ];
          const currentIdx = steps.findIndex((s) => s.key === step);
          return (
            <div className="flex items-center justify-center gap-1.5">
              {steps.map((s, i) => (
                <div key={s.key} className="flex items-center gap-1.5">
                  <div
                    className={`h-7 w-7 sm:h-8 sm:w-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                      i === currentIdx
                        ? "bg-purple-600 text-white"
                        : i < currentIdx
                          ? "bg-purple-200 text-purple-800"
                          : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {s.num}
                  </div>
                  {i < steps.length - 1 && <div className="w-4 sm:w-6 h-0.5 bg-gray-300" />}
                </div>
              ))}
              <div className="ml-2 text-sm text-gray-500">
                {steps[currentIdx]?.label}
              </div>
            </div>
          );
        })()}

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* ========== STEP 2: Generating document (loading state) ========== */}
        {step === "generating_doc" && (
          <div className="rounded-2xl backdrop-blur-xl bg-white/70 border border-white/40 shadow-xl p-4 sm:p-6">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center shrink-0">
                <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
              </div>
              <div>
                <p className="text-lg font-semibold text-gray-800">{t("generatingDocument")}</p>
                <p className="text-sm text-gray-500 mt-0.5">{t("generatingSubtitle")}</p>
              </div>
            </div>
          </div>
        )}

        {/* ========== STEP 1: Agent selection + Idea ========== */}
        {step === "input" && (
          <>
            <div
              className={`grid grid-cols-1 md:grid-cols-2 gap-4 transition-opacity ${autoGenerateAgents ? "pointer-events-none opacity-50" : ""}`}
              aria-disabled={autoGenerateAgents}
            >
              <AgentSelectorPanel
                label={t("character1")}
                selectedAgentId={agent1Id}
                onSelectAgent={(id) => setAgent1Id((prev) => (prev === id ? "" : id))}
                myAgents={myAgents}
                subscribedAgents={subscribedAgents}
                communityAgents={communityAgents}
                selectedAgent={selectedAgent1}
                variant="purple"
              />
              <AgentSelectorPanel
                label={t("character2")}
                selectedAgentId={agent2Id}
                onSelectAgent={(id) => setAgent2Id((prev) => (prev === id ? "" : id))}
                myAgents={myAgents}
                subscribedAgents={subscribedAgents}
                communityAgents={communityAgents}
                selectedAgent={selectedAgent2}
                variant="purple"
              />
            </div>

            <div className="rounded-2xl backdrop-blur-xl bg-white/70 border border-white/40 shadow-xl p-4 sm:p-6">
              {autoGenerateAgents ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium shadow-md"
                    style={{ background: "linear-gradient(135deg, #C4B5FD, #A78BFA)", color: "#3B0764" }}
                  >
                    <span className="w-2 h-2 rounded-full bg-white/90" aria-hidden />
                    {t("autoSuggestOn")}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAutoGenerateAgents(false)}
                    className="text-sm font-medium text-purple-600 hover:text-purple-700 hover:underline"
                  >
                    {t("chooseManually")}
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setAgent1Id("");
                      setAgent2Id("");
                      setAutoGenerateAgents(true);
                    }}
                    className="rounded-xl px-4 py-2 text-sm font-semibold shadow-md shadow-purple-500/25 cursor-pointer transition-all hover:brightness-110 shrink-0"
                    style={{ background: "linear-gradient(135deg, #C4B5FD, #A78BFA)", color: "#3B0764" }}
                  >
                    {t("suggestAgents")}
                  </button>
                  <span className="text-sm text-gray-500">
                    {t("suggestAgentsDesc")}
                  </span>
                </div>
              )}
            </div>

            <div className="rounded-2xl backdrop-blur-xl bg-white/70 border border-white/40 shadow-xl p-4 sm:p-6 space-y-6">
              {/* Idea input */}
              <div className="space-y-2">
                <label className="block text-base font-semibold text-gray-700">{t("mainIdea")}</label>
                <textarea
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  placeholder={t("mainIdeaPlaceholder")}
                  maxLength={1000}
                  className="w-full min-h-24 rounded-xl backdrop-blur-xl bg-white/50 border border-white/40 px-4 py-3 outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-2 focus:border-purple-500 text-gray-800 text-base resize-none"
                  style={{ fieldSizing: "content" } as React.CSSProperties}
                />
                <div className="flex justify-end">
                  <span className={`text-xs ${idea.length >= 1000 ? "text-red-500" : "text-gray-400"}`}>{idea.length}/1000</span>
                </div>
              </div>

              <details className="rounded-xl border border-white/20 bg-white/[0.04] px-4 py-3 text-xs leading-relaxed group">
                <summary className="flex items-center gap-1.5 font-semibold text-gray-600 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <span aria-hidden="true">🛡️</span>
                  {t("contentPolicy")}
                  <span className="ml-auto text-gray-400 text-[10px] group-open:hidden">{t("contentPolicyTap")}</span>
                </summary>
                <ul className="mt-2 text-gray-500 space-y-1 list-disc list-inside">
                  <li>{t("policyRule1")}</li>
                  <li>{t("policyRule2")}</li>
                  <li>{t("policyRule3")}</li>
                  <li>{t("policyRule4")}</li>
                </ul>
                <p className="mt-2 text-gray-400 border-t border-white/10 pt-2">
                  {t("policyFooter")}
                </p>
              </details>

              <button
                onClick={handleGenerate}
                disabled={(autoGenerateAgents ? !idea.trim() : !agent1Id || !agent2Id || !idea.trim()) || generating}
                className="w-full h-14 rounded-xl text-lg font-semibold shadow-lg shadow-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all hover:brightness-110"
                style={{ background: "linear-gradient(135deg, #C4B5FD, #A78BFA)", color: "#3B0764" }}
              >
                {generating ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 border-2 border-purple-900 border-t-transparent rounded-full animate-spin" />
                    {t("generatingBtn")}
                  </span>
                ) : t("generateDocBtn")}
              </button>
            </div>
          </>
        )}

        {/* ========== STEP 2: Review documents ========== */}
        {step === "review" && seriesDoc && arcDoc && (
          <div className="space-y-4">
            {/* Series Title */}
            {seriesTitle && (
              <div className="rounded-2xl backdrop-blur-xl bg-purple-50/70 border border-white/40 shadow-xl p-6 text-center">
                <h2 className="text-3xl font-extrabold text-purple-900">{seriesTitle}</h2>
              </div>
            )}

            {/* Genre & Worldview */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl backdrop-blur-xl bg-white/70 border border-white/40 shadow-xl p-4 sm:p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-3">{t("genre")}</h2>
                <div className="space-y-1 text-sm text-gray-600">
                  <p><span className="font-medium text-gray-700">{t("mainGenre")}</span> {seriesDoc.genre.main}</p>
                  <p><span className="font-medium text-gray-700">{t("subGenre")}</span> {seriesDoc.genre.sub}</p>
                </div>
              </div>
              <div className="rounded-2xl backdrop-blur-xl bg-white/70 border border-white/40 shadow-xl p-4 sm:p-6">
                <h2 className="text-xl font-bold text-gray-800 mb-3">{t("worldview")}</h2>
                <div className="space-y-1 text-sm text-gray-600">
                  <p><span className="font-medium text-gray-700">{t("time")}</span> {seriesDoc.worldview.time_period}</p>
                  <p><span className="font-medium text-gray-700">{t("space")}</span> {seriesDoc.worldview.space}</p>
                  <p><span className="font-medium text-gray-700">{t("tone")}</span> {seriesDoc.worldview.tone}</p>
                </div>
              </div>
            </div>

            {/* Conflicts */}
            <div className="rounded-2xl backdrop-blur-xl bg-white/70 border border-white/40 shadow-xl p-4 sm:p-6">
              <h2 className="text-xl font-bold text-gray-800 mb-3">{t("mainConflicts")}</h2>
              <div className="space-y-1.5 text-sm text-gray-600">
                <p><span className="font-medium text-gray-700">{t("surface")}</span> {seriesDoc.main_conflicts.surface}</p>
                <p><span className="font-medium text-gray-700">{t("internal")}</span> {seriesDoc.main_conflicts.internal}</p>
                <p><span className="font-medium text-gray-700">{t("relationship")}</span> {seriesDoc.main_conflicts.relationship}</p>
              </div>
            </div>

            {/* Characters */}
            <div className="rounded-2xl backdrop-blur-xl bg-white/70 border border-white/40 shadow-xl p-4 sm:p-6">
              <h2 className="text-2xl font-bold text-gray-800 mb-4">{t("characters")}</h2>
              <div className="space-y-4">
                {seriesDoc.characters.map((char, i) => {
                  const agent = allAgents.find((a) => a.id === char.agent_id);
                  const isSuggested = proposedAgents && proposedAgents.length >= 2 && i < 2;
                  const p = isSuggested ? proposedAgents?.[i] : null;
                  return (
                  <div key={i} className="rounded-xl border border-purple-100 bg-purple-50/30 p-4">
                    <div className="flex items-center gap-3 mb-2">
                      {agent?.image_url ? (
                        <img
                          src={agent.image_url}
                          alt={char.name}
                          className="w-12 h-12 rounded-full object-cover shrink-0 border-2 border-purple-300/50"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center shrink-0 border-2 border-purple-300/50">
                          <span className="text-lg font-bold text-purple-400">{(p?.name ?? char.name).charAt(0)}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="font-semibold text-gray-800 text-lg">{p?.name ?? char.name}</h3>
                        {isSuggested && (
                          <span className="rounded bg-purple-100 text-purple-600 text-xs font-medium px-1.5 py-0.5 shrink-0">{t("suggested")}</span>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1.5 text-sm text-gray-600">
                      {p ? (
                        <>
                          <p><span className="font-medium text-gray-700">{t("settingBackground")}</span> {p.concept || "—"}</p>
                          <p><span className="font-medium text-gray-700">{t("personalityLabel")}</span> {p.personality}</p>
                          <p><span className="font-medium text-gray-700">{t("speakingStyleLabel")}</span> {p.speaking_style || "—"}</p>
                          <p><span className="font-medium text-gray-700">{t("appearanceLabel")}</span> {p.appearance || "—"}</p>
                          <p><span className="font-medium text-gray-700">{t("introLineLabel")}</span> {p.intro_line || "—"}</p>
                        </>
                      ) : (
                        <>
                          {char.concept && <p><span className="font-medium text-gray-700">{t("conceptLabel")}</span> {char.concept}</p>}
                          <p><span className="font-medium text-gray-700">{t("personalityLabel")}</span> {char.personality}</p>
                          {char.secret != null && <p><span className="font-medium text-gray-700">{t("secretLabel")}</span> {char.secret}</p>}
                          {char.speech_examples && char.speech_examples.length > 0 && (
                            <div>
                              <span className="font-medium text-gray-700">{t("speechExamples")}</span>
                              <ul className="mt-1 ml-4 list-disc text-gray-500">
                                {char.speech_examples.map((ex, j) => <li key={j}>&ldquo;{ex}&rdquo;</li>)}
                              </ul>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>

            {/* Character FSM Schema — hidden from user (internal use only) */}

            {/* Arc Document — hidden from user (internal use only) */}

            {/* AI Refine */}
            <div className="rounded-2xl backdrop-blur-xl bg-white/70 border border-white/40 shadow-xl p-4 sm:p-6">
              <h2 className="text-base font-semibold text-gray-700 mb-3">{t("requestChanges")}</h2>
              <div className="flex gap-2 items-end">
                <textarea
                  value={refineInstruction}
                  onChange={(e) => setRefineInstruction(e.target.value)}
                  maxLength={1000}
                  placeholder={t("refinePlaceholder")}
                  className="flex-1 min-h-12 max-h-32 rounded-xl backdrop-blur-xl bg-white/50 border border-white/40 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-purple-500/50 text-gray-800 resize-none"
                  style={{ fieldSizing: "content" } as React.CSSProperties}
                />
                <button
                  onClick={handleRefine}
                  disabled={!refineInstruction.trim() || refining}
                  className="h-12 px-5 rounded-xl text-sm font-semibold shadow-md shadow-purple-500/20 hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 cursor-pointer shrink-0"
                  style={{ background: "linear-gradient(135deg, #C4B5FD, #A78BFA)", color: "#3B0764" }}
                >
                  {refining ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3.5 h-3.5 border-2 border-purple-900 border-t-transparent rounded-full animate-spin" />
                      {t("refining")}
                    </span>
                  ) : t("refine")}
                </button>
              </div>
              <div className="flex justify-end mt-1">
                <span className={`text-xs ${refineInstruction.length >= 1000 ? "text-red-500" : "text-gray-400"}`}>{refineInstruction.length}/1000</span>
              </div>
            </div>

            {/* Actions */}
            {proposedAgents && proposedAgents.length >= 2 && planAllowsPrivate && (
              <label className="flex items-center gap-4 cursor-pointer select-none group">
                <span className="relative flex shrink-0">
                  <input
                    type="checkbox"
                    checked={proposedAgentsIsPublic}
                    onChange={(e) => setProposedAgentsIsPublic(e.target.checked)}
                    className="peer sr-only"
                  />
                  <span
                    className="flex w-7 h-7 rounded-xl border-2 transition-all duration-200 flex items-center justify-center shadow-md peer-focus-visible:ring-2 peer-focus-visible:ring-purple-500 peer-focus-visible:ring-offset-2 group-hover:border-purple-400"
                    style={
                      proposedAgentsIsPublic
                        ? { background: "linear-gradient(135deg, #C4B5FD, #A78BFA)", borderColor: "transparent", boxShadow: "0 4px 14px rgba(167, 139, 250, 0.35)" }
                        : { background: "rgba(255,255,255,0.7)", borderColor: "rgb(216, 180, 254)" }
                    }
                  >
                    {proposedAgentsIsPublic && (
                      <svg className="w-4 h-4 text-[#3B0764]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </span>
                </span>
                <span className="text-sm font-medium text-gray-800 group-hover:text-gray-900">
                  {t("createSuggestedPublic")}
                </span>
              </label>
            )}
            <div className="flex gap-3">
              <button
                onClick={handleLockAndCreate}
                disabled={locking || refining || !((agent1Id && agent2Id) || (proposedAgents && proposedAgents.length >= 2))}
                className="flex-1 h-14 rounded-xl text-lg font-semibold shadow-lg shadow-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all hover:brightness-110"
                style={{ background: "linear-gradient(135deg, #C4B5FD, #A78BFA)", color: "#3B0764" }}
              >
                {locking
                  ? t("creatingBtn")
                  : proposedAgents && proposedAgents.length >= 2
                    ? t("confirmCreateWithAgents", { cost: confirmCredits })
                    : t("confirmCreateEpisode", { cost: 100 })}
              </button>
            </div>
          </div>
        )}

        {/* ========== STEP 4: Episode generation pipeline ========== */}
        {step === "creating" && (
          <div className="max-w-md mx-auto rounded-2xl backdrop-blur-xl bg-white/70 border border-white/40 shadow-xl p-8 flex flex-col items-center">
            <h2 className="text-xl font-bold text-gray-800 mb-6">{t("generatingEp1")}</h2>
            <div className="space-y-3 w-fit">
              {PIPELINE_STEPS.map((ps) => {
                const currentIdx = PIPELINE_STEPS.findIndex((s) => s.key === pipelineSubStep);
                const thisIdx = PIPELINE_STEPS.findIndex((s) => s.key === ps.key);
                const isActive = ps.key === pipelineSubStep && ps.key !== "done";
                const isDone = thisIdx < currentIdx || pipelineSubStep === "done";

                return (
                  <div key={ps.key} className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0">
                      {isDone ? (
                        <div className="w-7 h-7 rounded-full bg-purple-500 flex items-center justify-center">
                          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      ) : isActive ? (
                        <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center">
                          <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
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
                          ? "text-purple-600"
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
            {pipelineSubStep === "done" && createdSeriesId && (
              <div className="mt-6 text-center">
                <p className="text-sm text-purple-600 font-medium">{t("redirectingToSeries")}</p>
              </div>
            )}
          </div>
        )}
        {/* Discard — subtle reset button, visible when not on input step */}
        {step !== "input" && step !== "creating" && step !== "generating_doc" && (
          <div className="flex justify-center pt-2 pb-4">
            <button
              onClick={() => {
                if (!window.confirm(t("discardConfirm"))) return;
                if (ACTIVE_KEY) localStorage.removeItem(ACTIVE_KEY);
                if (STORAGE_KEY) localStorage.removeItem(STORAGE_KEY);
                if (DISCARDED_KEY) sessionStorage.setItem(DISCARDED_KEY, "1");
                setStep("input");
                setSeriesDoc(null);
                setArcDoc(null);
                setSeriesTitle("");
                setAgent1Id("");
                setAgent2Id("");
                setIdea("");
                setAutoGenerateAgents(false);
                setProposedAgents(null);
                setGenerating(false);
                setRefining(false);
                setLocking(false);
                setError(null);
                setCreatedSeriesId(null);
                setPipelineSubStep("locking");
                if (genJobPollRef.current) { window.clearInterval(genJobPollRef.current); genJobPollRef.current = null; }
                if (refineJobPollRef.current) { window.clearInterval(refineJobPollRef.current); refineJobPollRef.current = null; }
                restoredRef.current = false;
              }}
              className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
            >
              {t("discardBtn")}
            </button>
          </div>
        )}
      </PageContainer>
    </div>
  );
}

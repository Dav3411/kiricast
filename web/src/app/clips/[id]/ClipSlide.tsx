"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, { useState, useCallback, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/components/AuthProvider";
import { useJobQueue } from "@/components/JobQueueProvider";
import { useFetchWithAuth } from "@/hooks/useFetchWithAuth";
import { Subtitles } from "@/components/Subtitles";
import { timeAgo, getAgentAvatarUrl } from "@/lib/clipUtils";
import { ProgressBar } from "./ProgressBar";
import type { TimingLine } from "@/types/clip";
import type { ClipData } from "./useClipFeed";

const EMPTY_TIMING_LINES: TimingLine[] = [];

type ClipSlideProps = {
  clip: ClipData;
  index: number;
  isActive: boolean;
  isMuted: boolean;
  isPlaying: boolean;
  progress: number;
  activeSpeaker: string | null;
  likingClipId: string | null;
  copiedClipId: string | null;
  exportError: string | null;
  deletingClipId: string | null;
  actionMenuOpen: boolean;
  audioRef: (el: HTMLAudioElement | null) => void;
  subtitlesAudioRef: React.RefObject<HTMLAudioElement | null>;
  onSeek: (percent: number) => void;
  onSeekStart?: () => void;
  onSeekEnd?: () => void;
  onToggleLike: () => void;
  onCopyLink: () => void;
  onMuteToggle: () => void;
  onTogglePlay: () => void;
  onPlay: () => void;
  onPause: () => void;
  onEnded: () => void;
  onTimeUpdate: (e: React.SyntheticEvent<HTMLAudioElement>) => void;
  onActionMenuToggle: () => void;
  canExport: boolean;
  onDeleteClip: () => void;
  onExportShorts: () => void;
  onNativeShare: () => void;
  onNavigateEpisode?: (direction: "prev" | "next") => void;
  /** Ref that ClipSlide populates so parent can trigger the continue modal */
  continueRef?: React.MutableRefObject<(() => void) | null>;
};

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

const REPORT_REASONS = [
  { value: "defamation", labelKey: "reportDefamation" },
  { value: "copyright", labelKey: "reportCopyright" },
  { value: "privacy", labelKey: "reportPrivacy" },
  { value: "inappropriate", labelKey: "reportInappropriate" },
  { value: "other", labelKey: "reportOther" },
] as const;

export function ClipSlide({
  clip,
  index,
  isActive,
  isMuted,
  isPlaying,
  progress,
  activeSpeaker,
  likingClipId,
  copiedClipId,
  exportError,
  deletingClipId,
  actionMenuOpen,
  audioRef,
  subtitlesAudioRef,
  onSeek,
  onSeekStart,
  onSeekEnd,
  onToggleLike,
  onCopyLink,
  onMuteToggle,
  onTogglePlay,
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate,
  canExport,
  onActionMenuToggle,
  onDeleteClip,
  onExportShorts,
  onNativeShare,
  onNavigateEpisode,
  continueRef,
}: ClipSlideProps) {
  const t = useTranslations("clipViewer");
  const agentNames = Object.fromEntries(
    (clip.agentInfos ?? []).map((a) => [a.id, a.name])
  );

  // Parse server dominant_color "r, g, b" → lightened rgb string (same logic as export)
  const parseDominantColor = useCallback((raw: string): string | null => {
    const parts = raw.split(",").map((v) => parseInt(v.trim(), 10));
    if (parts.length < 3 || parts.some(isNaN)) return null;
    let [r, g, b] = parts;
    // ensure minimum brightness (matches _ensure_brightness in podcast_maker.py)
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 160) {
      const factor = 160 / Math.max(lum, 1);
      r = Math.min(255, Math.round(r * factor));
      g = Math.min(255, Math.round(g * factor));
      b = Math.min(255, Math.round(b * factor));
    }
    return `rgb(${r},${g},${b})`;
  }, []);

  // dominant color per agent id — server value first, canvas fallback
  const dominantColors = useRef<Record<string, string>>({});
  const [colorMap, setColorMap] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const a of clip.agentInfos) {
      if (a.dominant_color) {
        const c = parseDominantColor(a.dominant_color);
        if (c) { initial[a.id] = c; dominantColors.current[a.id] = c; }
      }
    }
    return initial;
  });

  // Sync server colors when clip/agentInfos changes
  React.useEffect(() => {
    const updates: Record<string, string> = {};
    for (const a of clip.agentInfos) {
      if (a.dominant_color && !dominantColors.current[a.id]) {
        const c = parseDominantColor(a.dominant_color);
        if (c) { updates[a.id] = c; dominantColors.current[a.id] = c; }
      }
    }
    if (Object.keys(updates).length) setColorMap((prev) => ({ ...prev, ...updates }));
  }, [clip.agentInfos, parseDominantColor]);

  const extractColor = useCallback((agentId: string, img: HTMLImageElement) => {
    // Skip canvas extraction if server color already set
    if (dominantColors.current[agentId]) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 16, 16);
      const data = ctx.getImageData(0, 0, 16, 16).data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        if (alpha < 128) continue;
        const rr = data[i], gg = data[i + 1], bb = data[i + 2];
        const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
        if (max - min < 30) continue;
        r += rr; g += gg; b += bb; count++;
      }
      if (count === 0) return;
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      const lighten = (v: number) => Math.round(v + (255 - v) * 0.45);
      const color = `rgb(${lighten(r)},${lighten(g)},${lighten(b)})`;
      dominantColors.current[agentId] = color;
      setColorMap((prev) => ({ ...prev, [agentId]: color }));
    } catch {
      // canvas tainted (cross-origin) — fall back silently
    }
  }, []);

  const activeSpeakerColor = activeSpeaker ? (colorMap[activeSpeaker] ?? "#ffffff") : "#ffffff";

  const router = useRouter();
  const { user } = useAuth();
  const { addJob, jobs } = useJobQueue();
  const { fetchWithAuth } = useFetchWithAuth();

  const [likePop, setLikePop] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportDone, setReportDone] = useState(false);

  // Continue story modal
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

  // Play/pause overlay indicator
  const [playOverlay, setPlayOverlay] = useState<"play" | "pause" | null>(null);
  const playOverlayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTapToggle = useCallback(() => {
    onTogglePlay();
    const next = isPlaying ? "pause" : "play";
    setPlayOverlay(next);
    if (playOverlayTimer.current) clearTimeout(playOverlayTimer.current);
    if (next === "play") {
      // 재생 시에만 잠깐 보여주고 사라짐
      playOverlayTimer.current = setTimeout(() => setPlayOverlay(null), 600);
    }
    // 일시정지면 오버레이 계속 유지
  }, [isPlaying, onTogglePlay]);

  useEffect(() => {
    return () => { if (playOverlayTimer.current) clearTimeout(playOverlayTimer.current); };
  }, []);

  async function handleReportSubmit() {
    if (!reportReason || reportSubmitting) return;
    setReportSubmitting(true);
    try {
      await fetch(`/api/clips/${encodeURIComponent(clip.id)}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reportReason }),
      });
      setReportDone(true);
    } catch {
      // 실패해도 UI는 닫음
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

  async function handleContinueOpen() {
    if (isPlaying) onTogglePlay();
    setContinueOpen(true);
    setContinueLoading(true);
    setContinueError(null);
    setContinueOptions([]);
    setContinueSeriesData(null);

    try {
      const res = await fetchWithAuth(`/api/clips/${encodeURIComponent(clip.id)}/continue`, {
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
      // 새 형식: {forced_next_type, options} / 구 형식: 배열
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
  }

  async function handleSelectOption(option: NextEpisodeOption) {
    if (!user) { router.push("/login"); return; }
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
        router.push(`/credits?return=${encodeURIComponent(`/clips/${clip.id}`)}`);
        return;
      }
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to create episode");

      void trackEvent("continue_story_option_selected", {
        clipId: clip.id,
        seriesId: continueSeriesData.seriesId,
        episodeNumber: continueSeriesData.nextEpisodeNumber,
        optionLabel: option.label,
      });

      // Poll job until clip is ready, then navigate to it
      const jobId = data.jobId;
      if (!jobId) {
        router.push(`/series/${encodeURIComponent(continueSeriesData.seriesId)}`);
        return;
      }

      addJob({
        id: jobId,
        kind: "clip",
        name: `${clip.seriesTitle || epTitle} EP.${continueSeriesData.nextEpisodeNumber}`,
        seriesId: continueSeriesData.seriesId,
        episodeNumber: continueSeriesData.nextEpisodeNumber,
      });

      // Close modal — job runs in background via sidebar task
      closeContinueModal();
      setContinueCreating(false);
    } catch (e) {
      setContinueError(e instanceof Error ? e.message : "Failed to create episode");
      setContinueCreating(false);
    }
  }

  async function handleSoftResetConfirm() {
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
        router.push(`/credits?return=${encodeURIComponent(`/clips/${clip.id}`)}`);
        return;
      }
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? "Failed to create episode");

      void trackEvent("continue_story_soft_reset", {
        clipId: clip.id,
        seriesId: continueSeriesData.seriesId,
        episodeNumber: continueSeriesData.nextEpisodeNumber,
      });

      const jobId = data.jobId;
      if (!jobId) {
        router.push(`/series/${encodeURIComponent(continueSeriesData.seriesId)}`);
        return;
      }

      addJob({
        id: jobId,
        kind: "clip",
        name: `${clip.seriesTitle || epTitle} EP.${continueSeriesData.nextEpisodeNumber}`,
        seriesId: continueSeriesData.seriesId,
        episodeNumber: continueSeriesData.nextEpisodeNumber,
      });

      // Close modal — job runs in background via sidebar task
      closeContinueModal();
      setContinueCreating(false);
    } catch (e) {
      setContinueError(e instanceof Error ? e.message : "Failed to create episode");
      setContinueCreating(false);
    }
  }

  // Register handleContinueOpen for parent (EpisodeRow) to trigger on last-episode end/swipe
  React.useEffect(() => {
    if (!continueRef) return;
    const isLastEpisode = !clip.nextEpisodeClipId && clip.speakers.length >= 2;
    const activeSeriesJob = clip.seriesId
      ? jobs.find((j) => j.seriesId === clip.seriesId && (j.status === "queued" || j.status === "processing"))
      : null;
    continueRef.current = (isLastEpisode && !activeSeriesJob)
      ? () => { void handleContinueOpen(); }
      : null;
    return () => { if (continueRef) continueRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continueRef, clip.nextEpisodeClipId, clip.speakers.length, clip.seriesId, jobs]);

  function closeContinueModal() {
    if (continueCreating) return;
    setContinueOpen(false);
    setContinueOptions([]);
    setContinueSeriesData(null);
    setContinueError(null);
    setSelectedOptionIdx(null);
    setForcedNextType(null);
  }

  return (
    <section
      key={clip.id}
      data-clip-id={clip.id}
      className="h-full w-full relative bg-zinc-950 overflow-hidden"
    >
      {/* Background image */}
      {clip.backgroundImageUrl && (
        <>
          <img
            src={clip.backgroundImageUrl}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover blur-[2px] scale-[1.02]"
          />
          <div className="absolute inset-0 bg-black/10" />
        </>
      )}

      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); window.history.back(); }}
        className="lg:hidden absolute top-4 left-4 z-20 h-10 w-10 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm text-white"
        aria-label="Go back"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
      </button>

      {/* Tap to play/pause */}
      <div className="absolute inset-0 z-0" onClick={handleTapToggle} />

      {/* Play/pause overlay indicator */}
      {playOverlay && (
        <div className={`absolute inset-0 z-[5] flex items-center justify-center pointer-events-none ${playOverlay === "play" ? "animate-[fadeOut_0.6s_ease-out_forwards]" : ""}`}>
          <div className="h-16 w-16 flex items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
            {playOverlay === "play" ? (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
                <path d="M8 5v14l11-7z"/>
              </svg>
            ) : (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
                <rect x="6" y="4" width="4" height="16" rx="1"/>
                <rect x="14" y="4" width="4" height="16" rx="1"/>
              </svg>
            )}
          </div>
        </div>
      )}

      {/* Agent images: fixed at 1/3 from top */}
      {clip.playbackUrl && clip.agentInfos.length > 0 ? (
        <div className="absolute left-0 right-0 top-[33%] -translate-y-1/2 flex items-center justify-center gap-10 md:gap-16 px-6 pointer-events-none">
          {clip.agentInfos.map((agent) => {
            const agentColor = colorMap[agent.id] ?? "#ffffff";
            const isSpeaking = isPlaying && activeSpeaker === agent.id;
            return (
              <div
                key={agent.id}
                className={`flex flex-col items-center gap-2 transition-shadow duration-300 rounded-3xl ${
                  isSpeaking
                    ? "agent-speak-active shadow-xl"
                    : "opacity-90"
                }`}
              >
                <img
                  crossOrigin="anonymous"
                  className="h-[7.5rem] w-[7.5rem] rounded-3xl object-cover md:h-[10.5rem] md:w-[10.5rem]"
                  style={isSpeaking ? { boxShadow: `0 0 0 4px ${agentColor}88` } : undefined}
                  src={getAgentAvatarUrl(agent.id)}
                  alt={agent.name}
                  onLoad={(e) => extractColor(agent.id, e.currentTarget)}
                />
                <span
                  className="text-sm font-semibold"
                  style={{ color: agentColor }}
                >
                  {agent.name}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      {/* Subtitles: independently positioned below agents */}
      {clip.playbackUrl ? (
        <div className="absolute left-0 right-0 top-[55%] flex justify-center px-6 pointer-events-none">
          <div className="w-full max-w-md">
            <Subtitles
              key={`subs-${clip.id}-${clip.timingLines?.length ?? 0}`}
              audioRef={subtitlesAudioRef}
              timingLines={clip.timingLines?.length ? clip.timingLines : EMPTY_TIMING_LINES}
              agentNames={agentNames}
              speakerColor={activeSpeakerColor}
            />
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm clip-card-muted pointer-events-none">
          {t("playbackUnavailable")}
        </div>
      )}

      {exportError ? (
        <div className="absolute top-16 left-0 right-0 flex justify-center pointer-events-none">
          <div className="text-sm text-red-300">{exportError}</div>
        </div>
      ) : null}

      {/* Audio element */}
      <audio
        ref={audioRef}
        src={clip.playbackUrl ?? undefined}
        preload={isActive ? "auto" : "metadata"}
        onPlay={onPlay}
        onPause={onPause}
        onEnded={onEnded}
        onTimeUpdate={onTimeUpdate}
        className="hidden"
      />

      {/* Progress bar */}
      <div className="absolute bottom-0 left-0 right-0 z-10 bg-black">
        <ProgressBar progress={progress} onSeek={onSeek} onSeekStart={onSeekStart} onSeekEnd={onSeekEnd} />
      </div>

      {/* Right center: next episode arrow OR continue story (+) on last episode */}
      {clip.nextEpisodeClipId ? (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm text-white hover:bg-black/50 active:scale-95 transition"
          aria-label={t("nextEpisode")}
          title={t("partNumber", { number: (clip.episodeNumber ?? 1) + 1 })}
          onClick={(e) => { e.stopPropagation(); onNavigateEpisode?.("next"); }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      ) : clip.speakers.length >= 2 ? (() => {
        const activeSeriesJob = clip.seriesId
          ? jobs.find((j) => j.seriesId === clip.seriesId && (j.status === "queued" || j.status === "processing"))
          : null;
        if (activeSeriesJob) {
          const isOwner = clip.isOwner;
          return (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm text-white/70 transition"
              aria-label="Episode generating"
              title={`EP.${activeSeriesJob.episodeNumber ?? "?"} generating (${activeSeriesJob.progress ?? 0}%)`}
              onClick={(e) => {
                e.stopPropagation();
                if (isOwner && clip.seriesId) {
                  router.push(`/series/${encodeURIComponent(clip.seriesId)}`);
                }
              }}
            >
              <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            </button>
          );
        }
        return (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 flex items-center justify-center rounded-full btn-gradient-flow text-white hover:brightness-110 active:scale-95 transition"
            aria-label={t("continueStory")}
            title={t("continueStory")}
            onClick={(e) => {
              e.stopPropagation();
              void trackEvent("continue_story_start", {
                source: "clip_page",
                clipId: clip.id,
              });
              void handleContinueOpen();
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        );
      })() : null}

      {/* Previous episode arrow - left center (ep1에서는 마지막 에피소드로 순환) */}
      {clip.prevEpisodeClipId || (clip.seriesId && clip.nextEpisodeClipId) ? (
        <button
          type="button"
          className="absolute left-2 top-1/2 -translate-y-1/2 z-10 h-10 w-10 flex items-center justify-center rounded-full bg-black/30 backdrop-blur-sm text-white hover:bg-black/50 active:scale-95 transition"
          aria-label={t("partNumber", { number: (clip.episodeNumber ?? 1) - 1 })}
          title={clip.prevEpisodeClipId ? t("partNumber", { number: (clip.episodeNumber ?? 1) - 1 }) : t("lastEpisode")}
          onClick={(e) => { e.stopPropagation(); onNavigateEpisode?.("prev"); }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
      ) : null}

      {/* Title + agents - bottom left */}
      <div className="absolute bottom-6 left-3 z-10">
        <div className="flex items-center gap-1">
          {clip.agentInfos.map((agent) => (
            <Link
              key={agent.id}
              href={`/agents/${encodeURIComponent(agent.id)}`}
              onClick={(e) => e.stopPropagation()}
            >
              <img
                className="h-12 w-12 shrink-0 aspect-square rounded-full object-cover ring-1 ring-white/30"
                src={getAgentAvatarUrl(agent.id)}
                alt={agent.name}
              />
            </Link>
          ))}
        </div>
        <div className="mt-2 max-w-[60vw]">
          <span className="text-base font-semibold clip-card-text truncate block">
            {clip.title ?? t("untitled")}
          </span>
          {clip.seriesId && (clip.seriesTitle || clip.episodeNumber) ? (
            <div className="mt-0.5 flex items-center gap-1.5">
              {clip.seriesTitle && (
                <Link
                  href={`/series/${clip.seriesId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs text-purple-300 hover:text-purple-200 hover:underline truncate transition"
                >
                  {clip.seriesTitle}
                </Link>
              )}
              {clip.episodeNumber && (
                <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-600/30 text-purple-300 font-medium">
                  {t("episodePrefix")}{clip.episodeNumber}
                </span>
              )}
            </div>
          ) : null}
        </div>
        <div className="mt-1 text-xs clip-card-muted">
          {clip.durationSec != null ? `${clip.durationSec}s` : "Duration -"}
          {clip.publishedAt ? ` · ${(() => {
            const raw = timeAgo(clip.publishedAt);
            const minMatch = raw.match(/^(\d+) minute/);
            if (minMatch) return t("minutesAgo", { count: Number(minMatch[1]) });
            const hrMatch = raw.match(/^(\d+) hour/);
            if (hrMatch) return t("hoursAgo", { count: Number(hrMatch[1]) });
            const dayMatch = raw.match(/^(\d+) day/);
            if (dayMatch) return t("daysAgo", { count: Number(dayMatch[1]) });
            return raw;
          })()}` : ""}
        </div>
      </div>

      {/* Action buttons - bottom right */}
      <div
        className="absolute bottom-10 right-2 z-10 flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Like */}
        <button
          type="button"
          className="h-10 w-10 flex items-center justify-center rounded-full bg-white/15 backdrop-blur-sm text-white hover:bg-white/25 active:scale-95 transition disabled:opacity-60"
          aria-label={clip.liked ? "Unlike" : "Like"}
          title={clip.liked ? "Unlike" : "Like"}
          disabled={likingClipId === clip.id}
          onClick={() => {
            setLikePop(true);
            onToggleLike();
          }}
        >
          <span className="flex flex-col items-center leading-none">
            <span
              className={`inline-block${likePop ? " like-pop" : ""}`}
              onAnimationEnd={() => setLikePop(false)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill={clip.liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
              </svg>
            </span>
            {(clip.likeCount ?? 0) > 0 ? (
              <span className="text-[10px] mt-0.5 font-medium">
                {clip.likeCount}
              </span>
            ) : null}
          </span>
        </button>

        {/* Mute */}
        <button
          type="button"
          className="h-10 w-10 flex items-center justify-center rounded-full bg-white/15 backdrop-blur-sm text-white text-lg hover:bg-white/25 active:scale-95 transition"
          aria-label={isMuted ? "Unmute" : "Mute"}
          onClick={onMuteToggle}
        >
          {isMuted ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 010 7.07"/>
              <path d="M19.07 4.93a10 10 0 010 14.14"/>
            </svg>
          )}
        </button>

        {/* More actions menu */}
        <div className="relative">
          <button
            type="button"
            className="h-10 w-10 flex items-center justify-center rounded-full bg-white/15 backdrop-blur-sm text-white hover:bg-white/25 active:scale-95 transition"
            aria-label="More actions"
            onClick={onActionMenuToggle}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
              <circle cx="12" cy="5" r="1.5"/>
              <circle cx="12" cy="12" r="1.5"/>
              <circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>
          {actionMenuOpen ? (
            <div className="absolute right-full mr-2 bottom-0 w-44 rounded-xl border border-white/20 bg-zinc-900/95 p-1.5 shadow-xl z-20">
              <button
                type="button"
                className="w-full text-left px-3 py-2 rounded-lg text-sm text-zinc-100 hover:bg-zinc-800/80"
                onClick={() => {
                  onActionMenuToggle();
                  void trackEvent("share_open", { clipId: clip.id });
                  onCopyLink();
                }}
              >
                {copiedClipId === clip.id ? t("copied") : t("copyLink")}
              </button>
              {clip.speakers.length >= 2 ? (
                <>
                  <Link
                    href="/series/create"
                    className="block px-3 py-2 rounded-lg text-sm text-zinc-100 hover:bg-zinc-800/80"
                    onClick={() => {
                      onActionMenuToggle();
                      void trackEvent("remix_start", {
                        source: "clip_page",
                        clipId: clip.id,
                      });
                    }}
                  >
                    {t("remix")}
                  </Link>
                </>
              ) : null}
              {"share" in navigator ? (
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-zinc-100 hover:bg-zinc-800/80"
                  onClick={() => {
                    onActionMenuToggle();
                    void trackEvent("share_open", { clipId: clip.id });
                    onNativeShare();
                  }}
                >
                  {t("share")}
                </button>
              ) : null}
              {clip.isOwner ? (
                <>
                  {canExport ? (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-zinc-100 hover:bg-zinc-800/80 disabled:opacity-50"
                      onClick={() => {
                        onActionMenuToggle();
                        onExportShorts();
                      }}
                    >
                      {t("export")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-zinc-500 hover:bg-zinc-800/80"
                      onClick={() => {
                        onActionMenuToggle();
                        window.location.href = "/credits?plan=plus";
                      }}
                    >
                      {t("export")} <span className="text-xs text-emerald-400">{t("plusBadge")}</span>
                    </button>
                  )}
                  {clip.canDelete ? (
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 rounded-lg text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                      disabled={deletingClipId === clip.id}
                      onClick={() => {
                        onActionMenuToggle();
                        onDeleteClip();
                      }}
                    >
                      {deletingClipId === clip.id ? t("deleting") : t("delete")}
                    </button>
                  ) : null}
                </>
              ) : null}
              {!clip.isOwner ? (
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-zinc-400 hover:bg-zinc-800/80"
                  onClick={() => {
                    onActionMenuToggle();
                    setReportOpen(true);
                  }}
                >
                  {t("report")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* 신고 모달 */}
      {/* Continue story modal */}
      {continueOpen ? (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-4"
          onClick={closeContinueModal}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-white/15 bg-zinc-900 p-5 shadow-2xl max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {continueLoading ? (
              <div className="flex items-center justify-center py-8 gap-3">
                <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-zinc-300">{t("loadingChoices")}</span>
              </div>
            ) : continueCreating ? (
              <div className="flex items-center justify-center py-8 gap-3">
                <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-zinc-300">{t("creatingEpisode")}</span>
              </div>
            ) : (
              <>
                <div className="text-base font-semibold text-zinc-100 mb-1">{t("nextEpisode")}</div>
                <div className="text-xs text-zinc-400 mb-4">
                  {forcedNextType === "soft_reset"
                    ? t("softResetPart", { number: continueSeriesData?.nextEpisodeNumber ?? "?" })
                    : t("chooseDirection", { number: continueSeriesData?.nextEpisodeNumber ?? "?" })}
                </div>

                {continueError ? (
                  <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-300 mb-3">
                    {continueError}
                  </div>
                ) : null}

                {forcedNextType === "soft_reset" ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
                    <div className="text-sm font-semibold text-amber-200 mb-1">{t("standaloneEpisode")}</div>
                    <div className="text-xs text-amber-300/70">{t("standaloneDesc")}</div>
                  </div>
                ) : continueOptions.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {continueOptions.map((opt, i) => {
                      const isOpen = selectedOptionIdx === i;
                      return (
                        <div key={i} className={`rounded-xl border transition-colors ${isOpen ? "border-purple-500/50 bg-purple-500/10" : "border-white/10 bg-white/5 hover:bg-white/8"}`}>
                          <button
                            type="button"
                            className="w-full text-left p-3.5"
                            onClick={() => setSelectedOptionIdx(isOpen ? null : i)}
                          >
                            <div className="flex items-center gap-2.5">
                              <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isOpen ? "bg-purple-500/30 text-purple-200" : "bg-purple-500/20 text-purple-300"}`}>
                                {String.fromCharCode(65 + i)}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium text-zinc-100 line-clamp-1">{opt.label}</div>
                                {opt.episode_type ? (
                                  <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-medium">
                                    {opt.episode_type.replace(/_/g, " ")}
                                  </span>
                                ) : null}
                              </div>
                              <svg className={`shrink-0 w-4 h-4 text-zinc-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="6 9 12 15 18 9"/>
                              </svg>
                            </div>
                          </button>
                          <div className={`overflow-hidden transition-all duration-200 ${isOpen ? "max-h-40 opacity-100" : "max-h-0 opacity-0"}`}>
                            <div className="px-3.5 pb-3.5 pt-0 space-y-1.5 max-h-32 overflow-y-auto soft-scroll-purple">
                              {opt.situation ? <div className="text-xs text-zinc-400"><span className="text-zinc-500 font-medium">{t("situation")}</span> {opt.situation}</div> : null}
                              {opt.setting ? <div className="text-xs text-zinc-400"><span className="text-zinc-500 font-medium">{t("settingLabel")}</span> {opt.setting}</div> : null}
                              {opt.core_emotion ? <div className="text-xs text-zinc-400"><span className="text-zinc-500 font-medium">{t("emotion")}</span> {opt.core_emotion}</div> : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : !continueError ? (
                  <div className="text-sm text-zinc-400 text-center py-4">{t("noChoicesYet")}</div>
                ) : null}

                <div className="flex gap-2 mt-4">
                  <button
                    type="button"
                    className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-zinc-400 hover:bg-white/5 transition"
                    onClick={closeContinueModal}
                  >
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded-xl py-2.5 text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed bg-purple-600 text-white hover:bg-purple-500 active:scale-[0.98]"
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
              </>
            )}
          </div>
        </div>
      ) : null}

      {reportOpen ? (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/70"
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
                  Close
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
                    {t("cancel")}
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded-xl bg-red-500/80 py-2 text-sm text-white hover:bg-red-500 transition disabled:opacity-50"
                    disabled={!reportReason || reportSubmitting}
                    onClick={() => void handleReportSubmit()}
                  >
                    {reportSubmitting ? "Submitting…" : "Submit"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

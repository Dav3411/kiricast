"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { trackEvent } from "@/lib/analytics";
import { useAuth } from "@/components/AuthProvider";
import { useJobQueue } from "@/components/JobQueueProvider";
import { useFetchWithAuth } from "@/hooks/useFetchWithAuth";
import type { ClipData } from "./useClipFeed";

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

type ContinueStoryModalProps = {
  clip: ClipData;
  onClose: () => void;
};

export function ContinueStoryModal({ clip, onClose }: ContinueStoryModalProps) {
  const t = useTranslations("clipViewer");
  const router = useRouter();
  const { user } = useAuth();
  const { addJob } = useJobQueue();
  const { fetchWithAuth } = useFetchWithAuth();

  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<NextEpisodeOption[]>([]);
  const [forcedNextType, setForcedNextType] = useState<string | null>(null);
  const [seriesData, setSeriesData] = useState<{
    seriesId: string;
    agent1Id: string;
    agent2Id: string;
    nextEpisodeNumber: number;
    setting?: string;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedOptionIdx, setSelectedOptionIdx] = useState<number | null>(null);

  // 마운트 시 옵션 로드
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(`/api/clips/${encodeURIComponent(clip.id)}/continue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || data.error) throw new Error(data.error ?? "Failed to load options");

        setSeriesData({
          seriesId: data.seriesId,
          agent1Id: data.agent1Id,
          agent2Id: data.agent2Id,
          nextEpisodeNumber: data.nextEpisodeNumber,
          setting: data.setting ?? "",
        });
        const raw = data.nextEpisodeOptions;
        if (raw && typeof raw === "object" && !Array.isArray(raw)) {
          setForcedNextType(raw.forced_next_type ?? null);
          setOptions(Array.isArray(raw.options) ? raw.options : []);
        } else {
          setForcedNextType(null);
          setOptions(Array.isArray(raw) ? raw : []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load options");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleClose() {
    if (creating) return;
    onClose();
  }

  async function handleSelectOption(option: NextEpisodeOption) {
    if (!seriesData || creating) return;
    setCreating(true);
    setError(null);

    try {
      const epTitle = `${option.title || "Next Episode"}`.slice(0, 60);
      const res = await fetchWithAuth("/api/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent1Id: seriesData.agent1Id,
          agent2Id: seriesData.agent2Id,
          title: epTitle,
          setting: (option.setting || "").slice(0, 300),
          situation: (option.situation || "").slice(0, 300),
          core_emotion: (option.core_emotion || "").slice(0, 150),
          relationship_state: (option.relationship_state || "").slice(0, 150),
          tone: (option.tone || "").slice(0, 100),
          seriesId: seriesData.seriesId,
          episodeNumber: seriesData.nextEpisodeNumber,
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
        seriesId: seriesData.seriesId,
        episodeNumber: seriesData.nextEpisodeNumber,
        optionLabel: option.label,
      });

      const jobId = data.jobId;
      if (!jobId) {
        router.push(`/series/${encodeURIComponent(seriesData.seriesId)}`);
        return;
      }

      addJob({
        id: jobId,
        kind: "clip",
        name: `${clip.seriesTitle || epTitle} EP.${seriesData.nextEpisodeNumber}`,
        seriesId: seriesData.seriesId,
        episodeNumber: seriesData.nextEpisodeNumber,
      });

      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create episode");
    } finally {
      setCreating(false);
    }
  }

  async function handleSoftResetConfirm() {
    if (!seriesData || creating) return;
    setCreating(true);
    setError(null);

    try {
      const epTitle = `EP.${seriesData.nextEpisodeNumber} — Soft Reset`;
      const res = await fetchWithAuth("/api/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent1Id: seriesData.agent1Id,
          agent2Id: seriesData.agent2Id,
          title: epTitle,
          setting: seriesData.setting || "",
          situation: "",
          core_emotion: "",
          relationship_state: "",
          tone: "",
          seriesId: seriesData.seriesId,
          episodeNumber: seriesData.nextEpisodeNumber,
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
        seriesId: seriesData.seriesId,
        episodeNumber: seriesData.nextEpisodeNumber,
      });

      const jobId = data.jobId;
      if (!jobId) {
        router.push(`/series/${encodeURIComponent(seriesData.seriesId)}`);
        return;
      }

      addJob({
        id: jobId,
        kind: "clip",
        name: `${clip.seriesTitle || epTitle} EP.${seriesData.nextEpisodeNumber}`,
        seriesId: seriesData.seriesId,
        episodeNumber: seriesData.nextEpisodeNumber,
      });

      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create episode");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-white/15 bg-zinc-900 p-5 shadow-2xl max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-3">
            <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-zinc-300">{t("loadingChoices")}</span>
          </div>
        ) : creating ? (
          <div className="flex items-center justify-center py-8 gap-3">
            <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-zinc-300">{t("creatingEpisode")}</span>
          </div>
        ) : (
          <>
            <div className="text-base font-semibold text-zinc-100 mb-1">{t("nextEpisode")}</div>
            <div className="text-xs text-zinc-400 mb-4">
              {forcedNextType === "soft_reset"
                ? t("softResetPart", { number: seriesData?.nextEpisodeNumber ?? "?" })
                : t("chooseDirection", { number: seriesData?.nextEpisodeNumber ?? "?" })}
            </div>

            {error ? (
              <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-300 mb-3">
                {error}
              </div>
            ) : null}

            {forcedNextType === "soft_reset" ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
                <div className="text-sm font-semibold text-amber-200 mb-1">{t("standaloneEpisode")}</div>
                <div className="text-xs text-amber-300/70">{t("standaloneDesc")}</div>
              </div>
            ) : options.length > 0 ? (
              <div className="flex flex-col gap-2">
                {options.map((opt, i) => {
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
            ) : !error ? (
              <div className="text-sm text-zinc-400 text-center py-4">{t("noChoicesYet")}</div>
            ) : null}

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                className="flex-1 rounded-xl border border-white/15 py-2.5 text-sm text-zinc-400 hover:bg-white/5 transition"
                onClick={handleClose}
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
                    void handleSelectOption(options[selectedOptionIdx]!);
                  }
                }}
              >
                {t("confirm")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import React, { type MutableRefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { ClipSlide } from "./ClipSlide";
import type { ClipData } from "./useClipFeed";

type EpisodeRowProps = {
  initialClip: ClipData;
  feedIndex: number;
  isActiveRow: boolean;
  activeClipId: string | null;
  activeClipIdRef: React.RefObject<string | null>;
  onEpisodeChange: (clipId: string, rowIdx: number) => void;
  onTogglePlay: () => void;
  prefetchEpisode: (clipId: string) => Promise<ClipData | null>;
  loadTimingForClip: (clipId: string) => Promise<Pick<ClipData, "timingLines" | "agentInfos" | "speakers"> | null>;
  audioMapRef: React.RefObject<Map<string, HTMLAudioElement>>;
  speakerMapRef: React.RefObject<Map<string, string | null>>;
  seekingRef: React.RefObject<string | null>;
  progressMap: Record<string, number>;
  setProgressMap: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  playingSet: Set<string>;
  setPlayingSet: React.Dispatch<React.SetStateAction<Set<string>>>;
  userMuted: boolean;
  feedRef: React.RefObject<HTMLDivElement | null>;
  rowCount: number;
  handleSeek: (clipId: string, percent: number) => void;
  handleSeekStart: (clipId: string) => void;
  handleSeekEnd: (clipId: string) => void;
  toggleLike: (clipId: string) => Promise<void>;
  copyLink: (clipId: string) => Promise<void>;
  handleMuteToggle: (clipId: string) => void;
  deleteClip: (clipId: string) => Promise<void>;
  exportShorts: (clipId: string) => Promise<void>;
  nativeShare: (clipId: string) => Promise<void>;
  likingClipId: string | null;
  copiedClipId: string | null;
  exportError: string | null;
  deletingClipId: string | null;
  actionMenuOpen: string | null;
  setActionMenuOpen: React.Dispatch<React.SetStateAction<string | null>>;
  canExport: boolean;
  registerRowElement?: (index: number, el: HTMLElement | null) => void;
};

export function EpisodeRow({
  initialClip,
  feedIndex,
  isActiveRow,
  activeClipId,
  activeClipIdRef,
  onEpisodeChange,
  onTogglePlay,
  prefetchEpisode,
  loadTimingForClip,
  audioMapRef,
  speakerMapRef,
  seekingRef,
  progressMap,
  setProgressMap,
  playingSet,
  setPlayingSet,
  userMuted,
  feedRef,
  rowCount,
  handleSeek,
  handleSeekStart,
  handleSeekEnd,
  toggleLike,
  copyLink,
  handleMuteToggle,
  deleteClip,
  exportShorts,
  nativeShare,
  likingClipId,
  copiedClipId,
  exportError,
  deletingClipId,
  actionMenuOpen,
  setActionMenuOpen,
  canExport,
  registerRowElement,
}: EpisodeRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [episodes, setEpisodes] = useState<ClipData[]>([initialClip]);
  const correctingRef = useRef(false);
  const lastReportedRef = useRef<string | null>(null);
  const continueRef = useRef<(() => void) | null>(null);
  const touchStartXRef = useRef<number | null>(null);

  // Derive active episode index from activeClipId (no local state)
  const activeEpIdx = useMemo(() => {
    if (!isActiveRow || !activeClipId) return 0;
    const idx = episodes.findIndex((ep) => ep.id === activeClipId);
    return idx >= 0 ? idx : 0;
  }, [isActiveRow, activeClipId, episodes]);

  // Stable subtitle audio refs per episode
  const subtitleRefsMap = useRef<Map<string, MutableRefObject<HTMLAudioElement | null>>>(new Map());
  const getSubtitleRef = useCallback((epId: string): React.RefObject<HTMLAudioElement | null> => {
    let ref = subtitleRefsMap.current.get(epId);
    if (!ref) { ref = { current: null }; subtitleRefsMap.current.set(epId, ref); }
    return ref;
  }, []);

  // Stable audio ref callbacks per episode — installs play guard (Method B)
  const audioCallbacksMap = useRef<Map<string, (el: HTMLAudioElement | null) => void>>(new Map());
  const playGuardsMap = useRef<Map<string, () => void>>(new Map());
  const getAudioCallback = useCallback((epId: string) => {
    let cb = audioCallbacksMap.current.get(epId);
    if (!cb) {
      cb = (el: HTMLAudioElement | null) => {
        // Clean up previous guard if any
        const prevGuard = playGuardsMap.current.get(epId);
        if (prevGuard) { playGuardsMap.current.delete(epId); }

        const sRef = subtitleRefsMap.current.get(epId);
        if (!el) {
          audioMapRef.current.delete(epId);
          if (sRef) sRef.current = null;
          return;
        }
        audioMapRef.current.set(epId, el);
        const stableRef = getSubtitleRef(epId);
        (stableRef as MutableRefObject<HTMLAudioElement | null>).current = el;

        // Method B: play guard — if this clip is not active, immediately pause
        const guard = () => {
          if (activeClipIdRef.current !== epId) {
            el.pause();
            el.currentTime = 0;
          } else {
            // Method A: this IS the active clip — pause all others
            for (const [cid, a] of audioMapRef.current) {
              if (cid !== epId && !a.paused) {
                try { a.pause(); a.currentTime = 0; } catch { /* */ }
              }
            }
          }
        };
        el.addEventListener("play", guard);
        playGuardsMap.current.set(epId, () => el.removeEventListener("play", guard));
      };
      audioCallbacksMap.current.set(epId, cb);
    }
    return cb;
  }, [audioMapRef, getSubtitleRef, activeClipIdRef]);

  // Pause all episode audios when this row becomes inactive
  useEffect(() => {
    if (isActiveRow) return;
    const currentActiveId = activeClipIdRef.current ?? null;
    for (const ep of episodes) {
      if (ep.id === currentActiveId) continue;
      const a = audioMapRef.current.get(ep.id);
      if (a) { try { a.pause(); a.currentTime = 0; } catch { /* */ } }
    }
  }, [isActiveRow, episodes, activeClipIdRef, audioMapRef]);

  // Sync enriched data from parent
  useEffect(() => {
    setEpisodes((prev) => {
      const idx = prev.findIndex((ep) => ep.id === initialClip.id);
      if (idx >= 0) { const u = [...prev]; u[idx] = initialClip; return u; }
      return [initialClip];
    });
  }, [initialClip]);

  const insertSorted = useCallback((ep: ClipData) => {
    setEpisodes((p) => {
      if (p.some((e) => e.id === ep.id)) return p;
      const arr = [...p];
      const pos = arr.findIndex((e) => (e.episodeNumber ?? 0) > (ep.episodeNumber ?? 0));
      if (pos === -1) arr.push(ep); else arr.splice(pos, 0, ep);
      return arr;
    });
  }, []);

  // Load timing for episodes missing subtitle data
  const timingRequestedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const ep of episodes) {
      if (!ep.playbackUrl || (ep.timingLines?.length ?? 0) > 0) continue;
      if (timingRequestedRef.current.has(ep.id)) continue;
      timingRequestedRef.current.add(ep.id);
      void loadTimingForClip(ep.id).then((data) => {
        if (!data) return;
        setEpisodes((prev) => prev.map((e) => (e.id === ep.id ? { ...e, ...data } : e)));
      });
    }
  }, [episodes, loadTimingForClip]);

  // Prefetch adjacent episodes
  const prefetchedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const current = episodes[activeEpIdx];
    if (!current || prefetchedRef.current.has(current.id)) return;
    prefetchedRef.current.add(current.id);
    if (current.prevEpisodeClipId) void prefetchEpisode(current.prevEpisodeClipId).then((ep) => { if (ep) insertSorted(ep); });
    if (current.nextEpisodeClipId) void prefetchEpisode(current.nextEpisodeClipId).then((ep) => { if (ep) insertSorted(ep); });
  }, [activeEpIdx, episodes, prefetchEpisode, insertSorted]);

  // Preload adjacent episode audio
  useEffect(() => {
    if (!isActiveRow) return;
    for (const d of [-1, 1]) {
      const adj = episodes[activeEpIdx + d];
      if (adj) {
        const a = audioMapRef.current.get(adj.id);
        if (a) a.preload = "auto";
      }
    }
  }, [isActiveRow, activeEpIdx, episodes, audioMapRef]);

  // Load more episodes when near edges
  const loadingNextRef = useRef(false);
  const loadingPrevRef = useRef(false);
  useEffect(() => {
    const len = episodes.length;
    if (len === 0) return;
    if (activeEpIdx >= len - 3 && episodes[len - 1]?.nextEpisodeClipId && !loadingNextRef.current) {
      loadingNextRef.current = true;
      let tail = episodes[len - 1];
      let count = 0;
      const run = async () => {
        while (tail?.nextEpisodeClipId && count < 5) {
          const next = await prefetchEpisode(tail.nextEpisodeClipId!);
          if (!next) break;
          insertSorted(next);
          tail = next;
          count++;
        }
        loadingNextRef.current = false;
      };
      void run();
    }
    if (activeEpIdx <= 2 && episodes[0]?.prevEpisodeClipId && !loadingPrevRef.current) {
      loadingPrevRef.current = true;
      let head = episodes[0];
      let count = 0;
      const run = async () => {
        while (head?.prevEpisodeClipId && count < 5) {
          const prev = await prefetchEpisode(head.prevEpisodeClipId!);
          if (!prev) break;
          insertSorted(prev);
          head = prev;
          count++;
        }
        loadingPrevRef.current = false;
      };
      void run();
    }
  }, [activeEpIdx, episodes, prefetchEpisode, insertSorted]);

  useEffect(() => {
    if (activeEpIdx < episodes.length - 5) loadingNextRef.current = false;
    if (activeEpIdx > 4) loadingPrevRef.current = false;
  }, [activeEpIdx, episodes.length]);

  // Correct scroll when episodes array changes (prepend shifts indices)
  useLayoutEffect(() => {
    if (!activeClipId) return;
    const idx = episodes.findIndex((ep) => ep.id === activeClipId);
    if (idx < 0) return;
    const container = containerRef.current;
    if (!container || container.clientWidth === 0) return;
    const targetLeft = idx * container.clientWidth;
    if (Math.abs(container.scrollLeft - targetLeft) < 1) return;
    correctingRef.current = true;
    container.style.scrollSnapType = "none";
    container.scrollLeft = targetLeft;
    requestAnimationFrame(() => {
      if (container) container.style.scrollSnapType = "";
      // Use scrollend to release the guard, with a fallback timer
      const unlock = () => { correctingRef.current = false; };
      const timer = setTimeout(unlock, 300);
      container.addEventListener("scrollend", () => {
        clearTimeout(timer);
        unlock();
      }, { once: true });
    });
  }, [episodes, activeClipId]);

  // Sync scroll position when activeClipId changes from outside
  useLayoutEffect(() => {
    if (!isActiveRow || !activeClipId) return;
    const idx = episodes.findIndex((ep) => ep.id === activeClipId);
    if (idx < 0) return;
    const container = containerRef.current;
    if (!container || container.clientWidth <= 0) return;
    const targetLeft = idx * container.clientWidth;
    if (Math.abs(container.scrollLeft - targetLeft) < 1) return;
    lastReportedRef.current = activeClipId;
    correctingRef.current = true;
    container.style.scrollSnapType = "none";
    container.scrollLeft = targetLeft;
    requestAnimationFrame(() => {
      if (!container) return;
      container.style.scrollSnapType = "";
      container.scrollLeft = targetLeft;
      // Use scrollend to release the guard, with a fallback timer
      const unlock = () => { correctingRef.current = false; };
      const timer = setTimeout(unlock, 300);
      container.addEventListener("scrollend", () => {
        clearTimeout(timer);
        unlock();
      }, { once: true });
    });
  }, [isActiveRow, activeClipId, episodes]);

  // Report episode change to parent
  const reportEpisode = useCallback((clipId: string) => {
    if (lastReportedRef.current === clipId) return;
    lastReportedRef.current = clipId;
    onEpisodeChange(clipId, feedIndex);
  }, [onEpisodeChange, feedIndex]);

  // Horizontal scroll settle → detect episode
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const settle = () => {
      if (correctingRef.current) return;
      const w = container.clientWidth;
      if (w === 0) return;
      const idx = Math.max(0, Math.min(Math.round(container.scrollLeft / w), episodes.length - 1));
      const ep = episodes[idx];
      if (!ep) return;
      reportEpisode(ep.id);
    };

    if ("onscrollend" in window) {
      container.addEventListener("scrollend", settle);
      return () => container.removeEventListener("scrollend", settle);
    }
    let timer: ReturnType<typeof setTimeout>;
    const onScroll = () => { clearTimeout(timer); timer = setTimeout(settle, 80); };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => { clearTimeout(timer); container.removeEventListener("scroll", onScroll); };
  }, [episodes, reportEpisode]);

  // Navigate episodes (arrows / auto-advance)
  const scrollToEpisode = useCallback((direction: "prev" | "next") => {
    const container = containerRef.current;
    if (!container) return;
    let target = direction === "next" ? activeEpIdx + 1 : activeEpIdx - 1;
    if (target < 0) target = episodes.length - 1;
    else if (target >= episodes.length) {
      if (continueRef.current) { continueRef.current(); return; }
      target = 0;
    }
    if (target === activeEpIdx) return;
    container.scrollTo({ left: target * container.clientWidth, behavior: "smooth" });
    const ep = episodes[target];
    if (ep) reportEpisode(ep.id);
  }, [activeEpIdx, episodes, reportEpisode]);

  // Register this row element with the parent's IntersectionObserver
  const rowRefCallback = useCallback((el: HTMLElement | null) => {
    registerRowElement?.(feedIndex, el);
  }, [registerRowElement, feedIndex]);

  return (
    <div ref={rowRefCallback} className="h-full w-full shrink-0 snap-start snap-always" data-feed-index={feedIndex}>
      <div
        ref={containerRef}
        className="h-full w-full flex overflow-x-auto snap-x snap-mandatory scrollbar-hide overscroll-x-contain touch-pan-x touch-pan-y [-webkit-overflow-scrolling:touch]"
        onTouchStart={(e) => { touchStartXRef.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          const startX = touchStartXRef.current;
          touchStartXRef.current = null;
          if (startX === null) return;
          const dx = (e.changedTouches[0]?.clientX ?? startX) - startX;
          if (dx < -50 && activeEpIdx === episodes.length - 1 && continueRef.current) {
            continueRef.current();
          }
        }}
      >
        {episodes.map((ep, i) => {
          const isThisEpActive = isActiveRow && ep.id === activeClipId;
          return (
            <div key={ep.id} className="h-full w-full flex-none snap-start snap-always" data-clip-id={ep.id}>
              <ClipSlide
                clip={ep}
                index={feedIndex}
                isActive={isThisEpActive}
                isMuted={userMuted}
                isPlaying={isThisEpActive ? playingSet.has(ep.id) : false}
                progress={isThisEpActive ? (progressMap[ep.id] ?? 0) : 0}
                activeSpeaker={isThisEpActive ? (speakerMapRef.current.get(ep.id) ?? null) : null}
                likingClipId={likingClipId}
                copiedClipId={copiedClipId}
                exportError={exportError}
                deletingClipId={deletingClipId}
                actionMenuOpen={actionMenuOpen === ep.id}
                audioRef={getAudioCallback(ep.id)}
                subtitlesAudioRef={getSubtitleRef(ep.id)}
                onSeek={(pct) => handleSeek(ep.id, pct)}
                onSeekStart={() => handleSeekStart(ep.id)}
                onSeekEnd={() => handleSeekEnd(ep.id)}
                onToggleLike={() => void toggleLike(ep.id)}
                onCopyLink={() => void copyLink(ep.id)}
                onMuteToggle={() => handleMuteToggle(ep.id)}
                onTogglePlay={onTogglePlay}
                onPlay={() => {
                  // Play guard (Method B) handles pause of non-active clips automatically
                  if (ep.id !== activeClipIdRef.current) return;
                  setPlayingSet((prev) => new Set(prev).add(ep.id));
                  void trackEvent("clip_play_start", { clipId: ep.id, source: "clip_page" });
                }}
                onPause={() => {
                  setPlayingSet((prev) => { const s = new Set(prev); s.delete(ep.id); return s; });
                }}
                onEnded={() => {
                  setPlayingSet((prev) => { const s = new Set(prev); s.delete(ep.id); return s; });
                  void trackEvent("clip_play_complete", { clipId: ep.id, source: "clip_page" });
                  speakerMapRef.current.set(ep.id, null);

                  if (ep.seriesId) {
                    if (i < episodes.length - 1) {
                      scrollToEpisode("next");
                    } else if (continueRef.current) {
                      continueRef.current();
                    } else if (episodes.length > 1) {
                      const container = containerRef.current;
                      if (container) {
                        container.scrollTo({ left: 0, behavior: "smooth" });
                        const first = episodes[0];
                        if (first) reportEpisode(first.id);
                      }
                    } else {
                      if (ep.id !== activeClipIdRef.current) return;
                      const audio = audioMapRef.current.get(ep.id);
                      if (audio) {
                        audio.currentTime = 0;
                        void audio.play().catch(() => {});
                      }
                    }
                    return;
                  }

                  const nextFeedIndex = feedIndex + 1;
                  if (nextFeedIndex < rowCount) {
                    const root = feedRef.current;
                    if (root) {
                      const nextRow = root.querySelector<HTMLElement>(`[data-feed-index="${nextFeedIndex}"]`);
                      if (nextRow) nextRow.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                  }
                }}
                onTimeUpdate={(e) => {
                  const audio = e.currentTarget as HTMLAudioElement;
                  if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
                  if (seekingRef.current === ep.id) return;
                  setProgressMap((prev) => ({ ...prev, [ep.id]: (audio.currentTime / audio.duration) * 100 }));
                  if (ep.timingLines.length > 0) {
                    const t = audio.currentTime;
                    const cur = ep.timingLines.find(
                      (l) => typeof l.start === "number" && typeof l.end === "number" && t >= l.start && t <= l.end
                    );
                    speakerMapRef.current.set(ep.id, cur?.speaker ?? null);
                  }
                }}
                onActionMenuToggle={() => setActionMenuOpen((prev) => prev === ep.id ? null : ep.id)}
                canExport={canExport}
                onDeleteClip={() => void deleteClip(ep.id)}
                onExportShorts={() => void exportShorts(ep.id)}
                onNativeShare={() => void nativeShare(ep.id)}
                onNavigateEpisode={scrollToEpisode}
                continueRef={i === episodes.length - 1 ? continueRef : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

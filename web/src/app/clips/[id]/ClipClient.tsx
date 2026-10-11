"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { trackEvent } from "@/lib/analytics";
import { supabase } from "@/lib/supabaseClient";
import { SiteHeader } from "@/components/SiteHeader";
import { useJobQueue } from "@/components/JobQueueProvider";
import { setLastWatched } from "@/lib/watchHistory";
import { useClipFeed } from "./useClipFeed";
import { useClipActions } from "./useClipActions";
import { EpisodeRow } from "./EpisodeRow";
import { ClipFeedSkeleton } from "@/components/Skeleton";

export default function ClipClient({ id }: { id?: string }) {
  const t = useTranslations("clipViewer");
  const router = useRouter();
  const { addJob } = useJobQueue();
  const isFeedMode = id == null;

  // ── Data ──
  const { rows, setRows, loading, error, loadMore, prefetchEpisode, loadTimingForClip, refresh } = useClipFeed(id);

  // ── Core state ──
  const [activeRowIdx, setActiveRowIdx] = useState(0);
  const [activeClipId, rawSetActiveClipId] = useState<string | null>(id ?? null);
  const [userPaused, setUserPaused] = useState(false);
  const [progressMap, setProgressMap] = useState<Record<string, number>>({});
  const [playingSet, setPlayingSet] = useState<Set<string>>(new Set());
  const [canExport, setCanExport] = useState(false);

  // ── Refs ──
  const feedRef = useRef<HTMLDivElement>(null);
  const audioMapRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const speakerMapRef = useRef<Map<string, string | null>>(new Map());
  const activeClipIdRef = useRef<string | null>(id ?? null);
  const activeRowIdxRef = useRef(0);
  const rowsRef = useRef(rows);
  const userMutedRef = useRef(false);
  const userPausedRef = useRef(false);
  const rowEpisodeRef = useRef<Map<number, string>>(new Map());
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevPlayClipRef = useRef<string | null>(null);
  const seekingRef = useRef<string | null>(null);
  const animRef = useRef<{ active: boolean; frame: number | null }>({ active: false, frame: null });

  // Sync refs
  rowsRef.current = rows;
  activeRowIdxRef.current = activeRowIdx;
  userPausedRef.current = userPaused;

  const setActiveClipId = useCallback((clipId: string | null) => {
    if (clipId !== null) activeClipIdRef.current = clipId;
    // Method A: immediately pause all non-active audio (before next render)
    for (const [cid, a] of audioMapRef.current) {
      if (cid !== clipId && !a.paused) {
        try { a.pause(); a.currentTime = 0; } catch { /* detached */ }
      }
    }
    rawSetActiveClipId(clipId);
  }, []);

  // ── Actions ──
  const {
    actionMenuOpen, setActionMenuOpen, copiedClipId, exportError, deletingClipId, likingClipId,
    userMuted, setUserMuted, toggleLike, copyLink, nativeShare, deleteClip, exportShorts, handleMuteToggle,
  } = useClipActions({ clips: rows, setClips: setRows, setActiveClipId, addJob });
  userMutedRef.current = userMuted;

  // ── Subscription plan ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token || cancelled) return;
      try {
        const res = await fetch("/api/subscription/plan", { headers: { Authorization: `Bearer ${token}` } });
        const payload = (await res.json()) as { plan?: { canExportVideo?: boolean } };
        if (!cancelled) setCanExport(!!payload.plan?.canExportVideo);
      } catch { /* default false */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      for (const [, a] of audioMapRef.current) { try { a.pause(); a.currentTime = 0; } catch { /* */ } }
    };
  }, []);

  // ── AUDIO CONTROL ──
  // Note: pause-all-except-active is handled by:
  //   - Method A: setActiveClipId() immediately pauses all non-active audio
  //   - Method B: play guard on each <audio> prevents non-active clips from playing

  // Play active clip / pause on userPaused
  useEffect(() => {
    if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    if (!activeClipId) return;

    if (userPaused) {
      const audio = audioMapRef.current.get(activeClipId);
      if (audio && !audio.paused) audio.pause();
      return;
    }

    const clipId = activeClipId;
    const isNewClip = prevPlayClipRef.current !== clipId;

    const tryPlay = () => {
      if (userPausedRef.current || activeClipIdRef.current !== clipId) return;
      const audio = audioMapRef.current.get(clipId);
      if (!audio) {
        retryRef.current = setTimeout(tryPlay, 50);
        return;
      }
      prevPlayClipRef.current = clipId;
      audio.preload = "auto";
      audio.muted = userMutedRef.current;
      if (isNewClip) {
        audio.currentTime = 0;
        void trackEvent("clip_view", { clipId, source: "clip_page" });
      }
      // Play guard (Method B) will auto-pause if clip becomes inactive
      void audio.play().catch((e: unknown) => {
        if ((e as { name?: string })?.name === "NotAllowedError" && activeClipIdRef.current === clipId) {
          audio.muted = true;
          userMutedRef.current = true;
          setUserMuted(true);
          void audio.play().catch(() => {});
        }
      });
    };
    tryPlay();

    // Preload adjacent rows
    const idx = activeRowIdxRef.current;
    const rs = rowsRef.current;
    for (const d of [-1, 1]) {
      const adjIdx = idx + d;
      if (adjIdx >= 0 && adjIdx < rs.length) {
        const adj = rs[adjIdx];
        if (adj) {
          router.prefetch(`/clips/${encodeURIComponent(adj.id)}`);
          const a = audioMapRef.current.get(adj.id);
          if (a) a.preload = "auto";
          const remembered = rowEpisodeRef.current.get(adjIdx);
          if (remembered && remembered !== adj.id) {
            const ra = audioMapRef.current.get(remembered);
            if (ra) ra.preload = "auto";
          }
        }
      }
    }

    return () => { if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClipId, userPaused]);

  // Mute sync
  useEffect(() => {
    if (!activeClipId) return;
    const audio = audioMapRef.current.get(activeClipId);
    if (audio) audio.muted = userMuted;
  }, [userMuted, activeClipId]);

  // ── INTERSECTION OBSERVER + SCROLLEND — active row detection ──
  const observerRef = useRef<IntersectionObserver | null>(null);
  const activateRowRef = useRef<(idx: number) => void>(() => {});

  // Keep activateRow logic in a ref so the observer never needs to be recreated
  activateRowRef.current = (idx: number) => {
    if (idx === activeRowIdxRef.current) return;
    const clipId = rowEpisodeRef.current.get(idx) ?? rowsRef.current[idx]?.id;
    if (!clipId) return;
    // Skip if this clip is already active (prevents URL thrashing)
    if (clipId === activeClipIdRef.current) return;
    setActiveRowIdx(idx);
    activeRowIdxRef.current = idx;
    setUserPaused(false);
    userPausedRef.current = false;
    setActiveClipId(clipId);
    const newUrl = id
      ? `/clips/${encodeURIComponent(clipId)}`
      : `/clips/feed#${encodeURIComponent(clipId)}`;
    window.history.replaceState(null, "", newUrl);
  };

  // Callback to register/unregister row elements — observe immediately
  const setRowElement = useCallback((index: number, el: HTMLElement | null) => {
    if (el) {
      observerRef.current?.observe(el);
    }
  }, []);

  // Track whether user has actually scrolled (vs IO firing from observe/mount)
  const userScrolledRef = useRef(false);

  // Create observer once when feedRef is available
  useEffect(() => {
    const root = feedRef.current;
    if (!root) return;

    // Mark that user has scrolled — only then should IO/scrollend activate rows
    const onScrollStart = () => { userScrolledRef.current = true; };
    root.addEventListener("scroll", onScrollStart, { passive: true, once: true });

    const handleIntersect = (entries: IntersectionObserverEntry[]) => {
      if (!userScrolledRef.current || animRef.current.active) return;
      let bestIdx = -1;
      let bestRatio = 0;
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio > 0.5 && entry.intersectionRatio > bestRatio) {
          bestRatio = entry.intersectionRatio;
          bestIdx = Number(entry.target.getAttribute("data-feed-index"));
        }
      }
      if (bestIdx >= 0) activateRowRef.current(bestIdx);
    };

    const observer = new IntersectionObserver(handleIntersect, {
      root,
      threshold: [0.5, 0.75],
    });
    observerRef.current = observer;

    // scrollend fallback: after fast scroll or snap, re-check which row is snapped
    const onScrollEnd = () => {
      if (!userScrolledRef.current || animRef.current.active) return;
      const H = root.clientHeight;
      if (H <= 0) return;
      const row = Math.max(0, Math.min(Math.round(root.scrollTop / H), rowsRef.current.length - 1));
      activateRowRef.current(row);
    };
    root.addEventListener("scrollend", onScrollEnd);

    return () => {
      root.removeEventListener("scroll", onScrollStart);
      observer.disconnect();
      observerRef.current = null;
      root.removeEventListener("scrollend", onScrollEnd);
    };
    // Re-run only when loading changes (feedRef becomes available after loading=false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Initial active clip (once rows load)
  const initializedRef = useRef(false);
  useEffect(() => {
    if (rows.length === 0 || initializedRef.current) return;
    initializedRef.current = true;
    if (id) {
      const index = rows.findIndex((c) => c.id === id);
      if (index >= 0) {
        setActiveRowIdx(index);
        activeRowIdxRef.current = index;
        setActiveClipId(id);
        // Save watch history for series entry via link
        const clip = rows[index];
        if (clip?.seriesId) setLastWatched(clip.seriesId, id);
        // Scroll to entry clip position
        const root = feedRef.current;
        if (root && index > 0) {
          root.scrollTo({ top: index * root.clientHeight, behavior: "auto" });
        }
      }
    } else {
      setActiveRowIdx(0);
      activeRowIdxRef.current = 0;
      if (rows[0]) setActiveClipId(rows[0].id);
    }
  }, [rows, id, setActiveClipId]);

  // ── WHEEL (desktop) ──
  const smoothScrollTo = useCallback((targetTop: number, durationMs = 380) => {
    const root = feedRef.current;
    if (!root) return;
    if (animRef.current.frame != null) cancelAnimationFrame(animRef.current.frame);
    animRef.current.active = true;
    root.style.scrollSnapType = "none";
    const startTop = root.scrollTop;
    const delta = targetTop - startTop;
    if (Math.abs(delta) < 1) {
      root.style.scrollSnapType = "";
      animRef.current.active = false;
      return;
    }
    const startTime = performance.now();
    const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
    const tick = (now: number) => {
      const p = Math.min((now - startTime) / durationMs, 1);
      root.scrollTop = startTop + delta * ease(p);
      if (p < 1) {
        animRef.current.frame = requestAnimationFrame(tick);
      } else {
        root.scrollTop = targetTop;
        animRef.current = { active: false, frame: null };
        root.style.scrollSnapType = "";
      }
    };
    animRef.current.frame = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (loading || rows.length === 0) return;
    const root = feedRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (animRef.current.active || e.deltaY === 0) return;
      const dir = e.deltaY > 0 ? 1 : -1;
      const H = root.clientHeight;
      if (H <= 0) return;
      const cur = activeRowIdxRef.current;
      const next = Math.max(0, Math.min(rowsRef.current.length - 1, cur + dir));
      if (next !== cur) {
        setActiveRowIdx(next);
        activeRowIdxRef.current = next;
        setUserPaused(false);
        userPausedRef.current = false;
        const clipId = rowEpisodeRef.current.get(next) ?? rowsRef.current[next]?.id;
        if (clipId) {
          setActiveClipId(clipId);
          const newUrl = id ? `/clips/${encodeURIComponent(clipId)}` : `/clips/feed#${encodeURIComponent(clipId)}`;
          window.history.replaceState(null, "", newUrl);
        }
        smoothScrollTo(next * H);
      }
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [loading, rows.length, id, setActiveClipId, smoothScrollTo]);

  // ── EDGE LOADING (append-only) ──
  const loadMoreTriggeredRef = useRef(false);
  useEffect(() => {
    if (rows.length === 0) return;
    if (activeRowIdx >= rows.length - 3 && !loadMoreTriggeredRef.current) {
      loadMoreTriggeredRef.current = true;
      void loadMore(5);
    }
  }, [activeRowIdx, rows.length, loadMore]);

  useEffect(() => {
    if (activeRowIdx < rows.length - 5) loadMoreTriggeredRef.current = false;
  }, [activeRowIdx, rows.length]);

  // ── SEEK ──
  const handleSeekStart = useCallback((clipId: string) => { seekingRef.current = clipId; }, []);
  const handleSeekEnd = useCallback((clipId: string) => {
    setTimeout(() => { if (seekingRef.current === clipId) seekingRef.current = null; }, 150);
  }, []);
  const handleSeek = useCallback((clipId: string, pct: number) => {
    const clamped = Math.min(100, Math.max(0, pct));
    setProgressMap((prev) => ({ ...prev, [clipId]: clamped }));
    const audio = audioMapRef.current.get(clipId);
    if (!audio) {
      console.warn("[SEEK] audio not found in map for", clipId, "| map keys:", [...audioMapRef.current.keys()]);
      return;
    }
    let dur = audio.duration;
    if (!Number.isFinite(dur) || dur <= 0) {
      const clip = rowsRef.current.find((c) => c.id === clipId);
      dur = clip?.durationSec ?? 0;
    }
    const seekable = audio.seekable;
    const seekableRanges = [];
    for (let i = 0; i < seekable.length; i++) seekableRanges.push(`${seekable.start(i)}-${seekable.end(i)}`);
    const targetTime = (clamped / 100) * dur;
    console.log("[SEEK]", {
      clipId: clipId.slice(0, 8),
      pct: clamped.toFixed(1),
      dur,
      targetTime: targetTime.toFixed(2),
      currentTimeBefore: audio.currentTime.toFixed(2),
      seekable: seekableRanges.join(", ") || "NONE",
      paused: audio.paused,
      readyState: audio.readyState,
      src: audio.src?.slice(0, 80),
    });
    if (Number.isFinite(dur) && dur > 0) {
      audio.currentTime = targetTime;
      console.log("[SEEK] currentTime after set:", audio.currentTime.toFixed(2));
    } else {
      console.warn("[SEEK] duration invalid, seek skipped. dur=", dur);
    }
  }, []);

  // ── EPISODE CHANGE ──
  const handleEpisodeChange = useCallback((clipId: string, rowIdx: number) => {
    rowEpisodeRef.current.set(rowIdx, clipId);

    // Save watch history for series
    const row = rowsRef.current[rowIdx];
    const sid = row?.seriesId;
    if (sid) setLastWatched(sid, clipId);

    // Only activate clip + change URL if this is the currently active row
    if (rowIdx !== activeRowIdxRef.current) return;
    // Skip if already active (prevents URL thrashing)
    if (clipId === activeClipIdRef.current) return;
    setUserPaused(false);
    userPausedRef.current = false;
    setActiveClipId(clipId);
    const newUrl = id ? `/clips/${encodeURIComponent(clipId)}` : `/clips/feed#${encodeURIComponent(clipId)}`;
    window.history.replaceState(null, "", newUrl);
  }, [id, setActiveClipId]);

  // ── PULL TO REFRESH (feed mode) ──
  const [pullDelta, setPullDelta] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullStartRef = useRef({ y: 0, scrollTop: 0 });

  const handlePullStart = useCallback((e: React.TouchEvent) => {
    if (!isFeedMode || refreshing) return;
    pullStartRef.current = { y: e.touches[0].clientY, scrollTop: feedRef.current?.scrollTop ?? 0 };
    setPullDelta(0);
  }, [isFeedMode, refreshing]);

  const handlePullMove = useCallback((e: React.TouchEvent) => {
    if (!isFeedMode || refreshing) return;
    const root = feedRef.current;
    if (!root || root.scrollTop > 2) return;
    const delta = Math.max(0, e.touches[0].clientY - pullStartRef.current.y);
    if (delta > 0) { e.preventDefault(); setPullDelta(Math.min(delta, 120)); }
  }, [isFeedMode, refreshing]);

  const handlePullEnd = useCallback(async () => {
    if (!isFeedMode) return;
    const delta = pullDelta;
    setPullDelta(0);
    if (delta >= 72 && !refreshing) {
      setRefreshing(true);
      try { await refresh(); } finally { setRefreshing(false); }
    }
  }, [isFeedMode, pullDelta, refreshing, refresh]);

  // ── TOGGLE PLAY/PAUSE ──
  const handleTogglePlay = useCallback(() => {
    if (!activeClipId) return;
    const audio = audioMapRef.current.get(activeClipId);
    if (!audio) return;
    if (audio.paused) {
      setUserPaused(false);
      userPausedRef.current = false;
    } else {
      setUserPaused(true);
      userPausedRef.current = true;
      audio.pause();
      setPlayingSet(new Set());
    }
  }, [activeClipId]);

  // ── RENDER ──

  if (loading) {
    return (
      <div className="fixed inset-0 flex flex-col overflow-hidden bg-black text-zinc-100 lg-pl-sidebar">
        <SiteHeader />
        <div className="flex-1 min-h-0 w-full overflow-y-hidden scrollbar-hide"><ClipFeedSkeleton /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black text-zinc-100 lg-pl-sidebar">
        <SiteHeader />
        <div className="flex h-[100svh] items-center justify-center">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-black text-zinc-100 lg-pl-sidebar">
      <SiteHeader />
      <div className="relative flex-1 min-h-0 w-full">
        <div
          ref={feedRef}
          className="h-full min-h-0 w-full overflow-y-auto snap-y snap-mandatory scrollbar-hide overscroll-y-contain"
          style={{ overflowAnchor: "auto" }}
          onTouchStart={(e) => { if (isFeedMode) handlePullStart(e); }}
          onTouchMove={isFeedMode ? handlePullMove : undefined}
          onTouchEnd={() => { if (isFeedMode) void handlePullEnd(); }}
          onTouchCancel={() => { if (isFeedMode) void handlePullEnd(); }}
        >
          {isFeedMode && (pullDelta > 0 || refreshing) ? (
            <div
              className="flex shrink-0 items-center justify-center bg-black text-sm text-zinc-500 transition-[height] duration-75"
              style={{ height: Math.max(refreshing ? 56 : pullDelta, 0) }}
            >
              {refreshing ? t("refreshing") : pullDelta >= 72 ? t("releaseToRefresh") : t("pullToRefresh")}
            </div>
          ) : null}
          {rows.map((clip, index) => (
            <EpisodeRow
              key={clip.id}
              initialClip={clip}
              feedIndex={index}
              isActiveRow={index === activeRowIdx}
              activeClipId={activeClipId}
              activeClipIdRef={activeClipIdRef}
              onEpisodeChange={handleEpisodeChange}
              onTogglePlay={handleTogglePlay}
              prefetchEpisode={prefetchEpisode}
              loadTimingForClip={loadTimingForClip}
              audioMapRef={audioMapRef}
              speakerMapRef={speakerMapRef}
              seekingRef={seekingRef}
              progressMap={progressMap}
              setProgressMap={setProgressMap}
              playingSet={playingSet}
              setPlayingSet={setPlayingSet}
              userMuted={userMuted}
              feedRef={feedRef}
              rowCount={rows.length}
              handleSeek={handleSeek}
              handleSeekStart={handleSeekStart}
              handleSeekEnd={handleSeekEnd}
              toggleLike={toggleLike}
              copyLink={copyLink}
              handleMuteToggle={handleMuteToggle}
              deleteClip={deleteClip}
              exportShorts={exportShorts}
              nativeShare={nativeShare}
              likingClipId={likingClipId}
              copiedClipId={copiedClipId}
              exportError={exportError}
              deletingClipId={deletingClipId}
              actionMenuOpen={actionMenuOpen}
              setActionMenuOpen={setActionMenuOpen}
              canExport={canExport}
              registerRowElement={setRowElement}
            />
          ))}
        </div>
        {userMuted && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer"
            onClick={() => {
              setUserMuted(false);
              userMutedRef.current = false;
              for (const [, a] of audioMapRef.current) a.muted = false;
            }}
          >
            <div className="rounded-full bg-black/60 p-4 backdrop-blur-sm">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white" className="w-10 h-10">
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <line x1="23" y1="9" x2="17" y2="15" stroke="white" strokeWidth="2" strokeLinecap="round" />
                <line x1="17" y1="9" x2="23" y2="15" stroke="white" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getLastWatchedClipId } from "@/lib/watchHistory";
import { useLocaleSettings } from "@/components/LocaleProvider";
import type { ClipPayload, TimingLine, AgentInfo } from "@/types/clip";

export type ClipData = ClipPayload & {
  speakers: string[];
  timingLines: TimingLine[];
  agentInfos: AgentInfo[];
  isOwner: boolean;
  canDelete: boolean;
};

// ── Pure helpers ─────────────────────────────────────────────

function mergeUnique(prev: ClipData[], next: ClipData[]) {
  const map = new Map(prev.map((item) => [item.id, item]));
  for (const item of next) map.set(item.id, item);
  return Array.from(map.values());
}

function getSeriesId(c: ClipData | ClipPayload): string | null {
  return (c as ClipData).seriesId ?? (c as { series_id?: string }).series_id ?? null;
}

function normalizeTimingLines(lines: TimingLine[]): TimingLine[] {
  if (lines.length === 0) return lines;
  const get = (l: TimingLine, key: "start" | "end") => {
    const v = l[key] ?? (l as { start_sec?: number; end_sec?: number })[key === "start" ? "start_sec" : "end_sec"];
    return Number(v);
  };
  const withNumbers = lines.map((l) => {
    const start = get(l, "start");
    const end = get(l, "end");
    return { ...l, start: Number.isFinite(start) ? start : undefined, end: Number.isFinite(end) ? end : undefined };
  });
  const looksLikeMs = withNumbers.some(
    (l) => (typeof l.start === "number" && l.start > 1000) || (typeof l.end === "number" && l.end > 1000)
  );
  if (looksLikeMs) {
    return withNumbers.map((l) => ({
      ...l,
      start: typeof l.start === "number" ? l.start / 1000 : undefined,
      end: typeof l.end === "number" ? l.end / 1000 : undefined,
    }));
  }
  return withNumbers;
}

function extractTimingData(raw: unknown): { lines: TimingLine[]; agents: AgentInfo[]; speakers: string[] } {
  const rawLines: TimingLine[] = Array.isArray(raw) ? raw : ((raw as Record<string, unknown>)?.lines as TimingLine[] ?? []);
  const lines = normalizeTimingLines(rawLines);
  const agents: AgentInfo[] = ((raw as Record<string, unknown>)?.agents as AgentInfo[] ?? []).filter(
    (a: AgentInfo) => a.id !== "sfx" && a.id !== "narration"
  );
  const speakers: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const s = line?.speaker;
    if (typeof s === "string" && s && s !== "sfx" && s !== "narration" && !seen.has(s)) {
      seen.add(s);
      speakers.push(s);
    }
  }
  return { lines, agents, speakers };
}

async function enrichClip(
  clip: ClipPayload,
  headers: HeadersInit,
  userId?: string,
  opts?: { skipClipFetch?: boolean }
): Promise<ClipData> {
  try {
    let fullClip: ClipPayload = clip;
    if (!opts?.skipClipFetch) {
      const clipRes = await fetch(`/api/clips/${encodeURIComponent(clip.id)}`, { method: "GET", headers });
      const clipPayload = (await clipRes.json()) as { clip?: ClipPayload };
      fullClip = clipPayload.clip || clip;
    }
    const isOwner = userId && fullClip.ownerId === userId;
    let speakers: string[] = [];
    let timingLines: TimingLine[] = [];
    let agentInfos: AgentInfo[] = [];

    if (fullClip.timingUrl) {
      try {
        const timingRes = await fetch(fullClip.timingUrl, { method: "GET" });
        if (timingRes.ok) {
          const raw = await timingRes.json();
          const td = extractTimingData(raw);
          speakers = td.speakers;
          timingLines = td.lines;
          agentInfos = td.agents;
          const enriched = await Promise.all(
            agentInfos.map(async (agent) => {
              if (agent.dominant_color) return agent;
              try {
                const r = await fetch(`/api/agents/${encodeURIComponent(agent.id)}`, { method: "GET", headers });
                if (r.ok) {
                  const d = (await r.json()) as { agent?: { dominant_color?: string } };
                  if (d.agent?.dominant_color) return { ...agent, dominant_color: d.agent.dominant_color };
                }
              } catch { /* non-fatal */ }
              return agent;
            })
          );
          agentInfos = enriched;
        }
      } catch { /* non-fatal */ }
    }

    const canDelete = !!isOwner
      && !(fullClip.seriesId && fullClip.seriesOwnerId && fullClip.seriesOwnerId !== userId);
    return { ...fullClip, speakers, timingLines, agentInfos, isOwner: !!isOwner, canDelete } as ClipData;
  } catch {
    return { ...clip, speakers: [], timingLines: [], agentInfos: [], isOwner: false, canDelete: false } as ClipData;
  }
}

// ── Hook ─────────────────────────────────────────────────────

async function getAuth() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const userId = data.session?.user?.id;
  const headers: HeadersInit = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return { headers, userId };
}

export function useClipFeed(entryId?: string) {
  const { contentLanguages } = useLocaleSettings();
  const langParam = contentLanguages.length > 0 ? `&languages=${contentLanguages.join(",")}` : "";

  const [rows, setRows] = useState<ClipData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const poolRef = useRef<ClipPayload[]>([]);
  const rowsRef = useRef<ClipData[]>([]);
  const loadingDownRef = useRef(false);
  rowsRef.current = rows;

  const currentIds = useCallback(() => new Set(rowsRef.current.map((c) => c.id)), []);

  /** Collect all series IDs already present in the feed */
  const currentSeriesIds = useCallback(() => {
    const set = new Set<string>();
    for (const c of rowsRef.current) {
      const sid = getSeriesId(c);
      if (sid) set.add(sid);
    }
    return set;
  }, []);

  const fillPool = useCallback(async (headers: HeadersInit) => {
    if (poolRef.current.length > 0) return;
    try {
      const res = await fetch(`/api/clips?sort=random&limit=50${langParam}`, { method: "GET", headers });
      const payload = (await res.json()) as { clips?: ClipPayload[] };
      const ids = currentIds();
      const usedSeries = currentSeriesIds();
      // Keep one representative clip per series + all standalone clips
      const seriesSeen = new Set<string>();
      const deduped: ClipPayload[] = [];
      for (const c of payload.clips ?? []) {
        if (ids.has(c.id)) continue;
        const sid = getSeriesId(c);
        if (sid) {
          if (seriesSeen.has(sid) || usedSeries.has(sid)) continue;
          seriesSeen.add(sid);
        }
        deduped.push(c);
      }
      poolRef.current = deduped;
    } catch { /* non-fatal */ }
  }, [currentIds, currentSeriesIds, langParam]);

  // Cache: seriesId → episode 1 clip ID (avoids repeated /api/series calls)
  const ep1CacheRef = useRef<Map<string, string | null>>(new Map());

  /** Resolve the entry episode for a series: watch history → episode 1 → fallback */
  const resolveEntryClipId = useCallback(async (
    poolClip: ClipPayload,
    sid: string,
    headers: HeadersInit,
  ): Promise<string> => {
    // 1. Check watch history
    const lastWatched = getLastWatchedClipId(sid);
    if (lastWatched) return lastWatched;
    // 2. Check ep1 cache
    if (ep1CacheRef.current.has(sid)) {
      return ep1CacheRef.current.get(sid) ?? poolClip.id;
    }
    // 3. Fetch episode 1 from series API
    try {
      const r = await fetch(`/api/series/${encodeURIComponent(sid)}`, { method: "GET", headers });
      if (r.ok) {
        const d = (await r.json()) as { episodes?: { id: string }[] };
        const ep1Id = d.episodes?.[0]?.id ?? null;
        ep1CacheRef.current.set(sid, ep1Id);
        if (ep1Id) return ep1Id;
      }
    } catch { /* non-fatal */ }
    ep1CacheRef.current.set(sid, null);
    return poolClip.id;
  }, []);

  const takeOne = useCallback(
    async (dir: "up" | "down", usedSeriesIds: Set<string>, headers: HeadersInit, userId?: string): Promise<ClipData | null> => {
      const ids = currentIds();
      while (poolRef.current.length > 0) {
        const clip = dir === "down" ? poolRef.current.shift()! : poolRef.current.pop()!;
        if (ids.has(clip.id)) continue;
        const preSid = getSeriesId(clip);
        if (preSid && usedSeriesIds.has(preSid)) continue;

        // Resolve entry episode for series clips
        let targetClip = clip;
        if (preSid) {
          const targetId = await resolveEntryClipId(clip, preSid, headers);
          if (targetId !== clip.id) {
            targetClip = { id: targetId } as ClipPayload;
          }
        }

        try {
          const enriched = await enrichClip(targetClip, headers, userId);
          const sid = getSeriesId(enriched);
          if (sid && usedSeriesIds.has(sid)) continue;
          return enriched;
        } catch {
          // If enrichment fails (e.g. stale watch history clipId), fallback to pool clip
          if (targetClip.id !== clip.id) {
            try {
              const fallback = await enrichClip(clip, headers, userId);
              const sid = getSeriesId(fallback);
              if (sid && usedSeriesIds.has(sid)) continue;
              return fallback;
            } catch { continue; }
          }
          continue;
        }
      }
      return null;
    },
    [currentIds, resolveEntryClipId]
  );

  // ── Initial load ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);
    poolRef.current = [];

    (async () => {
      try {
        const { headers, userId } = await getAuth();

        if (entryId) {
          const res = await fetch(`/api/clips/${encodeURIComponent(entryId)}`, { method: "GET", headers });
          if (!res.ok) { if (!cancelled) { setError("Clip not found"); setLoading(false); } return; }
          const payload = (await res.json()) as { clip?: ClipPayload };
          if (!payload.clip) { if (!cancelled) { setError("Clip not found"); setLoading(false); } return; }
          const raw = payload.clip;

          const isOwner = !!(userId && raw.ownerId === userId);
          const minimal: ClipData = {
            ...raw, speakers: [], timingLines: [], agentInfos: [],
            isOwner,
            canDelete: isOwner && !(raw.seriesId && raw.seriesOwnerId && raw.seriesOwnerId !== userId),
          };
          if (cancelled) return;
          setRows([minimal]);
          setLoading(false);

          // Fast timing for subtitles
          if (raw.timingUrl) {
            try {
              const tRes = await fetch(raw.timingUrl, { method: "GET" });
              if (tRes.ok && !cancelled) {
                const tRaw = await tRes.json();
                const { lines, agents, speakers } = extractTimingData(tRaw);
                if (lines.length > 0) {
                  setRows((prev) => prev.map((c) =>
                    c.id === entryId ? { ...c, timingLines: lines, agentInfos: agents, speakers } : c
                  ));
                }
              }
            } catch { /* non-fatal */ }
          }

          // Full enrichment (agent colors etc.)
          const enriched = await enrichClip(raw, headers, userId, { skipClipFetch: true });
          if (cancelled) return;
          setRows((prev) => prev.map((c) => (c.id === entryId ? enriched : c)));

          // Load clips below only (append-only to avoid scroll position issues)
          await fillPool(headers);
          for (let i = 0; i < 4 && !cancelled; i++) {
            const clip = await takeOne("down", currentSeriesIds(), headers, userId);
            if (!clip || cancelled) break;
            setRows((prev) => mergeUnique(prev, [clip]));
          }
        } else {
          const res = await fetch(`/api/clips?sort=random&limit=50${langParam}`, { method: "GET", headers });
          const payload = (await res.json()) as { clips?: ClipPayload[] };
          const list = payload.clips ?? [];
          if (list.length === 0) throw new Error("No clips available");
          // Pick up to 5 clips, each from a distinct series
          const selected: ClipPayload[] = [];
          const usedSeries = new Set<string>();
          for (const c of list) {
            if (selected.length >= 5) break;
            const sid = getSeriesId(c);
            if (sid && usedSeries.has(sid)) continue;
            selected.push(c);
            if (sid) usedSeries.add(sid);
          }
          const enriched = await Promise.all(selected.map(async (c) => {
            const sid = getSeriesId(c);
            if (sid) {
              const targetId = await resolveEntryClipId(c, sid, headers);
              if (targetId !== c.id) {
                try {
                  return await enrichClip({ id: targetId } as ClipPayload, headers, userId);
                } catch {
                  return enrichClip(c, headers, userId);
                }
              }
            }
            return enrichClip(c, headers, userId);
          }));
          if (cancelled) return;
          setRows(enriched);
          const selectedIds = new Set(selected.map((s) => s.id));
          poolRef.current = list.filter((c) => !selectedIds.has(c.id));
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load clips");
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId, refreshKey]);

  // ── Load more (append-only) ──
  const loadMore = useCallback(async (count = 5): Promise<void> => {
    if (loadingDownRef.current) return;
    loadingDownRef.current = true;
    try {
      const { headers, userId } = await getAuth();
      for (let i = 0; i < count; i++) {
        if (poolRef.current.length === 0) {
          await fillPool(headers);
          if (poolRef.current.length === 0) break;
        }
        const clip = await takeOne("down", currentSeriesIds(), headers, userId);
        if (!clip) break;
        setRows((prev) => mergeUnique(prev, [clip]));
      }
    } catch { /* non-fatal */ }
    finally { loadingDownRef.current = false; }
  }, [fillPool, takeOne, currentSeriesIds]);

  // ── Episode prefetch cache ──
  const episodeCacheRef = useRef<Map<string, ClipData>>(new Map());
  const prefetchPromiseRef = useRef<Map<string, Promise<ClipData | null>>>(new Map());

  const prefetchEpisode = useCallback(async (clipId: string): Promise<ClipData | null> => {
    const cached = episodeCacheRef.current.get(clipId);
    if (cached) return cached;
    const existing = prefetchPromiseRef.current.get(clipId);
    if (existing) return existing;
    const promise = (async (): Promise<ClipData | null> => {
      try {
        const { headers, userId } = await getAuth();
        const stub: ClipPayload = { id: clipId } as ClipPayload;
        const enriched = await enrichClip(stub, headers, userId);
        episodeCacheRef.current.set(clipId, enriched);
        return enriched;
      } catch { return null; }
    })();
    prefetchPromiseRef.current.set(clipId, promise);
    try { return await promise; } finally { prefetchPromiseRef.current.delete(clipId); }
  }, []);

  const loadTimingForClip = useCallback(
    async (clipId: string): Promise<Pick<ClipData, "timingLines" | "agentInfos" | "speakers"> | null> => {
      try {
        const { headers } = await getAuth();
        const res = await fetch(`/api/clips/${encodeURIComponent(clipId)}`, { method: "GET", headers });
        const payload = (await res.json()) as { clip?: ClipPayload };
        const fullClip = payload.clip;
        if (!fullClip?.timingUrl) return null;
        const timingRes = await fetch(fullClip.timingUrl, { method: "GET" });
        if (!timingRes.ok) return null;
        const raw = await timingRes.json();
        const { lines, agents, speakers } = extractTimingData(raw);
        return { timingLines: lines, agentInfos: agents, speakers };
      } catch { return null; }
    },
    []
  );

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return { rows, setRows, loading, error, loadMore, prefetchEpisode, loadTimingForClip, refresh };
}

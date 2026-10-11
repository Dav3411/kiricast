"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceOption } from "@/types/agent";

/** Minimum number of voices to guarantee before allowing create. */
const MIN_VOICES = 5000;

export function useVoices() {
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const voicesRef = useRef<VoiceOption[]>([]);
  /** Resolves when all voice loading is complete. */
  const doneResolveRef = useRef<(() => void) | null>(null);
  const donePromiseRef = useRef<Promise<void> | null>(null);
  /** Resolves when at least MIN_VOICES are loaded (or loading finishes). */
  const minResolveRef = useRef<(() => void) | null>(null);
  const minPromiseRef = useRef<Promise<void> | null>(null);
  const minReachedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    minReachedRef.current = false;

    donePromiseRef.current = new Promise<void>((resolve) => {
      doneResolveRef.current = resolve;
    });
    minPromiseRef.current = new Promise<void>((resolve) => {
      minResolveRef.current = resolve;
    });

    async function loadVoices() {
      setLoading(true);
      try {
        const res = await fetch("/api/voices");
        const payload = (await res.json()) as { voices?: VoiceOption[]; has_more?: boolean };
        if (!cancelled && res.ok && Array.isArray(payload.voices)) {
          setVoices(payload.voices);
          voicesRef.current = payload.voices;
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }

      if (cancelled) {
        doneResolveRef.current?.();
        minResolveRef.current?.();
        return;
      }

      if (voicesRef.current.length >= MIN_VOICES && !minReachedRef.current) {
        minReachedRef.current = true;
        minResolveRef.current?.();
      }

      setLoadingMore(true);
      const seenIds = new Set(voicesRef.current.map((v) => v.voice_id));
      let total = voicesRef.current.length;
      let page = 0;
      while (!cancelled && page < 200) {
        try {
          const sRes = await fetch(`/api/voices/shared?page=${page}`);
          const sPayload = (await sRes.json()) as { voices?: VoiceOption[]; has_more?: boolean };
          if (!sRes.ok || !Array.isArray(sPayload.voices) || sPayload.voices.length === 0) break;
          const newVoices = sPayload.voices.filter((v) => {
            if (seenIds.has(v.voice_id)) return false;
            seenIds.add(v.voice_id);
            return true;
          });
          if (newVoices.length > 0 && !cancelled) {
            setVoices((prev) => [...prev, ...newVoices]);
            total += newVoices.length;
          }
          if (total >= MIN_VOICES && !minReachedRef.current) {
            minReachedRef.current = true;
            minResolveRef.current?.();
          }
          if (!sPayload.has_more) break;
          page++;
        } catch {
          break;
        }
      }
      if (!cancelled) setLoadingMore(false);
      // Loading done — resolve both promises
      if (!minReachedRef.current) {
        minReachedRef.current = true;
        minResolveRef.current?.();
      }
      doneResolveRef.current?.();
    }

    loadVoices();
    return () => {
      cancelled = true;
      doneResolveRef.current?.();
      if (!minReachedRef.current) minResolveRef.current?.();
    };
  }, []);

  /**
   * Wait until at least MIN_VOICES (5000) are loaded, or loading finishes,
   * whichever comes first. A timeout ensures we never block forever.
   * If timeout expires, proceeds with whatever voices are loaded so far.
   */
  const waitForVoices = useCallback(async (timeoutMs = 10000): Promise<void> => {
    if (!minPromiseRef.current) return;
    await Promise.race([
      minPromiseRef.current,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }, []);

  return { voices, loading, loadingMore, waitForVoices };
}

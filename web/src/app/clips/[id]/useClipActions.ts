"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { trackEvent } from "@/lib/analytics";
import type { ClipData } from "./useClipFeed";
import type { QueuedJob } from "@/components/JobQueueProvider";

type UseClipActionsParams = {
  clips: ClipData[];
  setClips: React.Dispatch<React.SetStateAction<ClipData[]>>;
  setActiveClipId: (id: string | null) => void;
  addJob: (job: Pick<QueuedJob, "id" | "kind" | "name">) => void;
};

export function useClipActions({
  clips,
  setClips,
  setActiveClipId,
  addJob,
}: UseClipActionsParams) {
  const clipsRef = useRef(clips);
  clipsRef.current = clips;

  const [actionMenuOpen, setActionMenuOpen] = useState<string | null>(null);
  const [copiedClipId, setCopiedClipId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null);
  const [likingClipId, setLikingClipId] = useState<string | null>(null);

  // Close action menu on outside click
  useEffect(() => {
    if (!actionMenuOpen) return;
    const close = () => setActionMenuOpen(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [actionMenuOpen]);

  const toggleLike = useCallback(
    async (clipId: string) => {
      if (likingClipId) return;

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        alert("Please sign in.");
        return;
      }

      setLikingClipId(clipId);
      try {
        const current = clipsRef.current.find((clip) => clip.id === clipId);
        const nextLike = !(current?.liked ?? false);

        const res = await fetch(
          `/api/clips/${encodeURIComponent(clipId)}/like`,
          {
            method: nextLike ? "POST" : "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        const payload = (await res.json()) as {
          liked?: boolean;
          likeCount?: number;
          error?: string;
        };
        if (!res.ok) {
          alert(payload.error ?? "Failed to update like");
          return;
        }

        setClips((prev) =>
          prev.map((clip) =>
            clip.id === clipId
              ? {
                  ...clip,
                  liked: !!payload.liked,
                  likeCount:
                    typeof payload.likeCount === "number"
                      ? payload.likeCount
                      : (clip.likeCount ?? 0),
                }
              : clip
          )
        );
      } catch {
        alert("Failed to update like.");
      } finally {
        setLikingClipId(null);
      }
    },
    [likingClipId, setClips]
  );

  const copyLink = useCallback(async (clipId: string) => {
    try {
      const url = `${window.location.origin}/clips/${encodeURIComponent(clipId)}`;
      await navigator.clipboard.writeText(url);
      setCopiedClipId(clipId);
      window.setTimeout(() => setCopiedClipId(null), 1200);
      void trackEvent("share_complete", { clipId, method: "copy" });
    } catch {
      // ignore
    }
  }, []);

  const nativeShare = useCallback(
    async (clipId: string) => {
      try {
        const clip = clipsRef.current.find((c) => c.id === clipId);
        const url = `${window.location.origin}/clips/${encodeURIComponent(clipId)}`;
        if (!navigator.share) return;
        await navigator.share({ title: clip?.title ?? "Clip", url });
        void trackEvent("share_complete", { clipId, method: "native" });
      } catch {
        // ignore
      }
    },
    []
  );

  const deleteClip = useCallback(
    async (clipId: string) => {
      if (!window.confirm("Delete this clip?")) return;

      setDeletingClipId(clipId);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          alert("Please sign in.");
          return;
        }

        const res = await fetch(
          `/api/clips/${encodeURIComponent(clipId)}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          }
        );

        if (!res.ok) {
          const payload = (await res
            .json()
            .catch(() => ({ error: "Delete failed" }))) as {
            error?: string;
          };
          alert(payload.error || "Failed to delete.");
          return;
        }

        void trackEvent("clip_delete", { clipId });

        const currentClips = clipsRef.current;
        const idx = currentClips.findIndex((c) => c.id === clipId);
        setClips((prev) => prev.filter((c) => c.id !== clipId));

        if (idx >= 0 && currentClips.length > 1) {
          const nextClip = currentClips[idx + 1] || currentClips[idx - 1];
          if (nextClip) setActiveClipId(nextClip.id);
        } else {
          const userId = sessionData.session?.user?.id;
          window.location.href = userId ? `/users/${userId}` : "/";
        }
      } catch {
        alert("Failed to delete.");
      } finally {
        setDeletingClipId(null);
      }
    },
    [setClips, setActiveClipId]
  );

  const exportShorts = useCallback(
    async (clipId: string) => {
      setExportError(null);
      try {
        void trackEvent("export_shorts_start", { clipId });

        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) throw new Error("Please sign in to export shorts");

        const res = await fetch("/api/clips/export-shorts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ clipId }),
        });

        const payload = (await res.json().catch(() => ({ error: "Export failed" }))) as {
          jobId?: string;
          error?: string;
        };
        if (!res.ok || !payload.jobId) {
          throw new Error(payload.error || "Export failed");
        }

        const clip = clipsRef.current.find((c) => c.id === clipId);
        addJob({
          id: payload.jobId,
          kind: "export_shorts",
          name: clip?.title ?? "Export",
        });

        void trackEvent("export_shorts_queued", { clipId, jobId: payload.jobId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Export failed";
        setExportError(msg);
        void trackEvent("export_shorts_error", { clipId, error: msg });
      }
    },
    [addJob]
  );

  /** 전역 음소거: true면 모든 클립 음소거, false면 모든 클립 소리 on. 클립 전환 시에도 유지. */
  const [userMuted, setUserMuted] = useState(false);
  const handleMuteToggle = useCallback((_clipId: string) => {
    setUserMuted((prev) => !prev);
  }, []);

  return {
    actionMenuOpen,
    setActionMenuOpen,
    copiedClipId,
    exportError,
    deletingClipId,
    likingClipId,
    userMuted,
    setUserMuted,
    toggleLike,
    copyLink,
    nativeShare,
    deleteClip,
    exportShorts,
    handleMuteToggle,
  };
}

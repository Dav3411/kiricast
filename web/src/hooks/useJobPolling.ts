"use client";

import { useEffect, useState } from "react";

export type JobStatusBase = {
  job?: {
    id: string;
    status: "queued" | "processing" | "succeeded" | "failed";
    progress: number | null;
    error: string | null;
    result?: unknown;
    [key: string]: unknown;
  };
  error?: string;
  [key: string]: unknown;
};

type UseJobPollingOptions<T extends JobStatusBase> = {
  jobId: string | null;
  enabled: boolean;
  fetchWithAuth: (input: string, init: RequestInit) => Promise<Response>;
  onSuccess?: (payload: T) => void;
  onFailure?: (payload: T) => void;
  onError?: (error: Error) => void;
  intervalMs?: number;
};

export function useJobPolling<T extends JobStatusBase = JobStatusBase>({
  jobId,
  enabled,
  fetchWithAuth,
  onSuccess,
  onFailure,
  onError,
  intervalMs = 2000,
}: UseJobPollingOptions<T>) {
  const [jobStatus, setJobStatus] = useState<T | null>(null);

  useEffect(() => {
    if (!jobId || !enabled) return;
    let cancelled = false;
    let timeoutId: number | null = null;

    async function poll() {
      if (cancelled) return;
      try {
        const res = await fetchWithAuth(`/api/jobs/${jobId}`, { method: "GET" });
        const payload = (await res.json()) as T;
        if (!res.ok) {
          throw new Error(payload.error || "Failed to fetch job");
        }
        if (!cancelled) setJobStatus(payload);

        const status = payload.job?.status;
        if (status !== "succeeded" && status !== "failed") {
          timeoutId = window.setTimeout(poll, intervalMs);
          return;
        }
        if (status === "succeeded") onSuccess?.(payload);
        if (status === "failed") onFailure?.(payload);
      } catch (e) {
        if (!cancelled) onError?.(e instanceof Error ? e : new Error("Poll error"));
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [jobId, enabled, fetchWithAuth, onSuccess, onFailure, onError, intervalMs]);

  return { jobStatus, setJobStatus };
}

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminNavTabs } from "@/components/AdminNavTabs";
import { useAuth } from "@/components/AuthProvider";

const PAGE_SIZE = 20;

type ClipItem = { id: string; title: string };
type SeriesItem = { id: string; title: string };

export default function AdminContentPage() {
  const router = useRouter();
  const { user, session, loading: authLoading } = useAuth();
  const [adminSecret, setAdminSecret] = useState("");
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [series, setSeries] = useState<SeriesItem[]>([]);
  const [totalClips, setTotalClips] = useState<number | null>(null);
  const [totalSeries, setTotalSeries] = useState<number | null>(null);
  const [clipOffset, setClipOffset] = useState(0);
  const [seriesOffset, setSeriesOffset] = useState(0);
  const [clipLoading, setClipLoading] = useState(false);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null);
  const [deletingSeriesId, setDeletingSeriesId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user && typeof window !== "undefined") {
      const next = window.location.pathname || "/admin/content";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [authLoading, user, router]);

  const authHeaders = useCallback(() => {
    const h: Record<string, string> = { "x-admin-secret": adminSecret };
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    return h;
  }, [adminSecret, session?.access_token]);

  const loadClips = useCallback(async () => {
    if (!adminSecret || !session?.access_token) return;
    setClipLoading(true);
    setListError(null);
    try {
      const res = await fetch(
        `/api/admin/content/clips?limit=${PAGE_SIZE}&offset=${clipOffset}`,
        { headers: authHeaders() }
      );
      const data = (await res.json()) as { clips?: ClipItem[]; total?: number; error?: string };
      if (!res.ok) {
        setListError(data.error ?? "클립 목록 로드 실패");
        setClips([]);
        return;
      }
      setClips(data.clips ?? []);
      setTotalClips(data.total ?? null);
    } catch {
      setListError("클립 목록 로드 실패");
      setClips([]);
    } finally {
      setClipLoading(false);
    }
  }, [adminSecret, session?.access_token, clipOffset, authHeaders]);

  const loadSeries = useCallback(async () => {
    if (!adminSecret || !session?.access_token) return;
    setSeriesLoading(true);
    setListError(null);
    try {
      const res = await fetch(
        `/api/admin/content/series?limit=${PAGE_SIZE}&offset=${seriesOffset}`,
        { headers: authHeaders() }
      );
      const data = (await res.json()) as { series?: SeriesItem[]; total?: number; error?: string };
      if (!res.ok) {
        setListError(data.error ?? "시리즈 목록 로드 실패");
        setSeries([]);
        return;
      }
      setSeries(data.series ?? []);
      setTotalSeries(data.total ?? null);
    } catch {
      setListError("시리즈 목록 로드 실패");
      setSeries([]);
    } finally {
      setSeriesLoading(false);
    }
  }, [adminSecret, session?.access_token, seriesOffset, authHeaders]);

  useEffect(() => {
    if (adminSecret && session?.access_token) {
      loadClips();
    } else {
      setClips([]);
      setTotalClips(null);
    }
  }, [adminSecret, session?.access_token, clipOffset, loadClips]);

  useEffect(() => {
    if (adminSecret && session?.access_token) {
      loadSeries();
    } else {
      setSeries([]);
      setTotalSeries(null);
    }
  }, [adminSecret, session?.access_token, seriesOffset, loadSeries]);

  async function deleteClip(id: string) {
    setDeletingClipId(id);
    setListError(null);
    try {
      const res = await fetch(`/api/clips/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const payload = (await res.json()) as { error?: string };
      if (res.status === 401 || res.status === 403) {
        setListError("권한이 없습니다. Admin secret 및 ADMIN_USER_IDS를 확인하세요.");
        return;
      }
      if (!res.ok) throw new Error(payload.error ?? "클립 삭제 실패");
      setClips((prev) => prev.filter((c) => c.id !== id));
      if (totalClips != null) setTotalClips(totalClips - 1);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "클립 삭제 실패");
    } finally {
      setDeletingClipId(null);
    }
  }

  async function deleteSeries(id: string) {
    setDeletingSeriesId(id);
    setListError(null);
    try {
      const res = await fetch(`/api/series/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      const payload = (await res.json()) as { error?: string };
      if (res.status === 401 || res.status === 403) {
        setListError("권한이 없습니다. Admin secret 및 ADMIN_USER_IDS를 확인하세요.");
        return;
      }
      if (!res.ok) throw new Error(payload.error ?? "시리즈 삭제 실패");
      setSeries((prev) => prev.filter((s) => s.id !== id));
      if (totalSeries != null) setTotalSeries(totalSeries - 1);
    } catch (e) {
      setListError(e instanceof Error ? e.message : "시리즈 삭제 실패");
    } finally {
      setDeletingSeriesId(null);
    }
  }

  const clipPage = Math.floor(clipOffset / PAGE_SIZE) + 1;
  const clipTotalPages = totalClips != null ? Math.max(1, Math.ceil(totalClips / PAGE_SIZE)) : 0;
  const seriesPage = Math.floor(seriesOffset / PAGE_SIZE) + 1;
  const seriesTotalPages = totalSeries != null ? Math.max(1, Math.ceil(totalSeries / PAGE_SIZE)) : 0;

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-emerald-100 text-zinc-900 flex items-center justify-center">
        <div className="text-zinc-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="admin-pages min-h-screen bg-emerald-100 text-zinc-900">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="rounded-xl bg-zinc-800 px-4 py-3 mb-6">
          <div className="text-2xl font-semibold text-white">Admin · 클립·시리즈 삭제</div>
          <div className="mt-2 text-sm text-zinc-300">
            제목으로 목록을 불러온 뒤 항목을 선택해 삭제합니다. Admin secret + ADMIN_USER_IDS 필요.
          </div>
        </div>

        <AdminNavTabs current="content" />

        <div className="space-y-6 rounded-3xl border-2 border-emerald-400 bg-emerald-50 p-6 text-zinc-900 shadow-md">
          <div>
            <label className="block text-sm font-medium text-zinc-800">Admin secret</label>
            <input
              className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400"
              value={adminSecret}
              onChange={(e) => setAdminSecret(e.target.value)}
              placeholder="ADMIN_CREDITS_SECRET"
            />
          </div>

          {listError && (
            <div className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800">{listError}</div>
          )}

          {/* 클립 목록 */}
          <div className="rounded-xl border border-emerald-200 bg-white p-4">
            <h2 className="text-lg font-semibold text-zinc-800 mb-2">
              클립 {totalClips != null && `(총 ${totalClips}건)`}
            </h2>
            {clipLoading ? (
              <p className="text-sm text-zinc-500 py-4">불러오는 중…</p>
            ) : !adminSecret || !session?.access_token ? (
              <p className="text-sm text-zinc-500 py-4">Admin secret을 입력하면 목록을 불러옵니다.</p>
            ) : clips.length === 0 ? (
              <p className="text-sm text-zinc-500 py-4">클립이 없습니다.</p>
            ) : (
              <>
                <ul className="space-y-1.5 max-h-[320px] overflow-y-auto">
                  {clips.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-emerald-50/80 border border-transparent hover:border-emerald-200"
                    >
                      <span className="flex-1 min-w-0 text-sm text-zinc-800 truncate" title={c.title}>
                        {c.title || "(제목 없음)"}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded px-2 py-1 text-xs font-medium bg-red-100 text-red-800 hover:bg-red-200 disabled:opacity-50"
                        disabled={deletingClipId === c.id}
                        onClick={() => void deleteClip(c.id)}
                      >
                        {deletingClipId === c.id ? "삭제 중…" : "삭제"}
                      </button>
                    </li>
                  ))}
                </ul>
                {clipTotalPages > 1 && (
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <button
                      type="button"
                      className="rounded px-3 py-1.5 bg-emerald-100 text-emerald-800 hover:bg-emerald-200 disabled:opacity-50"
                      disabled={clipOffset === 0}
                      onClick={() => setClipOffset((o) => Math.max(0, o - PAGE_SIZE))}
                    >
                      이전
                    </button>
                    <span className="text-zinc-600">
                      {clipPage} / {clipTotalPages}
                    </span>
                    <button
                      type="button"
                      className="rounded px-3 py-1.5 bg-emerald-100 text-emerald-800 hover:bg-emerald-200 disabled:opacity-50"
                      disabled={clipOffset + PAGE_SIZE >= (totalClips ?? 0)}
                      onClick={() => setClipOffset((o) => o + PAGE_SIZE)}
                    >
                      다음
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* 시리즈 목록 */}
          <div className="rounded-xl border border-emerald-200 bg-white p-4">
            <h2 className="text-lg font-semibold text-zinc-800 mb-2">
              시리즈 {totalSeries != null && `(총 ${totalSeries}건)`}
            </h2>
            {seriesLoading ? (
              <p className="text-sm text-zinc-500 py-4">불러오는 중…</p>
            ) : !adminSecret || !session?.access_token ? (
              <p className="text-sm text-zinc-500 py-4">Admin secret을 입력하면 목록을 불러옵니다.</p>
            ) : series.length === 0 ? (
              <p className="text-sm text-zinc-500 py-4">시리즈가 없습니다.</p>
            ) : (
              <>
                <ul className="space-y-1.5 max-h-[320px] overflow-y-auto">
                  {series.map((s) => (
                    <li
                      key={s.id}
                      className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-emerald-50/80 border border-transparent hover:border-emerald-200"
                    >
                      <span className="flex-1 min-w-0 text-sm text-zinc-800 truncate" title={s.title}>
                        {s.title || "(제목 없음)"}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 rounded px-2 py-1 text-xs font-medium bg-red-100 text-red-800 hover:bg-red-200 disabled:opacity-50"
                        disabled={deletingSeriesId === s.id}
                        onClick={() => void deleteSeries(s.id)}
                      >
                        {deletingSeriesId === s.id ? "삭제 중…" : "삭제"}
                      </button>
                    </li>
                  ))}
                </ul>
                {seriesTotalPages > 1 && (
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <button
                      type="button"
                      className="rounded px-3 py-1.5 bg-emerald-100 text-emerald-800 hover:bg-emerald-200 disabled:opacity-50"
                      disabled={seriesOffset === 0}
                      onClick={() => setSeriesOffset((o) => Math.max(0, o - PAGE_SIZE))}
                    >
                      이전
                    </button>
                    <span className="text-zinc-600">
                      {seriesPage} / {seriesTotalPages}
                    </span>
                    <button
                      type="button"
                      className="rounded px-3 py-1.5 bg-emerald-100 text-emerald-800 hover:bg-emerald-200 disabled:opacity-50"
                      disabled={seriesOffset + PAGE_SIZE >= (totalSeries ?? 0)}
                      onClick={() => setSeriesOffset((o) => o + PAGE_SIZE)}
                    >
                      다음
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

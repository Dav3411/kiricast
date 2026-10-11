"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AdminNavTabs, type AdminTabId } from "@/components/AdminNavTabs";
import { useAuth } from "@/components/AuthProvider";

function AdminAccountsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get("tab");
  const currentTab: AdminTabId =
    tabParam === "plan" ? "accounts-plan" : "accounts-delete";

  const { user, session, loading: authLoading } = useAuth();
  const [adminSecret, setAdminSecret] = useState("");
  const [userId, setUserId] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [planUserId, setPlanUserId] = useState("");
  const [planId, setPlanId] = useState<string>("starter");
  const [periodDays, setPeriodDays] = useState<string>("30");
  const [planResult, setPlanResult] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planSubmitting, setPlanSubmitting] = useState(false);

  const CONFIRM_PHRASE = "DELETE";

  useEffect(() => {
    if (authLoading) return;
    if (!user && typeof window !== "undefined") {
      const next = window.location.pathname || "/admin/accounts";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [authLoading, user, router]);

  const authHeaders = () => {
    const h: Record<string, string> = { "x-admin-secret": adminSecret };
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    return h;
  };

  async function deleteAccount() {
    if (!session?.access_token) {
      setError("로그인이 필요합니다.");
      return;
    }
    if (confirmText.trim() !== CONFIRM_PHRASE) {
      setError(`확인하려면 "${CONFIRM_PHRASE}"를 정확히 입력하세요.`);
      return;
    }
    const uid = userId.trim();
    if (!uid) {
      setError("삭제할 유저 UUID를 입력하세요.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/accounts/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ userId: uid }),
      });
      if (res.status === 401 || res.status === 403) {
        setError("권한이 없습니다. Admin secret 또는 로그인을 확인하세요.");
        setSubmitting(false);
        return;
      }
      const payload = (await res.json()) as { error?: string; ok?: boolean; userId?: string };
      if (!res.ok) {
        throw new Error(payload.error ?? "계정 삭제 실패");
      }
      setResult(`계정이 삭제되었습니다: ${payload.userId ?? uid}`);
      setUserId("");
      setConfirmText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "계정 삭제 실패");
    } finally {
      setSubmitting(false);
    }
  }

  async function changePlan() {
    if (!session?.access_token) {
      setPlanError("로그인이 필요합니다.");
      return;
    }
    const uid = planUserId.trim();
    if (!uid) {
      setPlanError("유저 UUID를 입력하세요.");
      return;
    }
    const days = Math.min(365, Math.max(1, parseInt(periodDays, 10) || 30));
    setPlanSubmitting(true);
    setPlanError(null);
    setPlanResult(null);
    try {
      const res = await fetch("/api/admin/accounts/plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ userId: uid, planId: planId.trim().toLowerCase(), periodDays: days }),
      });
      if (res.status === 401 || res.status === 403) {
        setPlanError("권한이 없습니다. Admin secret 또는 로그인을 확인하세요.");
        setPlanSubmitting(false);
        return;
      }
      const payload = (await res.json()) as {
        error?: string;
        ok?: boolean;
        planId?: string;
        periodEndsAt?: string;
      };
      if (!res.ok) {
        throw new Error(payload.error ?? "플랜 변경 실패");
      }
      setPlanResult(
        `플랜 변경됨: ${payload.planId ?? planId} (종료일: ${payload.periodEndsAt ?? "-"})`
      );
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : "플랜 변경 실패");
    } finally {
      setPlanSubmitting(false);
    }
  }

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
          <div className="text-2xl font-semibold text-white">Admin · 계정</div>
          <div className="mt-2 text-sm text-zinc-300">
            계정 삭제 또는 유저 구독 플랜 변경. 탭으로 전환하세요.
          </div>
        </div>

        <AdminNavTabs current={currentTab} />

        <div className="space-y-4 rounded-3xl border-2 border-emerald-400 bg-emerald-50 p-6 text-zinc-900 shadow-md">
          <div>
            <label className="block text-sm font-medium text-zinc-800">Admin secret</label>
            <input
              className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400"
              value={adminSecret}
              onChange={(e) => setAdminSecret(e.target.value)}
              placeholder="ADMIN_CREDITS_SECRET"
            />
          </div>

          {currentTab === "accounts-delete" && (
            <>
              <div>
                <label className="block text-sm font-medium text-zinc-800">삭제할 유저 UUID</label>
                <input
                  className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-zinc-900 font-mono text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  placeholder="예: 00000000-0000-4000-8000-000000000000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-800">
                  확인: <span className="font-mono text-amber-700">{CONFIRM_PHRASE}</span> 입력
                </label>
                <input
                  className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-400"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={CONFIRM_PHRASE}
                />
              </div>
              <button
                type="button"
                className="w-full rounded-xl bg-red-100 px-4 py-3 font-semibold text-red-800 shadow-sm hover:bg-red-200 disabled:opacity-50"
                disabled={submitting || confirmText.trim() !== CONFIRM_PHRASE || !userId.trim()}
                onClick={deleteAccount}
              >
                {submitting ? "삭제 중…" : "계정 삭제"}
              </button>
              {result ? <div className="text-sm text-emerald-800 font-medium">{result}</div> : null}
              {error ? <div className="text-sm text-red-600">{error}</div> : null}
            </>
          )}

          {currentTab === "accounts-plan" && (
            <>
              <div className="font-medium text-zinc-800">유저 플랜 변경</div>
              <div>
                <label className="block text-sm font-medium text-zinc-800">유저 UUID</label>
                <input
                  className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-zinc-900 font-mono text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400"
                  value={planUserId}
                  onChange={(e) => setPlanUserId(e.target.value)}
                  placeholder="예: 00000000-0000-4000-8000-000000000000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-800">플랜</label>
                <select
                  className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400"
                  value={planId}
                  onChange={(e) => setPlanId(e.target.value)}
                >
                  <option value="starter">Starter</option>
                  <option value="plus">Plus</option>
                  <option value="pro">Pro</option>
                  <option value="ultra">Ultra</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-800">구독 종료일 (오늘 기준 일수, 1~365)</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  className="mt-1 w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-400"
                  value={periodDays}
                  onChange={(e) => setPeriodDays(e.target.value)}
                  placeholder="30"
                />
              </div>
              <button
                type="button"
                className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                disabled={planSubmitting || !planUserId.trim()}
                onClick={changePlan}
              >
                {planSubmitting ? "변경 중…" : "플랜 변경"}
              </button>
              {planResult ? (
                <div className="text-sm text-emerald-800 font-medium">{planResult}</div>
              ) : null}
              {planError ? <div className="text-sm text-red-600">{planError}</div> : null}
            </>
          )}
        </div>

        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center px-3 py-2 rounded-lg border border-emerald-400 bg-white text-sm font-medium text-zinc-800 hover:bg-emerald-50"
          >
            홈으로
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function AdminAccountsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-zinc-500">Loading...</div>}>
      <AdminAccountsPageContent />
    </Suspense>
  );
}

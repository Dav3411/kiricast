"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminNavTabs } from "@/components/AdminNavTabs";
import { useAuth } from "@/components/AuthProvider";

type PlanId = "starter" | "plus" | "pro" | "ultra";

type MonthRow = {
  month: string;
  plans: Record<PlanId, { count: number; amountUsd: number }>;
  totalCount: number;
  totalUsd: number;
};

type ApiResponse = { months?: MonthRow[]; error?: string };

const PLAN_LABELS: Record<PlanId, string> = {
  starter: "Starter",
  plus: "Plus",
  pro: "Pro",
  ultra: "Ultra",
};

export default function AdminPlanPaymentsPage() {
  const router = useRouter();
  const { user, session, loading: authLoading } = useAuth();
  const [adminSecret, setAdminSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MonthRow[] | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user && typeof window !== "undefined") {
      const next = typeof window !== "undefined" ? window.location.pathname || "/admin/plan-payments" : "/admin/plan-payments";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [authLoading, user, router]);

  const authHeaders = useCallback(() => {
    const h: Record<string, string> = { "x-admin-secret": adminSecret };
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    return h;
  }, [adminSecret, session?.access_token]);

  const load = useCallback(async () => {
    if (!adminSecret.trim() || !session?.access_token) {
      setError("Admin secret와 로그인이 필요합니다.");
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch("/api/admin/stats/plan-payments", {
        headers: authHeaders(),
      });
      if (res.status === 401 || res.status === 403) {
        setError("권한이 없습니다. Admin secret 또는 로그인을 확인하세요.");
        setLoading(false);
        return;
      }
      const json = (await res.json()) as ApiResponse;
      if (!res.ok) {
        setError(json.error ?? "Failed to load");
        setLoading(false);
        return;
      }
      setData(json.months ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [adminSecret, session?.access_token, authHeaders]);

  if (authLoading || !user) {
    return (
      <div className="admin-pages min-h-screen bg-emerald-100 text-zinc-900 flex items-center justify-center">
        <div className="text-zinc-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="admin-pages min-h-screen bg-emerald-100 text-zinc-900">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="rounded-xl bg-zinc-800 px-4 py-3 mb-6">
          <div className="text-2xl font-semibold text-white">Admin · 플랜 결제 통계</div>
          <div className="mt-2 text-sm text-zinc-300">
            월별 플랜 결제량 (PayPal captured). Admin secret 입력 후 불러오기를 누르세요.
          </div>
        </div>

        <AdminNavTabs current="plan-payments" />

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
          <button
            type="button"
            className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            disabled={loading || !adminSecret.trim()}
            onClick={load}
          >
            {loading ? "불러오는 중…" : "통계 불러오기"}
          </button>
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
        </div>

        {data && data.length > 0 ? (
          <div className="mt-6 overflow-x-auto rounded-2xl border-2 border-emerald-300 bg-white shadow-md">
            <table className="w-full text-sm text-left text-zinc-800">
              <thead>
                <tr className="border-b-2 border-emerald-300 bg-emerald-100/80">
                  <th className="px-4 py-3 font-semibold">월</th>
                  {(Object.keys(PLAN_LABELS) as PlanId[]).map((id) => (
                    <th key={id} className="px-4 py-3 font-semibold">
                      {PLAN_LABELS[id]}
                    </th>
                  ))}
                  <th className="px-4 py-3 font-semibold text-right">합계 건수</th>
                  <th className="px-4 py-3 font-semibold text-right">합계 (USD)</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.month} className="border-t border-zinc-100 hover:bg-zinc-50/50">
                    <td className="px-4 py-3 font-medium">{row.month}</td>
                    {(Object.keys(PLAN_LABELS) as PlanId[]).map((id) => (
                      <td key={id} className="px-4 py-3 text-zinc-600">
                        {row.plans[id].count}건 / ${row.plans[id].amountUsd.toFixed(2)}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-medium">{row.totalCount}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      ${row.totalUsd.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : data && data.length === 0 ? (
          <div className="mt-6 rounded-2xl border-2 border-emerald-300 bg-white px-6 py-8 text-center text-zinc-600 shadow-md">
            캡처된 플랜 결제 내역이 없습니다.
          </div>
        ) : null}

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

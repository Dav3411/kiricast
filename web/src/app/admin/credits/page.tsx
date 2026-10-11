"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminNavTabs } from "@/components/AdminNavTabs";
import { useAuth } from "@/components/AuthProvider";

type WalletRow = { userId: string; balance: number; nickname: string | null; updatedAt: string };

export default function AdminCreditsPage() {
  const router = useRouter();
  const { user, session, loading: authLoading } = useAuth();
  const [adminSecret, setAdminSecret] = useState("");
  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"delta" | "set">("delta");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wallets, setWallets] = useState<WalletRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user && typeof window !== "undefined") {
      const next = window.location.pathname || "/admin/credits";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [authLoading, user, router]);

  const authHeaders = useCallback(() => {
    const h: Record<string, string> = { "x-admin-secret": adminSecret };
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    return h;
  }, [adminSecret, session?.access_token]);

  const loadWallets = useCallback(async () => {
    if (!adminSecret.trim() || !session?.access_token) return;
    setLoadingList(true);
    try {
      const res = await fetch("/api/credits/admin", {
        headers: authHeaders(),
      });
      if (res.status === 401 || res.status === 403) {
        router.replace("/");
        return;
      }
      const data = (await res.json()) as { wallets?: WalletRow[]; error?: string };
      if (res.ok && Array.isArray(data.wallets)) setWallets(data.wallets);
      else setWallets([]);
    } catch {
      setWallets([]);
    } finally {
      setLoadingList(false);
    }
  }, [adminSecret, session?.access_token, authHeaders, router]);

  useEffect(() => {
    if (adminSecret.trim() && session?.access_token) loadWallets();
    else setWallets([]);
  }, [adminSecret, session?.access_token, loadWallets]);

  async function submit() {
    if (!session?.access_token) {
      setError("Sign in required");
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const amountValue = Number(amount);
      if (!Number.isInteger(amountValue)) {
        throw new Error("amount must be an integer");
      }
      const res = await fetch("/api/credits/admin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({
          userId: userId.trim(),
          amount: amountValue,
          mode,
        }),
      });
      if (res.status === 401 || res.status === 403) {
        router.replace("/");
        return;
      }
      const payload = (await res.json()) as { error?: string; balance?: number };
      if (!res.ok) {
        throw new Error(payload.error || "Failed to update credits");
      }
      setResult(`Updated balance: ${payload.balance ?? 0}`);
      loadWallets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update credits");
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || !user) {
    return (
      <div className="admin-pages min-h-screen bg-white text-zinc-900 flex items-center justify-center">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="admin-pages min-h-screen bg-white text-zinc-900">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="rounded-xl bg-zinc-800 px-4 py-3 mb-6">
          <div className="text-2xl font-semibold text-white">Admin · Credits</div>
          <div className="mt-2 text-sm text-zinc-300">
            지정한 유저의 크레딧을 추가/차감/세팅합니다. 로그인 + 시크릿 필요.
          </div>
        </div>

        <AdminNavTabs current="credits" />

        <div className="space-y-3 rounded-3xl border-2 border-zinc-300 bg-zinc-100 p-6 text-zinc-900 shadow-md">
          <div>
            <label className="block text-sm font-medium text-zinc-700">Admin secret</label>
            <input
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-emerald-400"
              value={adminSecret}
              onChange={(e) => setAdminSecret(e.target.value)}
              placeholder="ADMIN_CREDITS_SECRET"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">User</label>
            {wallets.length > 0 ? (
              <select
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-emerald-400"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              >
                <option value="">— 선택 —</option>
                {wallets.map((w) => (
                  <option key={w.userId} value={w.userId}>
                    {w.nickname || w.userId} — {w.balance} 크레딧
                  </option>
                ))}
              </select>
            ) : null}
            <input
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-emerald-400"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="User ID (UUID) 또는 위에서 선택"
            />
            {adminSecret.trim() && (
              <button
                type="button"
                className="mt-1 text-sm text-emerald-600 hover:underline disabled:opacity-50"
                disabled={loadingList}
                onClick={loadWallets}
              >
                {loadingList ? "로딩 중…" : "유저 목록 새로고침"}
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-zinc-700">Amount</label>
              <input
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-emerald-400"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g., 3000 or -500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700">Mode</label>
              <select
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-zinc-900 outline-none focus:border-emerald-400"
                value={mode}
                onChange={(e) => setMode(e.target.value as "delta" | "set")}
              >
                <option value="delta">delta (+/-)</option>
                <option value="set">set (absolute)</option>
              </select>
            </div>
          </div>

          <button
            type="button"
            className="w-full rounded-xl bg-emerald-200 px-4 py-3 font-semibold text-emerald-900 shadow-sm hover:bg-emerald-300 disabled:opacity-50"
            disabled={submitting}
            onClick={submit}
          >
            {submitting ? "Updating..." : "Update credits"}
          </button>

          {result ? <div className="text-sm text-zinc-700">{result}</div> : null}
          {error ? <div className="text-sm text-red-600">{error}</div> : null}

          {userId.trim() ? (
            <div className="mt-6 pt-4 border-t border-zinc-200 space-y-2">
              <div className="text-sm font-medium text-zinc-700">유저 UUID 편의 기능</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border border-zinc-300 bg-white text-zinc-700 text-sm hover:bg-zinc-50 disabled:opacity-50"
                  onClick={() => {
                    setMode("set");
                    setAmount("0");
                  }}
                >
                  잔액 0으로 설정 (폼에 반영)
                </button>
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm hover:bg-amber-100 disabled:opacity-50"
                  disabled={submitting}
                  onClick={async () => {
                    if (!session?.access_token || !userId.trim()) return;
                    if (!window.confirm(`유저 ${userId}의 크레딧 지갑을 삭제할까요? 목록에서 제거됩니다.`)) return;
                    setSubmitting(true);
                    setError(null);
                    setResult(null);
                    try {
                      const res = await fetch("/api/credits/admin", {
                        method: "DELETE",
                        headers: { "Content-Type": "application/json", ...authHeaders() },
                        body: JSON.stringify({ userId: userId.trim() }),
                      });
                      if (res.status === 401 || res.status === 403) {
                        router.replace("/");
                        return;
                      }
                      const payload = (await res.json()) as { error?: string; ok?: boolean };
                      if (!res.ok) throw new Error(payload.error ?? "Failed to delete");
                      setResult("Wallet deleted.");
                      setUserId("");
                      loadWallets();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : "Failed to delete");
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                >
                  지갑 삭제 (UUID 제거)
                </button>
                <Link
                  href={`/users/${encodeURIComponent(userId.trim())}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm hover:bg-emerald-100"
                >
                  유저 페이지 열기
                </Link>
                <button
                  type="button"
                  className="px-3 py-2 rounded-lg border border-zinc-300 bg-white text-zinc-700 text-sm hover:bg-zinc-50"
                  onClick={() => {
                    navigator.clipboard.writeText(userId.trim());
                    setResult("UUID copied.");
                    setTimeout(() => setResult(null), 2000);
                  }}
                >
                  UUID 복사
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center px-3 py-2 rounded-lg border border-zinc-300 bg-zinc-100 text-sm font-medium text-zinc-800 hover:bg-zinc-200"
          >
            홈으로
          </Link>
        </div>
      </div>
    </div>
  );
}

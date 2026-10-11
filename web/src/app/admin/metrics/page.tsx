"use client";

import { useState } from "react";
import Link from "next/link";
import { AdminNavTabs } from "@/components/AdminNavTabs";

type CountsRow = {
  name: string;
  count: number;
  uniqueUsers: number;
  uniqueAnons: number;
};

type MetricsApiResponse = {
  ok?: boolean;
  cutoff?: string;
  total?: number;
  counts?: CountsRow[];
  error?: string;
};

type P0Stats = {
  count: number;
  avgSec: number;
  p50Sec: number;
  p90Sec: number;
};

type P0Latency = {
  agent: { queue: P0Stats; proc: P0Stats; total: P0Stats };
  clip: { queue: P0Stats; proc: P0Stats; total: P0Stats };
};

type P0CreationKind = {
  created: number;
  succeeded: number;
  failed: number;
  inProgress: number;
  successPct: number;
};

type P0Creation = {
  agent: P0CreationKind;
  clip: P0CreationKind;
  agentTopErrors: Array<{ error: string; count: number }>;
  clipTopErrors: Array<{ error: string; count: number }>;
  daily: Array<{
    day: string;
    agent: { created: number; succeeded: number; failed: number; successPct: number };
    clip: { created: number; succeeded: number; failed: number; successPct: number };
  }>;
};

type P0Share = {
  totals: { shareOpen: number; shareComplete: number; shareCompletionPct: number; remixStart: number };
  daily: Array<{
    day: string;
    shareOpen: number;
    shareComplete: number;
    shareCompletionPct: number;
    remixStart: number;
  }>;
  topClips: Array<{ clipId: string; shareComplete: number }>;
};

type P0Credits = {
  totals: { creditsSpent: number; creditsReleased: number; capturedJobs: number; releasedJobs: number };
  daily: Array<{
    day: string;
    creditsSpent: number;
    creditsReleased: number;
    capturedJobs: number;
    releasedJobs: number;
  }>;
};

type P0Response = {
  ok?: boolean;
  cutoff?: string;
  days?: number;
  creation?: P0Creation;
  latency?: P0Latency;
  contentSupplyDaily?: Array<{ day: string; clipsPublished: number; creators: number }>;
  share?: P0Share;
  credits?: P0Credits;
  funnel?: { paywallShown: number; checkoutStart: number };
  rows?: { jobs: number; events: number; clips: number; creditLedger: number };
  warnings?: string[];
  error?: string;
};

export default function AdminMetricsPage() {
  const [adminSecret, setAdminSecret] = useState("");
  const [hours, setHours] = useState("24");
  const [days, setDays] = useState("14");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventsResult, setEventsResult] = useState<{
    cutoff: string;
    total: number;
    counts: CountsRow[];
  } | null>(null);
  const [p0Result, setP0Result] = useState<P0Response | null>(null);

  async function loadDashboard() {
    setSubmitting(true);
    setError(null);
    setEventsResult(null);
    setP0Result(null);
    try {
      const hoursValue = Number(hours);
      if (!Number.isFinite(hoursValue) || hoursValue <= 0) {
        throw new Error("hours must be a positive number");
      }
      const daysValue = Number(days);
      if (!Number.isFinite(daysValue) || daysValue <= 0) {
        throw new Error("days must be a positive number");
      }

      const [p0Res, eventsRes] = await Promise.all([
        fetch(`/api/metrics/admin/p0?days=${encodeURIComponent(daysValue)}`, {
          method: "GET",
          headers: { "x-admin-secret": adminSecret },
        }),
        fetch(`/api/metrics/admin?hours=${encodeURIComponent(hoursValue)}`, {
          method: "GET",
          headers: { "x-admin-secret": adminSecret },
        }),
      ]);

      const p0Payload = (await p0Res.json()) as P0Response;
      const eventsPayload = (await eventsRes.json()) as MetricsApiResponse;

      if (!p0Res.ok) {
        throw new Error(p0Payload?.error || "Failed to load P0 dashboard");
      }
      if (!eventsRes.ok) {
        throw new Error(eventsPayload?.error || "Failed to load event counts");
      }

      setP0Result(p0Payload);
      setEventsResult({
        cutoff: eventsPayload.cutoff ?? "",
        total: eventsPayload.total ?? 0,
        counts: Array.isArray(eventsPayload.counts) ? eventsPayload.counts : [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load metrics");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-pages min-h-screen bg-white text-zinc-900">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <div className="rounded-xl bg-zinc-800 px-4 py-3 mb-6">
          <div className="text-2xl font-semibold text-white">Admin · Metrics</div>
          <div className="mt-2 text-sm text-zinc-300">
            P0 dashboards + lightweight event counts from <code className="bg-zinc-600 px-1 rounded text-white">analytics_events</code>.
          </div>
        </div>

        <AdminNavTabs current="metrics" />

        <section className="mt-6 rounded-2xl border-2 border-zinc-300 bg-zinc-100 p-6 shadow-md">
          <h2 className="text-sm font-semibold text-zinc-900 mb-3">사용법</h2>
          <ol className="list-decimal list-inside text-sm text-zinc-800 space-y-1.5 mb-6">
            <li><strong>Admin secret</strong>에 .env의 <code className="bg-zinc-200 px-1 rounded text-xs">ADMIN_AGENTS_SECRET</code> 값을 입력합니다.</li>
            <li><strong>Lookback hours</strong>는 이벤트 집계 기준 “최근 N시간” (기본 24).</li>
            <li><strong>Lookback days</strong>는 P0 대시보드(생성률·레이턴시·공유·크레딧) 기준 “최근 N일” (기본 14).</li>
            <li><strong>Load dashboard</strong>를 누르면 위 설정으로 메트릭을 불러옵니다.</li>
          </ol>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-zinc-900">Admin secret</label>
              <input
                className="mt-1 w-full rounded-lg bg-white border border-zinc-200 px-3 py-2 text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400"
                value={adminSecret}
                onChange={(e) => setAdminSecret(e.target.value)}
                placeholder="ADMIN_AGENTS_SECRET"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-900">Lookback hours</label>
              <input
                className="mt-1 w-full rounded-lg bg-white border border-zinc-200 px-3 py-2 text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="24"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-900">Lookback days (P0 dashboards)</label>
              <input
                className="mt-1 w-full rounded-lg bg-white border border-zinc-200 px-3 py-2 text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400"
                value={days}
                onChange={(e) => setDays(e.target.value)}
                placeholder="14"
              />
            </div>

            <button
              type="button"
              className="w-full rounded-xl px-4 py-3 font-semibold text-white shadow-lg disabled:opacity-50 bg-gradient-to-r from-zinc-700 via-zinc-800 to-zinc-900 hover:from-zinc-800 hover:via-zinc-900 hover:to-black focus:outline-none focus:ring-2 focus:ring-zinc-500"
              disabled={submitting}
              onClick={loadDashboard}
            >
              {submitting ? "Loading..." : "Load dashboard"}
            </button>

            {error ? <div className="text-sm text-red-600">{error}</div> : null}
          </div>
        </section>

        {p0Result?.ok && p0Result.creation && p0Result.latency && p0Result.share && p0Result.credits ? (
          <div className="mt-6 space-y-6">
            <section className="rounded-3xl border-2 border-emerald-300 bg-white p-6 shadow-md">
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-lg font-semibold">P0 · Creation reliability</div>
                  <div className="mt-1 text-sm text-zinc-500">Since: {p0Result.cutoff}</div>
                </div>
                {p0Result.rows ? (
                  <div className="text-xs text-zinc-500">
                    rows: jobs={p0Result.rows.jobs}, events={p0Result.rows.events}, clips={p0Result.rows.clips},
                    credit_ledger={p0Result.rows.creditLedger}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-emerald-100 p-4">
                  <div className="text-sm font-medium">Agent jobs</div>
                  <div className="mt-2 text-3xl font-semibold">{p0Result.creation.agent.successPct}%</div>
                  <div className="mt-2 text-sm text-zinc-500">
                    created {p0Result.creation.agent.created} · succeeded {p0Result.creation.agent.succeeded} · failed{" "}
                    {p0Result.creation.agent.failed} · in progress {p0Result.creation.agent.inProgress}
                  </div>
                </div>
                <div className="rounded-2xl border border-emerald-100 p-4">
                  <div className="text-sm font-medium">Clip jobs</div>
                  <div className="mt-2 text-3xl font-semibold">{p0Result.creation.clip.successPct}%</div>
                  <div className="mt-2 text-sm text-zinc-500">
                    created {p0Result.creation.clip.created} · succeeded {p0Result.creation.clip.succeeded} · failed{" "}
                    {p0Result.creation.clip.failed} · in progress {p0Result.creation.clip.inProgress}
                  </div>
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-emerald-100 p-4">
                  <div className="text-sm font-medium">Top agent failures</div>
                  <div className="mt-2 space-y-1 text-sm text-zinc-700">
                    {p0Result.creation.agentTopErrors.length ? (
                      p0Result.creation.agentTopErrors.map((r) => (
                        <div key={r.error} className="flex items-start justify-between gap-3">
                          <div className="truncate" title={r.error}>
                            {r.error}
                          </div>
                          <div className="shrink-0 text-zinc-500">{r.count}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-zinc-500">No failures.</div>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-emerald-100 p-4">
                  <div className="text-sm font-medium">Top clip failures</div>
                  <div className="mt-2 space-y-1 text-sm text-zinc-700">
                    {p0Result.creation.clipTopErrors.length ? (
                      p0Result.creation.clipTopErrors.map((r) => (
                        <div key={r.error} className="flex items-start justify-between gap-3">
                          <div className="truncate" title={r.error}>
                            {r.error}
                          </div>
                          <div className="shrink-0 text-zinc-500">{r.count}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-zinc-500">No failures.</div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border-2 border-emerald-300 bg-white p-6 shadow-md">
              <div className="text-lg font-semibold">P0 · Job latency</div>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-zinc-500">
                      <th className="py-2 pr-4">Kind</th>
                      <th className="py-2 pr-4">Queue p50/p90 (sec)</th>
                      <th className="py-2 pr-4">Proc p50/p90 (sec)</th>
                      <th className="py-2 pr-4">Total p50/p90 (sec)</th>
                      <th className="py-2 pr-4">Samples</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["agent", "clip"] as const).map((k) => {
                      const row = p0Result.latency?.[k];
                      if (!row) return null;
                      return (
                        <tr key={k} className="border-t border-zinc-100">
                          <td className="py-2 pr-4 font-medium">{k}</td>
                          <td className="py-2 pr-4">
                            {row.queue.p50Sec} / {row.queue.p90Sec}
                          </td>
                          <td className="py-2 pr-4">
                            {row.proc.p50Sec} / {row.proc.p90Sec}
                          </td>
                          <td className="py-2 pr-4">
                            {row.total.p50Sec} / {row.total.p90Sec}
                          </td>
                          <td className="py-2 pr-4 text-zinc-500">{row.total.count}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-3xl border-2 border-emerald-300 bg-white p-6 shadow-md">
              <div className="text-lg font-semibold">P0 · Content supply (daily)</div>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-zinc-500">
                      <th className="py-2 pr-4">Day (UTC)</th>
                      <th className="py-2 pr-4">Clips</th>
                      <th className="py-2 pr-4">Creators</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(p0Result.contentSupplyDaily ?? []).map((r) => (
                      <tr key={r.day} className="border-t border-zinc-100">
                        <td className="py-2 pr-4 font-medium">{r.day}</td>
                        <td className="py-2 pr-4">{r.clipsPublished}</td>
                        <td className="py-2 pr-4">{r.creators}</td>
                      </tr>
                    ))}
                    {(p0Result.contentSupplyDaily ?? []).length === 0 ? (
                      <tr>
                        <td className="py-3 text-zinc-500" colSpan={3}>
                          No published clips found.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-3xl border-2 border-emerald-300 bg-white p-6 shadow-md">
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-lg font-semibold">P0 · Share effectiveness</div>
                  <div className="mt-1 text-sm text-zinc-500">
                    share completion: {p0Result.share.totals.shareCompletionPct}% (open{" "}
                    {p0Result.share.totals.shareOpen} → complete {p0Result.share.totals.shareComplete})
                  </div>
                </div>
                {p0Result.funnel ? (
                  <div className="text-sm text-zinc-500">
                    paywall_shown {p0Result.funnel.paywallShown} · checkout_start {p0Result.funnel.checkoutStart}
                  </div>
                ) : null}
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-emerald-100 p-4">
                  <div className="text-sm font-medium">Daily</div>
                  <div className="mt-2 overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-zinc-500">
                          <th className="py-2 pr-4">Day</th>
                          <th className="py-2 pr-4">Open</th>
                          <th className="py-2 pr-4">Complete</th>
                          <th className="py-2 pr-4">%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p0Result.share.daily.map((r) => (
                          <tr key={r.day} className="border-t border-zinc-100">
                            <td className="py-2 pr-4 font-medium">{r.day}</td>
                            <td className="py-2 pr-4">{r.shareOpen}</td>
                            <td className="py-2 pr-4">{r.shareComplete}</td>
                            <td className="py-2 pr-4 text-zinc-500">{r.shareCompletionPct}%</td>
                          </tr>
                        ))}
                        {p0Result.share.daily.length === 0 ? (
                          <tr>
                            <td className="py-3 text-zinc-500" colSpan={4}>
                              No share events yet.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="rounded-2xl border border-emerald-100 p-4">
                  <div className="text-sm font-medium">Top shared clips</div>
                  <div className="mt-2 space-y-1 text-sm">
                    {p0Result.share.topClips.length ? (
                      p0Result.share.topClips.map((r) => (
                        <div key={r.clipId} className="flex items-center justify-between gap-3">
                          <Link href={`/clips/${encodeURIComponent(r.clipId)}`} className="truncate underline">
                            {r.clipId}
                          </Link>
                          <div className="shrink-0 text-zinc-500">{r.shareComplete}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-zinc-500">No data.</div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border-2 border-emerald-300 bg-white p-6 shadow-md">
              <div className="text-lg font-semibold">P0 · Credits spend (daily)</div>
              <div className="mt-1 text-sm text-zinc-500">
                spent {p0Result.credits.totals.creditsSpent} · released {p0Result.credits.totals.creditsReleased} ·
                captured_jobs {p0Result.credits.totals.capturedJobs}
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-zinc-500">
                      <th className="py-2 pr-4">Day (UTC)</th>
                      <th className="py-2 pr-4">Spent</th>
                      <th className="py-2 pr-4">Released</th>
                      <th className="py-2 pr-4">Captured jobs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p0Result.credits.daily.map((r) => (
                      <tr key={r.day} className="border-t border-zinc-100">
                        <td className="py-2 pr-4 font-medium">{r.day}</td>
                        <td className="py-2 pr-4">{r.creditsSpent}</td>
                        <td className="py-2 pr-4">{r.creditsReleased}</td>
                        <td className="py-2 pr-4 text-zinc-500">{r.capturedJobs}</td>
                      </tr>
                    ))}
                    {p0Result.credits.daily.length === 0 ? (
                      <tr>
                        <td className="py-3 text-zinc-500" colSpan={4}>
                          No credit_ledger rows.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {Array.isArray(p0Result.warnings) && p0Result.warnings.length ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <div className="font-medium">Warnings</div>
                  <ul className="mt-1 list-disc pl-5">
                    {p0Result.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {eventsResult ? (
          <div className="mt-6 rounded-3xl border border-emerald-200 bg-white p-6 shadow-md">
            <div className="text-lg font-semibold">Raw event counts</div>
            <div className="mt-2 text-sm text-zinc-500">Since: {eventsResult.cutoff}</div>
            <div className="mt-1 text-sm text-zinc-500">Total events: {eventsResult.total}</div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-zinc-500">
                    <th className="py-2 pr-4">Event</th>
                    <th className="py-2 pr-4">Count</th>
                    <th className="py-2 pr-4">Unique users</th>
                    <th className="py-2 pr-4">Unique anons</th>
                  </tr>
                </thead>
                <tbody>
                  {eventsResult.counts.map((row) => (
                    <tr key={row.name} className="border-t border-zinc-100">
                      <td className="py-2 pr-4 font-medium">{row.name}</td>
                      <td className="py-2 pr-4">{row.count}</td>
                      <td className="py-2 pr-4">{row.uniqueUsers}</td>
                      <td className="py-2 pr-4">{row.uniqueAnons}</td>
                    </tr>
                  ))}
                  {eventsResult.counts.length === 0 ? (
                    <tr>
                      <td className="py-3 text-zinc-500" colSpan={4}>
                        No events found (or table not created yet).
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center px-3 py-2 rounded-lg green-button text-sm"
          >
            홈으로
          </Link>
        </div>
      </div>
    </div>
  );
}


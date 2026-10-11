"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/AuthProvider";
import { useJobQueue, type QueuedJob } from "@/components/JobQueueProvider";
import { useFetchWithAuth } from "@/hooks/useFetchWithAuth";
import { Logo } from "@/components/Logo";
import { LogoKiricast } from "@/components/LogoKiricast";

export function SiteHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isDiscover = pathname.startsWith("/clips");
  const t = useTranslations();
  const { user, session, loading: authLoading, signOut } = useAuth();
  const [credits, setCredits] = useState<number | null>(null);
  const [planName, setPlanName] = useState<string | null>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [infoExpanded, setInfoExpanded] = useState(false);
  const [tasksExpanded, setTasksExpanded] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);
  const { jobs, activeCount } = useJobQueue();

  // Track active series creation from localStorage (set by create page, scoped per user)
  const [seriesCreateActive, setSeriesCreateActive] = useState(false);
  useEffect(() => {
    // Clean up legacy non-scoped key
    localStorage.removeItem("kiricast_series_create_active");
    const key = user?.id ? `kiricast_series_create_active_${user.id}` : "";
    const sync = () => setSeriesCreateActive(!!key && !!localStorage.getItem(key));
    sync();
    window.addEventListener("kiricast_series_create_change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("kiricast_series_create_change", sync);
      window.removeEventListener("storage", sync);
    };
  }, [user?.id]);

  const hasActiveAgentJob = jobs.some(
    (j) => j.kind === "agent" && (j.status === "queued" || j.status === "processing")
  );

  useEffect(() => {
    if (!accountMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
        setInfoExpanded(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [accountMenuOpen]);

  useEffect(() => {
    if (!user || !session?.access_token) {
      setCredits(null);
      setPlanName(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/credits/balance", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { balance?: number };
        if (!cancelled && typeof data.balance === "number") {
          setCredits(data.balance);
        }
      } catch {
        // silently ignore
      }
    })();
    (async () => {
      try {
        const res = await fetch("/api/subscription/plan", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { plan?: { name?: string } | null };
        if (!cancelled) {
          setPlanName(data.plan?.name ?? null);
        }
      } catch {
        // silently ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, session?.access_token]);

  return (
    <>
      <aside className="hidden lg:flex fixed left-0 top-0 z-50 h-screen sidebar-width backdrop-blur-xl bg-zinc-950/85 border-r border-zinc-700/70 shadow-2xl shadow-black/30 flex-col overflow-hidden">
        <Link href="/" className="shrink-0 px-8 py-6 border-b border-zinc-700/70 flex items-center" onClick={(e) => { if (isHome) { e.preventDefault(); window.location.reload(); } }}>
          <Logo width={30} height={30} textOnly />
        </Link>

        <nav className="shrink-0 p-4 space-y-2">
          <Link href="/home" className="block px-4 py-2.5 rounded-xl text-sm font-medium text-zinc-100 hover:bg-zinc-800/70 transition-colors">
            {t("common.home")}
          </Link>
          <Link href="/clips/feed" className="block px-4 py-2.5 rounded-xl text-sm font-medium text-zinc-100 hover:bg-zinc-800/70 transition-colors">
            {t("common.discover")}
          </Link>
          <Link href="/agents" className="block px-4 py-2.5 rounded-xl text-sm font-medium text-zinc-100 hover:bg-zinc-800/70 transition-colors">
            {t("common.agents")}
          </Link>
          <Link href="/series/create" className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-zinc-100 hover:bg-zinc-800/70 transition-colors">
            {t("common.create")}
            {seriesCreateActive && <span className="w-2 h-2 rounded-full bg-purple-400" />}
            {hasActiveAgentJob && <span className="w-2 h-2 rounded-full bg-emerald-400" />}
          </Link>
        </nav>

        <div className="flex-1 flex flex-col min-h-0 border-t border-zinc-700/70">
          {user && jobs.length > 0 ? (
            <div className="flex-1 flex flex-col min-h-0 px-4 py-3">
              <button
                type="button"
                className="w-full flex items-center justify-between mb-1 hover:opacity-80 transition-opacity shrink-0"
                onClick={() => setTasksExpanded((v) => !v)}
              >
                <span className="flex items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    {t("common.tasks")}
                  </span>
                  {activeCount > 0 ? (
                    <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      {activeCount}
                    </span>
                  ) : null}
                </span>
                <span className="text-zinc-500 text-xs">
                  {tasksExpanded ? "˅" : "˄"}
                </span>
              </button>
              {tasksExpanded ? (
                <div className="flex-1 min-h-0 overflow-y-auto space-y-1 mt-1">
                  {jobs.map((job) => (
                    <SidebarJobItem key={job.id} job={job} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="shrink-0 p-4 border-t border-zinc-700/70 space-y-2">
          {authLoading ? null : user ? (
            <>
              <Link
                href="/credits"
                className="block px-4 py-2.5 rounded-xl border border-emerald-400/30 bg-gradient-to-r from-emerald-500/15 to-green-500/15 backdrop-blur-xl hover:from-emerald-500/25 hover:to-green-500/25 transition-colors"
              >
                <div className="text-xs text-zinc-400">{planName ?? "Free"}</div>
                {credits !== null ? (
                  <div className="text-emerald-200 font-semibold text-sm">{credits} credits</div>
                ) : null}
              </Link>
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  className="w-full px-4 py-2.5 rounded-xl text-sm font-medium text-zinc-100 hover:bg-zinc-800/70 transition-colors text-left"
                  onClick={() => { setAccountMenuOpen((v) => !v); setInfoExpanded(false); }}
                >
                  {user.email ?? user.id}
                </button>
                {accountMenuOpen ? (
                  <div className="absolute bottom-full left-0 right-0 mb-1 rounded-xl backdrop-blur-xl bg-zinc-900/95 border border-zinc-700/70 shadow-xl shadow-black/40 py-1 z-50">
                    <Link
                      href={`/users/${encodeURIComponent(user.id)}`}
                      className="block px-4 py-2.5 text-sm text-zinc-100 hover:bg-zinc-800/70 transition-colors"
                      onClick={() => setAccountMenuOpen(false)}
                    >
                      {t("common.myPage")}
                    </Link>
                    <Link
                      href="/account"
                      className="block px-4 py-2.5 text-sm text-zinc-100 hover:bg-zinc-800/70 transition-colors"
                      onClick={() => setAccountMenuOpen(false)}
                    >
                      {t("common.account")}
                    </Link>
                    <div className="relative">
                      <button
                        type="button"
                        className="w-full px-4 py-2.5 text-sm text-zinc-100 hover:bg-zinc-800/70 transition-colors text-left flex items-center justify-between"
                        onClick={() => setInfoExpanded((v) => !v)}
                      >
                        <span>{t("common.infoSupport")}</span>
                        <span className="text-zinc-500 text-xs">{infoExpanded ? "˅" : "˄"}</span>
                      </button>
                      {infoExpanded ? (
                        <div className="px-4 py-2 border-t border-zinc-700/70 space-y-2 text-xs text-zinc-400">
                          <p><Link href="/terms" className="text-emerald-400 hover:underline" onClick={() => setAccountMenuOpen(false)}>{t("common.termsOfService")}</Link></p>
                          <p><Link href="/privacy" className="text-emerald-400 hover:underline" onClick={() => setAccountMenuOpen(false)}>{t("common.privacyPolicy")}</Link></p>
                          <p><a href="https://example.com/community" target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">Discord</a></p>
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="w-full px-4 py-2.5 text-sm text-red-400 hover:bg-zinc-800/70 transition-colors text-left border-t border-zinc-700/70"
                      onClick={async () => {
                        setAccountMenuOpen(false);
                        await signOut();
                        router.replace("/");
                      }}
                    >
                      {t("common.signOut")}
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="block px-4 py-2.5 rounded-xl border border-zinc-700/70 backdrop-blur-xl bg-zinc-900/80 text-zinc-100 text-sm font-medium hover:bg-zinc-800/80 transition-colors"
              >
                {t("common.signIn")}
              </Link>
              <Link
                href="/login?mode=signup"
                className="block px-4 py-2.5 rounded-xl text-sm font-semibold shadow-lg shadow-emerald-400/25 border-0"
                style={{ background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#002e1f" }}
              >
                {t("common.signUp")}
              </Link>
            </>
          )}
        </div>

      </aside>

      <header className={`lg:hidden sticky top-0 z-50 border-b border-zinc-700/70 backdrop-blur-xl bg-zinc-950/85 shadow-lg shadow-black/30${isDiscover ? " hidden" : ""}`}>
        <div className="px-4 py-3 flex items-center justify-between">
          <Link href="/" onClick={(e) => { if (isHome) { e.preventDefault(); window.location.reload(); } }}>
            <Logo width={120} height={26} textOnly />
          </Link>
          {!authLoading && user && credits !== null ? (
            <Link
              href="/credits"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-emerald-400/30 bg-emerald-500/10"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                <circle cx="12" cy="12" r="10" />
                <path d="M15 9.354a4 4 0 10 0 5.292" />
              </svg>
              <span className="text-xs font-semibold text-emerald-300">{credits.toLocaleString()}</span>
            </Link>
          ) : null}
        </div>
      </header>

      <nav className={`lg:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-zinc-800 bg-zinc-950${isDiscover ? " hidden" : ""}`}>
        <div className="flex items-center justify-around px-1 pt-1 pb-1">
          <Link
            href="/home"
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[10px] font-medium transition-colors ${pathname === "/home" ? "text-emerald-400" : "text-zinc-400"}`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>
            {t("common.home")}
          </Link>
          <Link
            href="/agents"
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[10px] font-medium transition-colors ${pathname.startsWith("/agents") ? "text-emerald-400" : "text-zinc-400"}`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a4 4 0 014 4 4 4 0 01-4 4 4 4 0 01-4-4 4 4 0 014-4"/><path d="M8 14h8a4 4 0 014 4v1H4v-1a4 4 0 014-4"/><path d="M17 4l1.5 1.5L17 7"/><path d="M20.5 5.5h-3"/></svg>
            {t("common.agents")}
          </Link>
          <Link
            href="/clips/feed"
            className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[10px] font-medium transition-colors ${pathname.startsWith("/clips") ? "text-emerald-400" : "text-zinc-400"}`}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
            {t("common.discover")}
          </Link>
          <Link
            href="/series/create"
            className={`relative flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[10px] font-medium transition-colors ${pathname === "/series/create" ? "text-emerald-400" : "text-zinc-400"}`}
          >
            <span className="relative">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
              {activeCount > 0 ? (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber-400 text-[9px] font-bold text-zinc-900 flex items-center justify-center">
                  {activeCount}
                </span>
              ) : null}
            </span>
            <span className="flex items-center gap-1">
              {t("common.create")}
              {seriesCreateActive && <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
              {hasActiveAgentJob && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
            </span>
          </Link>
          {user ? (
            <Link
              href={`/users/${encodeURIComponent(user.id)}`}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[10px] font-medium transition-colors ${pathname.startsWith("/users") ? "text-emerald-400" : "text-zinc-400"}`}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              {t("common.myPage")}
            </Link>
          ) : (
            <Link
              href="/login"
              className="flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[10px] font-medium text-zinc-400 transition-colors"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              {t("common.signIn")}
            </Link>
          )}
        </div>
      </nav>
    </>
  );
}

function SidebarJobItem({ job }: { job: QueuedJob }) {
  const t = useTranslations();
  const { dismissJob } = useJobQueue();
  const { fetchWithAuth } = useFetchWithAuth();
  const isActive = job.status === "queued" || job.status === "processing";
  const isFailed = job.status === "failed";
  const isDone = job.status === "succeeded" || job.status === "failed";
  const isExportDone = job.kind === "export_shorts" && job.status === "succeeded";
  const serverProgress = job.progress ?? 0;
  const [displayProgress, setDisplayProgress] = useState(serverProgress);
  const serverProgressRef = useRef(serverProgress);
  serverProgressRef.current = serverProgress;
  useEffect(() => {
    setDisplayProgress(serverProgress);
  }, [serverProgress]);
  useEffect(() => {
    if (!isActive || serverProgress >= 100) return;
    const t = setInterval(() => {
      setDisplayProgress((prev) => {
        const cap = Math.min(99, serverProgressRef.current + 30);
        return Math.min(prev + 2, cap);
      });
    }, 2000);
    return () => clearInterval(t);
  }, [isActive, serverProgress]);
  const progressToShow = isActive ? displayProgress : serverProgress;
  const autoDownloadedRef = useRef(
    typeof window !== "undefined" && (() => {
      try {
        const ids: string[] = JSON.parse(window.localStorage.getItem("kiricast_auto_dl") ?? "[]");
        return ids.includes(job.id);
      } catch { return false; }
    })()
  );

  const href = (() => {
    if (job.kind === "export_shorts") return null;
    if (job.kind === "series_doc") return `/series/create?jobId=${job.id}`;
    if (job.kind === "agent") {
      if (job.status === "succeeded" && job.result) {
        const agentId = (job.result as Record<string, unknown>)?.agent_id;
        if (typeof agentId === "string") return `/agents/${agentId}`;
      }
      return "/agents/create";
    }
    // 시리즈 에피소드 잡 (진행 중/실패) — 시리즈 페이지로 이동
    if (job.kind === "clip" && job.seriesId && job.status !== "succeeded") {
      return `/series/${job.seriesId}`;
    }
    if (job.status === "succeeded" && job.clipId) return `/clips/${job.clipId}`;
    return "/series/create";
  })();

  const handleExportDownload = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/jobs/${job.id}`, { method: "GET" });
      const data = (await res.json()) as { downloadUrl?: string };
      if (!data.downloadUrl) return;

      const blob = await fetch(data.downloadUrl).then((r) => r.blob());
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = `${job.name || "export"}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      // ignore
    }
  }, [job.id, job.name, fetchWithAuth]);

  // export_shorts 완료 시 자동 다운로드 (새로고침 후 중복 방지: localStorage 사용)
  useEffect(() => {
    if (isExportDone && !autoDownloadedRef.current) {
      autoDownloadedRef.current = true;
      try {
        const ids: string[] = JSON.parse(window.localStorage.getItem("kiricast_auto_dl") ?? "[]");
        if (!ids.includes(job.id)) {
          ids.push(job.id);
          window.localStorage.setItem("kiricast_auto_dl", JSON.stringify(ids.slice(-100)));
        }
      } catch { /* ignore */ }
      handleExportDownload();
    }
  }, [isExportDone, handleExportDownload, job.id]);

  const kindLabel = job.kind === "agent" ? t("jobs.agent") : job.kind === "export_shorts" ? t("jobs.export") : job.kind === "script" ? t("jobs.script") : job.kind === "series_doc" ? t("jobs.series") : t("jobs.clip");
  // Delayed: only when worker has not updated progress for 2+ min (unexpected stall)
  const updatedAtMs = typeof job.updatedAt === "string" ? new Date(job.updatedAt).getTime() : 0;
  const isDelayed =
    isActive &&
    updatedAtMs > 0 &&
    Date.now() - updatedAtMs > 2 * 60 * 1000;

  const content = (
    <>
      <div className="shrink-0">
        {isActive ? (
          <div className="w-4 h-4 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
        ) : isFailed ? (
          <div className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center text-red-400 text-[10px] font-bold">!</div>
        ) : (
          <div className="w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-[10px]">&#10003;</div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-zinc-200 truncate">{job.name}</div>
        <div className="text-[11px] text-zinc-500">
          {kindLabel}
          {isActive && job.progress != null ? ` · ${Math.round(progressToShow)}%` : ""}
          {isDelayed ? (
            <span className="text-amber-400 ml-0.5" title="No progress from server for a while — possible delay">
              · {t("common.delayed")}
            </span>
          ) : null}
          {job.requeuedAt ? (
            <span className="text-zinc-400 ml-0.5" title="This task was requeued after a delay (e.g. server restart).">
              · {t("common.requeued")}
            </span>
          ) : null}
          {isFailed ? ` · ${t("common.failed")}` : ""}
          {isExportDone ? ` · ${t("common.download")}` : ""}
        </div>
      </div>
      {isActive && job.progress != null ? (
        <div className="w-10 h-1 rounded-full bg-zinc-700 overflow-hidden shrink-0">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, progressToShow))}%` }}
          />
        </div>
      ) : null}
    </>
  );

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-zinc-800/70 transition-colors group">
      {href ? (
        <Link href={href} className="flex items-center gap-2.5 flex-1 min-w-0">
          {content}
        </Link>
      ) : (
        <button
          type="button"
          className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
          onClick={isExportDone ? handleExportDownload : undefined}
        >
          {content}
        </button>
      )}
      {isDone ? (
        <button
          type="button"
          className="shrink-0 w-5 h-5 rounded-md flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700/70 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => dismissJob(job.id)}
        >
          <span className="text-xs leading-none">&times;</span>
        </button>
      ) : null}
    </div>
  );
}

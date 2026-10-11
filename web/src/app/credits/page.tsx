"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabaseClient";
import { trackEvent } from "@/lib/analytics";
import { CREDIT_PLANS, PLAN_IDS, type PlanId } from "@/lib/plans";

function CreditsPageContent() {
  const t = useTranslations("credits");
  const tc = useTranslations("common");
  const searchParams = useSearchParams();
  const [selectedPlan, setSelectedPlan] = useState<PlanId | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string>("");
  const [currentPlanId, setCurrentPlanId] = useState<PlanId | null>(null);
  const [renewalCancelled, setRenewalCancelled] = useState(false);
  const [planLoading, setPlanLoading] = useState(true);
  const success = searchParams.get("success") === "1";
  const returnUrlParam = searchParams.get("return");
  const [returnUrl, setReturnUrl] = useState<string | null>(returnUrlParam);

  // On success, check localStorage for return URL (survives PayPal redirect)
  useEffect(() => {
    if (success && !returnUrlParam) {
      const stored = localStorage.getItem("kiricast_credits_return");
      if (stored) {
        setReturnUrl(stored);
        localStorage.removeItem("kiricast_credits_return");
      }
    }
  }, [success, returnUrlParam]);
  /** 로그인된 유저의 플랜 조회가 끝날 때까지 카드 선택·결제 비활성화 (유료 유저가 빠르게 클릭하는 것 방지) */
  const planCardsLocked = !!token && planLoading;
  const initialPlanParam = searchParams.get("plan");

  useEffect(() => {
    if (!initialPlanParam) return;
    if (PLAN_IDS.includes(initialPlanParam as PlanId)) {
      setSelectedPlan(initialPlanParam as PlanId);
    }
  }, [initialPlanParam]);

  useEffect(() => {
    void trackEvent("page_view", { page: "credits" });
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadToken() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setToken(data.session?.access_token ?? "");
    }
    loadToken();
    const { data: sub } = supabase.auth.onAuthStateChange((_e: string, session: { access_token?: string } | null) => {
      setToken(session?.access_token ?? "");
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!token) {
      setCurrentPlanId(null);
      setRenewalCancelled(false);
      setPlanLoading(false);
      return;
    }
    let cancelled = false;
    setPlanLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/subscription/plan", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = (await res.json()) as {
          plan?: { id?: string };
          periodEndsAt?: string | null;
          renewalCancelled?: boolean;
        };
        if (cancelled) return;
        if (res.ok && data.plan?.id && data.periodEndsAt && new Date(data.periodEndsAt) > new Date()) {
          setCurrentPlanId(data.plan.id as PlanId);
          setRenewalCancelled(!!data.renewalCancelled);
        } else {
          setCurrentPlanId(null);
          setRenewalCancelled(false);
        }
      } catch {
        if (!cancelled) {
          setCurrentPlanId(null);
          setRenewalCancelled(false);
        }
      } finally {
        if (!cancelled) setPlanLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  async function handleCheckout() {
    if (selectedPlan == null) return;
    setSubmitting(true);
    setError(null);
    void trackEvent("checkout_start", { planId: selectedPlan });
    try {
      const res = await fetch("/api/credits/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : "",
        },
        body: JSON.stringify({ planId: selectedPlan }),
      });
      const text = await res.text();
      let payload: { url?: string; error?: string } = {};
      if (text) {
        try {
          payload = JSON.parse(text) as { url?: string; error?: string };
        } catch {
          setError(t("invalidResponse"));
          return;
        }
      }
      if (!res.ok || !payload.url) {
        throw new Error(payload.error || t("paymentFailed"));
      }
      // Preserve return URL through PayPal redirect
      if (returnUrl) {
        localStorage.setItem("kiricast_credits_return", returnUrl);
      }
      const url = payload.url.trim();
      const isAbsolute = url.startsWith("http://") || url.startsWith("https://");
      window.location.href = isAbsolute ? url : `${window.location.origin}${url.startsWith("/") ? "" : "/"}${url}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("paymentFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="h-dvh overflow-x-hidden overflow-y-auto text-zinc-100 relative" style={{ background: "#0a0a0b" }}>
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-emerald-500/15 rounded-full blur-[120px]" />
        <div className="absolute -bottom-40 -left-40 w-[400px] h-[400px] bg-teal-500/10 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-400/5 rounded-full blur-[150px]" />
      </div>

      <div className="max-w-6xl mx-auto px-6 py-12 relative z-10">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="mb-6 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg backdrop-blur-xl bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-400 hover:text-zinc-200 text-sm transition-all"
        >
          {tc("back")}
        </button>
        <div className="text-2xl font-semibold text-gray-100">{t("pageTitle")}</div>
        {success ? (
          <div className="mt-4 p-4 rounded-xl backdrop-blur-xl bg-emerald-900/30 border border-emerald-400/20 text-emerald-300 text-sm">
            {t("paymentSuccess")}
            {returnUrl ? (
              <Link href={returnUrl} className="ml-2 underline font-medium hover:text-emerald-200">
                {t("continueLink")}
              </Link>
            ) : (
              ` ${t("refreshMessage")}`
            )}
          </div>
        ) : (
          <div className="mt-2 text-sm text-zinc-500">
            {t("planDescription")}
          </div>
        )}
        <div className="mt-2">
          <Link href="/credits/one-time" className="text-sm text-emerald-400 hover:text-emerald-300 underline">
            {t("onetimeLink")}
          </Link>
        </div>

        <div className="mt-6 grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
          {PLAN_IDS.map((id) => {
            const plan = CREDIT_PLANS[id];
            const isSelected = selectedPlan === plan.id;
            const isCurrent = currentPlanId === plan.id;
            const isHighTierCurrent = currentPlanId === "pro" || currentPlanId === "ultra";
            const isPlusPopularGrey = id === "plus" && isHighTierCurrent;
            const isUpgrade = currentPlanId != null && plan.credits > CREDIT_PLANS[currentPlanId].credits;
            const isDowngrade = currentPlanId != null && plan.credits < CREDIT_PLANS[currentPlanId].credits;
            const isDisabled = planCardsLocked || isCurrent || (isDowngrade && !renewalCancelled);
            const baseUnit = (CREDIT_PLANS.starter.priceUsd / CREDIT_PLANS.starter.credits * 1000);
            const referencePriceUsd = (baseUnit / 1000) * plan.credits;
            const savePercent = Math.round((1 - (plan.priceUsd / plan.credits) / (baseUnit / 1000)) * 100);
            const badge = id === "ultra" ? t("bestValue") : id === "plus" ? t("popular") : isCurrent ? t("currentPlan") : isUpgrade ? t("upgrade") : null;
            return (
              <button
                key={plan.id}
                type="button"
                className={`relative w-full text-center rounded-2xl min-w-0 sm:min-h-[520px] flex flex-col items-center justify-center gap-1 sm:gap-2 px-3 py-5 sm:px-6 sm:py-10 backdrop-blur-xl transition-all ${
                  isDisabled
                    ? "cursor-default border border-white/10 opacity-75"
                    : isSelected
                      ? "border-2 border-emerald-500 shadow-2xl shadow-emerald-400/20"
                      : "border border-white/10 text-zinc-300 hover:border-white/20 hover:shadow-lg hover:shadow-emerald-500/10"
                }`}
                style={
                  isDisabled
                    ? { background: "rgba(255,255,255,0.04)", cursor: "default" }
                    : isSelected
                      ? { background: "linear-gradient(135deg, rgba(164,244,207,0.45), rgba(124,237,163,0.35))", color: "#e5e7eb", boxShadow: "inset 0 0 30px rgba(5,150,105,0.3), 0 25px 50px -12px rgba(52,211,153,0.2)" }
                      : { background: "rgba(255,255,255,0.04)" }
                }
                onClick={() => {
                  if (isDisabled) return;
                  setSelectedPlan(plan.id);
                }}
              >
                {badge ? (
                  <span
                    className="absolute top-2 right-2 sm:top-4 sm:right-4 px-1.5 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[9px] sm:text-[11px] font-bold tracking-wide uppercase"
                    style={
                      isCurrent
                        ? { background: "rgba(148,163,184,0.25)", color: "#94a3b8" }
                        : isPlusPopularGrey
                          ? { background: "rgba(148,163,184,0.25)", color: "#94a3b8" }
                        : isSelected
                          ? { background: "rgba(164,244,207,0.15)", color: "#A4F4CF" }
                          : { background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#002e1f" }
                    }
                  >
                    {badge}
                  </span>
                ) : null}
                <div className={`text-sm sm:text-xl font-bold uppercase tracking-widest ${isSelected ? "text-emerald-300" : "text-emerald-400/90"}`}>{plan.name}</div>
                <div className="text-2xl sm:text-4xl font-black leading-none">{plan.credits.toLocaleString()}</div>
                <div className={`text-xs sm:text-sm min-h-[16px] sm:min-h-[20px] ${isSelected ? "" : "text-zinc-500"}`}>{t("creditsPerMonth")}</div>
                <div className="mt-1 sm:mt-2 min-h-[40px] sm:min-h-[56px] flex flex-col items-center justify-start">
                  <div
                    className={`text-xs sm:text-sm text-zinc-500 line-through decoration-emerald-400 ${
                      referencePriceUsd > plan.priceUsd + 0.005 ? "" : "invisible"
                    }`}
                  >
                    ${referencePriceUsd.toFixed(2)}{t("perMonth")}
                  </div>
                  <div className="text-lg sm:text-2xl font-bold">
                    ${plan.priceUsd.toFixed(2)}
                    <span className="text-xs sm:text-sm font-normal text-zinc-400">{t("perMonth")}</span>
                  </div>
                </div>
                <div className="mt-0.5 sm:mt-1 min-h-[22px] sm:min-h-[26px] flex items-center justify-center">
                  {savePercent > 0 && !isDisabled ? (
                    <span
                      className="px-2 py-0.5 sm:px-3 rounded-full text-[10px] sm:text-xs font-semibold"
                      style={
                        isSelected
                          ? { background: "rgba(164,244,207,0.15)", color: "#A4F4CF" }
                          : { background: "rgba(164,244,207,0.12)", color: "#A4F4CF" }
                      }
                    >
                      {t("save", { percent: savePercent })}
                    </span>
                  ) : null}
                </div>
                <ul className={`mt-2 sm:mt-4 w-full text-center space-y-1.5 sm:space-y-2.5 text-[11px] sm:text-sm ${isSelected ? "text-zinc-200" : "text-zinc-500"}`}>
                  <li>
                    {plan.scriptGenerateLimitPerClip === 1
                      ? t("scriptRegen1")
                      : t("scriptRegenN", { count: plan.scriptGenerateLimitPerClip })}
                  </li>
                  <li>{plan.canCreatePrivateAgent ? t("privateAgents") : t("publicAgentsOnly")}</li>
                  <li>{plan.canSelectVoiceManually ? t("manualVoice") : t("autoVoice")}</li>
                  <li>{plan.canExportVideo ? t("videoExport") : t("noVideoExport")}</li>
                  {plan.canExportVideo && (
                    <li>{plan.noWatermark ? t("noWatermark") : t("watermark")}</li>
                  )}
                </ul>
              </button>
            );
          })}
        </div>

        {currentPlanId && selectedPlan === currentPlanId ? (
          <p className="mt-4 text-sm text-zinc-500 text-center">
            {t("currentPlanMessage")}
          </p>
        ) : null}
        <button
          type="button"
          className="mt-6 w-full rounded-xl backdrop-blur-xl px-4 py-3 font-semibold shadow-lg shadow-emerald-400/25 hover:brightness-110 transition-all disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#002e1f" }}
          onClick={handleCheckout}
          disabled={
            submitting ||
            planCardsLocked ||
            selectedPlan == null ||
            (!!currentPlanId && selectedPlan === currentPlanId)
          }
        >
          {planCardsLocked
            ? tc("loading")
            : submitting
              ? t("redirecting")
              : selectedPlan != null && currentPlanId && selectedPlan !== currentPlanId && CREDIT_PLANS[selectedPlan].credits > CREDIT_PLANS[currentPlanId].credits
                ? t("upgradeTo", { plan: CREDIT_PLANS[selectedPlan].name })
                : selectedPlan != null && currentPlanId && selectedPlan !== currentPlanId
                  ? t("switchTo", { plan: CREDIT_PLANS[selectedPlan].name })
                  : t("payWithPaypal")}
        </button>

        {error ? <div className="mt-3 text-sm text-red-500">{error}</div> : null}
      </div>
    </div>
  );
}

export default function CreditsPage() {
  const tc = useTranslations("common");
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-zinc-500" style={{ background: "#0a0a0b" }}>{tc("loading")}</div>}>
      <CreditsPageContent />
    </Suspense>
  );
}

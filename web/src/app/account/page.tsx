"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { supabase } from "@/lib/supabaseClient";
import { useAuth } from "@/components/AuthProvider";
import { useLocaleSettings } from "@/components/LocaleProvider";
import { SiteHeader } from "@/components/SiteHeader";
import { trackEvent } from "@/lib/analytics";
import { SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config";

type Profile = { userId: string; nickname: string };
type RewardsTab = "overview" | "monthly-payouts" | "monthly-withdrawals";

export default function AccountPage() {
  const router = useRouter();
  const { user, session, loading: authLoading, signOut } = useAuth();
  const token = session?.access_token ?? "";
  const t = useTranslations();
  const { uiLanguage, creationLanguage, contentLanguages, updateLanguageSettings, loaded: localeLoaded } = useLocaleSettings();
  const [langSaving, setLangSaving] = useState(false);
  const [langSaved, setLangSaved] = useState(false);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [rewardThisMonthUsd, setRewardThisMonthUsd] = useState<number | null>(null);
  const [rewardThisMonthClipUsd, setRewardThisMonthClipUsd] = useState<number | null>(null);
  const [rewardThisMonthAgentShareUsd, setRewardThisMonthAgentShareUsd] = useState<number | null>(null);
  const [rewardTotalUsd, setRewardTotalUsd] = useState<number | null>(null);
  const [rewardBalanceUsd, setRewardBalanceUsd] = useState<number | null>(null);
  const [monthlyPayouts, setMonthlyPayouts] = useState<Array<{ month: string; amountUsd: number }>>([]);
  const [monthlyWithdrawals, setMonthlyWithdrawals] = useState<
    Array<{
      month: string;
      requestedUsd: number;
      completedUsd: number;
      pendingUsd: number;
      failedUsd: number;
      requestCount: number;
    }>
  >([]);
  const [rewardsTab, setRewardsTab] = useState<RewardsTab>("overview");
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [rewardsError, setRewardsError] = useState<string | null>(null);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState<string | null>(null);
  const [pendingWithdrawal, setPendingWithdrawal] = useState<{
    amountUsd: number;
    createdAt: string | null;
  } | null>(null);
  const [paypalEmail, setPaypalEmail] = useState("");
  const [paypalEmailSaved, setPaypalEmailSaved] = useState<string | null>(null);
  const [payoutDestLoading, setPayoutDestLoading] = useState(false);
  const [payoutDestSaving, setPayoutDestSaving] = useState(false);
  const [payoutDestError, setPayoutDestError] = useState<string | null>(null);
  const [payoutDestSuccess, setPayoutDestSuccess] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirm, setNewPasswordConfirm] = useState("");
  const [passwordChanging, setPasswordChanging] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  const [subscriptionPlan, setSubscriptionPlan] = useState<{
    id?: string;
    name: string;
    periodEndsAt: string;
    subscriptionId?: string | null;
    canCancelRenewal?: boolean;
    renewalCancelled?: boolean;
    scriptGenerateLimitPerClip?: number;
    canCreatePrivateAgent?: boolean;
    canSelectVoiceManually?: boolean;
    canExportVideo?: boolean;
    noWatermark?: boolean;
  } | null>(null);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [cancelPlanLoading, setCancelPlanLoading] = useState(false);
  const [cancelPlanError, setCancelPlanError] = useState<string | null>(null);

  const minWithdrawUsd = 5;
  const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent("/account")}`);
      return;
    }
    void trackEvent("page_view", { page: "account" });
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user?.id || !token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(user.id)}/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { nickname?: string; userId?: string; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setProfileError(data.error ?? "Profile not found");
          return;
        }
        setProfile({ userId: data.userId ?? user.id, nickname: data.nickname ?? "User" });
      } catch {
        if (!cancelled) setProfileError("Failed to load profile");
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, token]);

  const loadRewards = useCallback(async () => {
    if (!user?.id || !token) return;
    setRewardsLoading(true);
    setRewardsError(null);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.id)}/rewards`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as {
        rewardThisMonthUsd?: number;
        rewardThisMonthClipUsd?: number;
        rewardThisMonthAgentShareUsd?: number;
        rewardTotalUsd?: number;
        rewardBalanceUsd?: number;
        monthlyPayouts?: Array<{ month: string; amountUsd: number }>;
        monthlyWithdrawals?: Array<{
          month: string;
          requestedUsd: number;
          completedUsd: number;
          pendingUsd: number;
          failedUsd: number;
          requestCount: number;
        }>;
        pendingWithdrawal?: { amountUsd: number; createdAt: string | null } | null;
        error?: string;
      };
      if (!res.ok) {
        setRewardsError(data.error ?? "Failed to load rewards");
      } else {
        setRewardThisMonthUsd(data.rewardThisMonthUsd ?? 0);
        setRewardThisMonthClipUsd(data.rewardThisMonthClipUsd ?? 0);
        setRewardThisMonthAgentShareUsd(data.rewardThisMonthAgentShareUsd ?? 0);
        setRewardTotalUsd(data.rewardTotalUsd ?? 0);
        setRewardBalanceUsd(data.rewardBalanceUsd ?? 0);
        setMonthlyPayouts(data.monthlyPayouts ?? []);
        setMonthlyWithdrawals(data.monthlyWithdrawals ?? []);
        setPendingWithdrawal(data.pendingWithdrawal ?? null);
      }
    } catch {
      setRewardsError("Failed to load rewards");
    } finally {
      setRewardsLoading(false);
    }
  }, [user?.id, token]);

  useEffect(() => {
    if (!user?.id || !token) return;
    void loadRewards();
  }, [user?.id, token, loadRewards]);

  useEffect(() => {
    if (!user?.id || !token) return;
    let cancelled = false;
    setSubscriptionLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/subscription/plan", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const data = (await res.json()) as {
          plan?: {
            id?: string;
            name?: string;
            scriptGenerateLimitPerClip?: number;
            canCreatePrivateAgent?: boolean;
            canSelectVoiceManually?: boolean;
            canExportVideo?: boolean;
            noWatermark?: boolean;
          };
          periodEndsAt?: string | null;
          subscriptionId?: string | null;
          canCancelRenewal?: boolean;
          renewalCancelled?: boolean;
          error?: string;
        };
        if (cancelled) return;
        if (res.ok && data.plan?.name && data.periodEndsAt && new Date(data.periodEndsAt) > new Date()) {
          setSubscriptionPlan({
            id: data.plan.id,
            name: data.plan.name,
            periodEndsAt: data.periodEndsAt,
            subscriptionId: data.subscriptionId ?? null,
            canCancelRenewal: data.canCancelRenewal ?? false,
            renewalCancelled: data.renewalCancelled ?? false,
            scriptGenerateLimitPerClip: data.plan.scriptGenerateLimitPerClip,
            canCreatePrivateAgent: data.plan.canCreatePrivateAgent,
            canSelectVoiceManually: data.plan.canSelectVoiceManually,
            canExportVideo: data.plan.canExportVideo,
            noWatermark: data.plan.noWatermark,
          });
        } else {
          setSubscriptionPlan(null);
        }
      } catch {
        if (!cancelled) setSubscriptionPlan(null);
      } finally {
        if (!cancelled) setSubscriptionLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setPayoutDestLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/rewards/payout-destination", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = (await res.json()) as { paypalEmail?: string | null; error?: string };
        if (cancelled) return;
        if (res.ok) {
          const email = data.paypalEmail ?? "";
          setPaypalEmail(email);
          setPaypalEmailSaved(email || null);
        }
      } catch {
        if (!cancelled) setPayoutDestError("Failed to load payout destination");
      } finally {
        if (!cancelled) setPayoutDestLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const savePaypalEmail = useCallback(async (rawEmail: string | null) => {
    if (!token) return;
    const email = (rawEmail ?? "").trim();
    if (email && !isValidEmail(email)) {
      setPayoutDestError(t("account.invalidPaypalEmail"));
      setPayoutDestSuccess(null);
      return;
    }
    setPayoutDestSaving(true);
    setPayoutDestError(null);
    setPayoutDestSuccess(null);
    try {
      const res = await fetch("/api/rewards/payout-destination", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ paypalEmail: email || null }),
      });
      const data = (await res.json()) as { paypalEmail?: string | null; error?: string };
      if (!res.ok) {
        setPayoutDestError(data.error ?? "Failed to save");
        return;
      }
      setPaypalEmailSaved(data.paypalEmail ?? null);
      setPayoutDestSuccess(email ? t("account.paypalSaved") : t("account.paypalRemoved"));
    } catch {
      setPayoutDestError("Failed to save");
    } finally {
      setPayoutDestSaving(false);
    }
  }, [token]);

  const handleSavePaypalEmail = useCallback(async () => {
    await savePaypalEmail(paypalEmail);
  }, [paypalEmail, savePaypalEmail]);

  const handleResetPaypalEmail = useCallback(async () => {
    if (!confirm(t("account.removePaypalConfirm"))) return;
    setPaypalEmail("");
    await savePaypalEmail(null);
  }, [savePaypalEmail]);

  const handleCancelPlan = useCallback(async () => {
    if (!token || !subscriptionPlan?.canCancelRenewal || !subscriptionPlan?.subscriptionId) return;
    if (!confirm(t("account.cancelConfirm"))) return;
    setCancelPlanLoading(true);
    setCancelPlanError(null);
    try {
      const res = await fetch("/api/credits/subscription/cancel", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setCancelPlanError(data.error ?? "Failed to cancel");
        return;
      }
      setSubscriptionPlan((prev) =>
        prev ? { ...prev, subscriptionId: null } : null
      );
    } catch {
      setCancelPlanError("Failed to cancel");
    } finally {
      setCancelPlanLoading(false);
    }
  }, [token, subscriptionPlan?.canCancelRenewal, subscriptionPlan?.subscriptionId]);

  const handleWithdraw = useCallback(async () => {
    if (!token || !user?.id) return;
    const amount = parseFloat(withdrawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setWithdrawError(t("account.enterValidAmount"));
      return;
    }
    if (amount < minWithdrawUsd) {
      setWithdrawError(t("account.minWithdrawal", { min: minWithdrawUsd }));
      return;
    }
    if (rewardBalanceUsd != null && amount > rewardBalanceUsd) {
      setWithdrawError(t("account.insufficientBalance"));
      return;
    }
    setWithdrawing(true);
    setWithdrawError(null);
    setWithdrawSuccess(null);
    try {
      const res = await fetch("/api/rewards/withdraw", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ amountUsd: amount }),
      });
      const data = (await res.json()) as {
        status?: "pending" | "completed" | "failed";
        balanceRolledBack?: boolean | null;
        createdAt?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setWithdrawError(data.error ?? t("account.withdrawalFailed"));
        await loadRewards();
        return;
      }

      if (data.status === "failed") {
        setWithdrawError(
          data.balanceRolledBack === false
            ? t("account.payoutFailedNoRollback")
            : t("account.payoutFailed")
        );
        await loadRewards();
        return;
      }

      setWithdrawAmount("");
      if (data.status === "completed") {
        setPendingWithdrawal(null);
        setWithdrawSuccess(t("account.withdrawalCompleted", { amount: amount.toFixed(2) }));
      } else {
        setPendingWithdrawal({ amountUsd: amount, createdAt: data.createdAt ?? new Date().toISOString() });
        setWithdrawSuccess(t("account.withdrawalSubmitted", { amount: amount.toFixed(2) }));
      }
      await loadRewards();
    } catch {
      setWithdrawError(t("account.withdrawalFailed"));
    } finally {
      setWithdrawing(false);
    }
  }, [token, user?.id, withdrawAmount, rewardBalanceUsd, loadRewards]);

  const handleChangePassword = useCallback(async () => {
    if (!user?.email) return;
    setPasswordError(null);
    setPasswordSuccess(null);
    if (newPassword !== newPasswordConfirm) {
      setPasswordError(t("account.passwordMismatch"));
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError(t("account.passwordTooShort"));
      return;
    }
    if (!currentPassword.trim()) {
      setPasswordError(t("account.enterCurrentPassword"));
      return;
    }
    setPasswordChanging(true);
    try {
      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (signInErr) {
        setPasswordError(t("account.currentPasswordIncorrect"));
        return;
      }
      const { error: updateErr } = await supabase.auth.updateUser({ password: newPassword });
      if (updateErr) {
        setPasswordError(updateErr.message ?? t("account.passwordChangeFailed"));
        return;
      }
      setCurrentPassword("");
      setNewPassword("");
      setNewPasswordConfirm("");
      setPasswordSuccess(t("account.passwordChanged"));
    } catch {
      setPasswordError(t("account.passwordChangeFailed"));
    } finally {
      setPasswordChanging(false);
    }
  }, [user?.email, currentPassword, newPassword, newPasswordConfirm]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center lg-pl-sidebar">
        <div className="text-zinc-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-dvh overflow-x-hidden overflow-y-auto relative text-zinc-100 lg-pl-sidebar">
      <SiteHeader />

      <main className="max-w-5xl mx-auto px-6 py-10 relative z-10">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="mb-4 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-zinc-400 text-sm hover:bg-white/10 hover:text-zinc-200 transition-all"
        >
          {t("common.back")}
        </button>
        <div className="mb-8 rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10 p-6">
          <h1 className="text-2xl font-semibold text-gray-100">
            {profileError ? t("account.title") : (profile ? profile.nickname : t("common.loading"))}
          </h1>
          {profileError ? (
            <p className="mt-2 text-sm text-red-500">{profileError}</p>
          ) : null}
        </div>

        <section className="mb-10 rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10 p-6">
          <h2 className="text-lg font-medium text-gray-100">{t("account.currentPlan")}</h2>
          {subscriptionLoading ? (
            <p className="mt-4 text-sm text-zinc-500">{t("common.loading")}</p>
          ) : subscriptionPlan ? (
            <div className="mt-4">
              <div className="rounded-xl bg-emerald-900/30 border border-emerald-400/20 p-4 max-w-md">
                <div className="text-sm font-medium text-emerald-400">{subscriptionPlan.name}</div>
                <p className="mt-1 text-xs text-zinc-400">
                  {t("account.periodEnds", { date: new Date(subscriptionPlan.periodEndsAt).toLocaleDateString(undefined, { dateStyle: "medium" }) })}
                </p>
                {subscriptionPlan.renewalCancelled ? (
                  <p className="mt-2 text-xs text-zinc-500">
                    {t("account.renewalCancelled")}
                  </p>
                ) : null}
                {!subscriptionPlan.canCancelRenewal && !subscriptionPlan.renewalCancelled ? (
                  <p className="mt-2 text-xs text-zinc-500">
                    {t("account.adminPlan")}
                  </p>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Link
                    href="/credits"
                    className="text-sm text-emerald-400 hover:text-emerald-300 underline"
                  >
                    {t("account.changePlan")}
                  </Link>
                  {subscriptionPlan.renewalCancelled && subscriptionPlan.id ? (
                    <Link
                      href={`/credits?plan=${encodeURIComponent(subscriptionPlan.id)}`}
                      className="text-sm text-emerald-300 hover:text-emerald-200 underline"
                    >
                      {t("account.continuePlan")}
                    </Link>
                  ) : null}
                  {subscriptionPlan.canCancelRenewal ? (
                    <button
                      type="button"
                      className="text-sm text-red-400 hover:text-red-300 underline disabled:opacity-50"
                      onClick={handleCancelPlan}
                      disabled={cancelPlanLoading}
                    >
                      {cancelPlanLoading ? t("account.cancelling") : t("account.cancelPlan")}
                    </button>
                  ) : null}
                </div>
                {cancelPlanError ? (
                  <p className="mt-2 text-sm text-red-500">{cancelPlanError}</p>
                ) : null}
              </div>
              {(subscriptionPlan.scriptGenerateLimitPerClip != null || subscriptionPlan.canCreatePrivateAgent != null || subscriptionPlan.canSelectVoiceManually != null || subscriptionPlan.canExportVideo != null) ? (
                <div className="mt-4 rounded-xl bg-emerald-900/30 border border-emerald-400/20 p-4 max-w-md">
                  <div className="text-sm font-medium text-emerald-400">{t("account.features")}</div>
                  <ul className="mt-3 w-full text-left space-y-3 text-base text-emerald-400">
                    {subscriptionPlan.scriptGenerateLimitPerClip != null && (
                      <li>
                        {subscriptionPlan.scriptGenerateLimitPerClip === 1
                          ? t("account.scriptGenPerClip1")
                          : t("account.scriptGenPerClipN", { count: subscriptionPlan.scriptGenerateLimitPerClip })}
                      </li>
                    )}
                    {subscriptionPlan.canCreatePrivateAgent != null && (
                      <li>{subscriptionPlan.canCreatePrivateAgent ? t("account.privateAgents") : t("account.publicAgentsOnly")}</li>
                    )}
                    {subscriptionPlan.canSelectVoiceManually != null && (
                      <li>{subscriptionPlan.canSelectVoiceManually ? t("account.manualVoice") : t("account.autoVoice")}</li>
                    )}
                    {subscriptionPlan.canExportVideo != null && (
                      <li>
                        {subscriptionPlan.canExportVideo
                          ? subscriptionPlan.noWatermark
                            ? t("account.videoExportNoWatermark")
                            : t("account.videoExportWatermark")
                          : t("account.noVideoExport")}
                      </li>
                    )}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-4">
              <div className="rounded-xl bg-white/5 border border-white/10 p-4 max-w-md">
                <div className="text-sm font-medium text-zinc-300">{t("account.freePlan")}</div>
                <p className="mt-1 text-xs text-zinc-500">
                  {t("account.freePlanDesc")}
                </p>
                <Link
                  href="/credits"
                  className="mt-3 inline-block text-sm text-emerald-400 hover:text-emerald-300 underline"
                >
                  {t("account.viewPlans")}
                </Link>
              </div>
              <div className="mt-4 rounded-xl bg-white/5 border border-white/10 p-4 max-w-md">
                <div className="text-sm font-medium text-zinc-300">{t("account.features")}</div>
                <ul className="mt-3 w-full text-left space-y-3 text-base text-zinc-300">
                  <li>{t("account.scriptGenPerClip1")}</li>
                  <li>{t("account.publicAgentsOnly")}</li>
                  <li>{t("account.autoVoice")}</li>
                  <li>{t("account.noVideoExport")}</li>
                </ul>
              </div>
            </div>
          )}
        </section>

        <section className="mb-10 rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10 p-6">
          <h2 className="text-lg font-medium text-gray-100">{t("account.languageSettings")}</h2>
          <p className="mt-1 text-sm text-zinc-500">{t("account.languageSettingsDesc")}</p>
          {!localeLoaded ? (
            <p className="mt-4 text-sm text-zinc-500">{t("common.loading")}</p>
          ) : (
            <div className="mt-4 space-y-5 max-w-sm">
              <div>
                <label className="block text-xs text-zinc-400 mb-1">{t("account.uiLanguage")}</label>
                <p className="text-xs text-zinc-600 mb-2">{t("account.uiLanguageDesc")}</p>
                <select
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-zinc-100"
                  value={uiLanguage}
                  disabled={langSaving}
                  onChange={async (e) => {
                    const val = e.target.value as Locale;
                    setLangSaving(true);
                    await updateLanguageSettings({ uiLanguage: val });
                    setLangSaving(false);
                  }}
                >
                  {SUPPORTED_LOCALES.map((loc) => (
                    <option key={loc} value={loc} className="bg-zinc-900 text-zinc-100">{LOCALE_LABELS[loc]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">{t("account.creationLanguage")}</label>
                <p className="text-xs text-zinc-600 mb-2">{t("account.creationLanguageDesc")}</p>
                <select
                  className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-zinc-100"
                  value={creationLanguage}
                  disabled={langSaving}
                  onChange={async (e) => {
                    const val = e.target.value as Locale;
                    setLangSaving(true);
                    setLangSaved(false);
                    await updateLanguageSettings({ creationLanguage: val });
                    setLangSaving(false);
                    setLangSaved(true);
                    setTimeout(() => setLangSaved(false), 2000);
                  }}
                >
                  {SUPPORTED_LOCALES.map((loc) => (
                    <option key={loc} value={loc} className="bg-zinc-900 text-zinc-100">{LOCALE_LABELS[loc]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">{t("account.contentLanguages")}</label>
                <p className="text-xs text-zinc-600 mb-2">{t("account.contentLanguagesDesc")}</p>
                <div className="space-y-2">
                  {SUPPORTED_LOCALES.map((loc) => {
                    const isCreation = loc === creationLanguage;
                    const checked = contentLanguages.includes(loc);
                    return (
                      <label key={loc} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="accent-emerald-400 w-4 h-4"
                          checked={checked || isCreation}
                          disabled={isCreation || langSaving}
                          onChange={async () => {
                            const next = checked
                              ? contentLanguages.filter((l) => l !== loc)
                              : [...contentLanguages, loc];
                            setLangSaving(true);
                            setLangSaved(false);
                            await updateLanguageSettings({ contentLanguages: next });
                            setLangSaving(false);
                            setLangSaved(true);
                            setTimeout(() => setLangSaved(false), 2000);
                          }}
                        />
                        <span className="text-sm text-zinc-200">
                          {LOCALE_LABELS[loc]}
                          {isCreation && <span className="text-xs text-zinc-500 ml-1">({t("account.creationLanguage")})</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              {langSaved && <p className="text-sm text-emerald-400">{t("account.saved")}</p>}
            </div>
          )}
        </section>

        <section className="mb-10 rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10 p-6">
          <h2 className="text-lg font-medium text-gray-100">{t("account.changePassword")}</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {t("account.changePasswordDesc")}
          </p>
          <div className="mt-4 space-y-3 max-w-sm">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">{t("account.currentPassword")}</label>
              <input
                type="password"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-zinc-100 placeholder:text-zinc-500"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={t("account.currentPassword")}
                disabled={passwordChanging}
                autoComplete="current-password"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">{t("account.newPassword")}</label>
              <input
                type="password"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-zinc-100 placeholder:text-zinc-500"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t("account.newPasswordPlaceholder")}
                disabled={passwordChanging}
                autoComplete="new-password"
                minLength={6}
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">{t("account.confirmNewPassword")}</label>
              <input
                type="password"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-zinc-100 placeholder:text-zinc-500"
                value={newPasswordConfirm}
                onChange={(e) => setNewPasswordConfirm(e.target.value)}
                placeholder={t("account.reenterPassword")}
                disabled={passwordChanging}
                autoComplete="new-password"
                minLength={6}
              />
            </div>
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-white/10 border border-white/10 text-zinc-100 text-sm font-medium hover:bg-white/15 disabled:opacity-50 transition-all"
              onClick={handleChangePassword}
              disabled={
                passwordChanging ||
                !currentPassword.trim() ||
                !newPassword.trim() ||
                !newPasswordConfirm.trim() ||
                newPassword !== newPasswordConfirm ||
                newPassword.length < 6
              }
            >
              {passwordChanging ? t("account.updating") : t("account.changePasswordBtn")}
            </button>
          </div>
          {passwordSuccess ? (
            <p className="mt-3 text-sm text-emerald-400">{passwordSuccess}</p>
          ) : null}
          {passwordError ? (
            <p className="mt-3 text-sm text-red-500">{passwordError}</p>
          ) : null}
        </section>

        <section className="mb-10 rounded-2xl backdrop-blur-xl bg-white/5 border border-white/10 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-medium text-gray-100">{t("account.rewards")}</h2>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg bg-white/10 border border-white/10 text-zinc-200 text-xs font-medium hover:bg-white/15 disabled:opacity-50 transition-all"
              onClick={() => void loadRewards()}
              disabled={rewardsLoading}
            >
              {rewardsLoading ? t("account.refreshing") : t("account.refresh")}
            </button>
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {t("account.rewardsSummary")}
          </p>
          {rewardsLoading ? (
            <p className="mt-4 text-sm text-zinc-500">{t("common.loading")}</p>
          ) : rewardsError ? (
            <p className="mt-4 text-sm text-red-500">{rewardsError}</p>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    rewardsTab === "overview"
                      ? "bg-emerald-500/20 border border-emerald-400/40 text-emerald-300"
                      : "bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10"
                  }`}
                  onClick={() => setRewardsTab("overview")}
                >
                  {t("account.tabOverview")}
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    rewardsTab === "monthly-payouts"
                      ? "bg-emerald-500/20 border border-emerald-400/40 text-emerald-300"
                      : "bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10"
                  }`}
                  onClick={() => setRewardsTab("monthly-payouts")}
                >
                  {t("account.tabMonthlyRewards")}
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    rewardsTab === "monthly-withdrawals"
                      ? "bg-emerald-500/20 border border-emerald-400/40 text-emerald-300"
                      : "bg-white/5 border border-white/10 text-zinc-300 hover:bg-white/10"
                  }`}
                  onClick={() => setRewardsTab("monthly-withdrawals")}
                >
                  {t("account.tabMonthlyWithdrawals")}
                </button>
              </div>

              {rewardsTab === "overview" ? (
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
                  <div className="rounded-xl bg-emerald-900/30 border border-emerald-400/20 p-4 h-full flex flex-col">
                    <div className="text-xs uppercase tracking-wider text-emerald-400 min-h-[2.5rem]">
                      {t("account.thisMonthClips")}
                    </div>
                    <div className="mt-auto text-xl font-semibold text-zinc-100">
                      ${rewardThisMonthClipUsd != null ? rewardThisMonthClipUsd.toFixed(2) : "0.00"}
                    </div>
                  </div>
                  <div className="rounded-xl bg-emerald-900/30 border border-emerald-400/20 p-4 h-full flex flex-col">
                    <div className="text-xs uppercase tracking-wider text-emerald-400 min-h-[2.5rem]">
                      {t("account.thisMonthAgentShares")}
                    </div>
                    <div className="mt-auto text-xl font-semibold text-zinc-100">
                      ${rewardThisMonthAgentShareUsd != null ? rewardThisMonthAgentShareUsd.toFixed(2) : "0.00"}
                    </div>
                  </div>
                  <div className="rounded-xl bg-emerald-900/30 border border-emerald-400/20 p-4 h-full flex flex-col">
                    <div className="text-xs uppercase tracking-wider text-emerald-400 min-h-[2.5rem]">
                      {t("account.thisMonth")}
                    </div>
                    <div className="mt-auto text-xl font-semibold text-zinc-100">
                      ${rewardThisMonthUsd != null ? rewardThisMonthUsd.toFixed(2) : "0.00"}
                    </div>
                  </div>
                  <div className="rounded-xl bg-emerald-900/30 border border-emerald-400/20 p-4 h-full flex flex-col">
                    <div className="text-xs uppercase tracking-wider text-emerald-400 min-h-[2.5rem]">
                      {t("account.totalEarned")}
                    </div>
                    <div className="mt-auto text-xl font-semibold text-zinc-100">
                      ${rewardTotalUsd != null ? rewardTotalUsd.toFixed(2) : "0.00"}
                    </div>
                  </div>
                  <div className="rounded-xl bg-emerald-900/30 border border-emerald-400/20 p-4 h-full flex flex-col">
                    <div className="text-xs uppercase tracking-wider text-emerald-400 min-h-[2.5rem]">
                      {t("account.availableToWithdraw")}
                    </div>
                    <div className="mt-auto text-xl font-semibold text-zinc-100">
                      ${rewardBalanceUsd != null ? rewardBalanceUsd.toFixed(2) : "0.00"}
                    </div>
                  </div>
                </div>
              ) : rewardsTab === "monthly-payouts" ? (
                <div className="mt-4 rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                  {monthlyPayouts.length === 0 ? (
                    <div className="p-4 text-sm text-zinc-500">{t("account.noMonthlyRewards")}</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-white/5 text-zinc-400">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium">{t("account.monthHeader")}</th>
                          <th className="text-right px-4 py-2 font-medium">{t("account.rewardsUsdHeader")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyPayouts.map((row) => (
                          <tr key={row.month} className="border-t border-white/10">
                            <td className="px-4 py-2 text-zinc-200">{row.month}</td>
                            <td className="px-4 py-2 text-right text-zinc-100">${row.amountUsd.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                  {monthlyWithdrawals.length === 0 ? (
                    <div className="p-4 text-sm text-zinc-500">{t("account.noMonthlyWithdrawals")}</div>
                  ) : (
                    <table className="w-full text-xs sm:text-sm">
                      <thead className="bg-white/5 text-zinc-400">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">{t("account.monthHeader")}</th>
                          <th className="text-right px-3 py-2 font-medium">{t("account.requestedHeader")}</th>
                          <th className="text-right px-3 py-2 font-medium">{t("account.completedHeader")}</th>
                          <th className="text-right px-3 py-2 font-medium">{t("account.pendingHeader")}</th>
                          <th className="text-right px-3 py-2 font-medium">{t("account.failedHeader")}</th>
                          <th className="text-right px-3 py-2 font-medium">{t("account.countHeader")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlyWithdrawals.map((row) => (
                          <tr key={row.month} className="border-t border-white/10">
                            <td className="px-3 py-2 text-zinc-200">{row.month}</td>
                            <td className="px-3 py-2 text-right text-zinc-100">${row.requestedUsd.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right text-emerald-300">${row.completedUsd.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right text-amber-300">${row.pendingUsd.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right text-red-300">${row.failedUsd.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right text-zinc-300">{row.requestCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
              <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="text-sm font-medium text-zinc-300">{t("account.paypalEmail")}</div>
                <p className="mt-1 text-xs text-zinc-500">
                  {t("account.paypalDesc")}
                </p>
                {!paypalEmailSaved && !payoutDestLoading ? (
                  <p className="mt-2 text-sm text-amber-400 font-medium">
                    {t("account.registerPaypal")}
                  </p>
                ) : null}
                {payoutDestLoading ? (
                  <p className="mt-2 text-sm text-zinc-500">{t("common.loading")}</p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <div>
                      <input
                        type="email"
                        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 w-64 text-zinc-100 placeholder:text-zinc-500"
                        value={paypalEmail}
                        onChange={(e) => setPaypalEmail(e.target.value)}
                        placeholder="paypal@example.com"
                        disabled={payoutDestSaving}
                      />
                    </div>
                    <button
                      type="button"
                      className="px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-zinc-100 text-sm font-medium hover:bg-white/15 disabled:opacity-50 transition-all"
                      onClick={handleSavePaypalEmail}
                      disabled={payoutDestSaving || paypalEmail.trim() === (paypalEmailSaved ?? "")}
                    >
                      {payoutDestSaving ? t("account.saving") : t("common.save")}
                    </button>
                    {paypalEmailSaved ? (
                      <button
                        type="button"
                        className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-zinc-300 text-sm font-medium hover:bg-white/10 disabled:opacity-50 transition-all"
                        onClick={handleResetPaypalEmail}
                        disabled={payoutDestSaving}
                      >
                        {t("account.reset")}
                      </button>
                    ) : null}
                  </div>
                )}
                {payoutDestSuccess ? <p className="mt-2 text-sm text-emerald-400">{payoutDestSuccess}</p> : null}
                {payoutDestError ? <p className="mt-2 text-sm text-red-500">{payoutDestError}</p> : null}
              </div>
              {pendingWithdrawal ? (
                <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-900/20 px-4 py-3 text-sm text-amber-300">
                  <strong>{t("account.pendingWithdrawal")}</strong> ${pendingWithdrawal.amountUsd.toFixed(2)}
                  {pendingWithdrawal.createdAt
                    ? ` (${new Date(pendingWithdrawal.createdAt).toLocaleDateString()})`
                    : ""}
                  {t("account.pendingWithdrawalDesc")}
                </div>
              ) : (
                <>
                  {!paypalEmailSaved ? (
                    <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-900/20 px-4 py-3 text-sm text-amber-300">
                      {t("account.withdrawRequirePaypal")}
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-wrap items-end gap-2">
                      <div>
                        <label className="block text-xs text-zinc-500">
                          {t("account.withdrawLabel", { min: minWithdrawUsd })}
                        </label>
                        <input
                          type="number"
                          min={minWithdrawUsd}
                          step="0.01"
                          className="mt-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 w-32 text-zinc-100"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          placeholder="0.00"
                          disabled={withdrawing}
                        />
                      </div>
                      <button
                        type="button"
                        className="px-4 py-2 rounded-lg font-semibold shadow-lg shadow-emerald-400/25 disabled:opacity-50 transition-all"
                        style={{ background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#002e1f" }}
                        onClick={handleWithdraw}
                        disabled={
                          withdrawing ||
                          !withdrawAmount.trim() ||
                          (rewardBalanceUsd != null && rewardBalanceUsd < minWithdrawUsd)
                        }
                      >
                        {withdrawing ? t("account.requesting") : t("account.withdraw")}
                      </button>
                    </div>
                  )}
                </>
              )}
              {withdrawSuccess ? (
                <p className="mt-2 text-sm text-emerald-400">{withdrawSuccess}</p>
              ) : null}
              {withdrawError ? (
                <p className="mt-2 text-sm text-red-500">{withdrawError}</p>
              ) : null}
            </>
          )}
        </section>

        <section className="mt-10 pt-6 border-t border-white/10">
          <button
            type="button"
            className="px-5 py-2.5 rounded-xl text-sm font-medium text-red-400 border border-red-500/30 bg-red-900/10 hover:bg-red-900/20 transition-colors"
            onClick={async () => {
              await signOut();
              router.replace("/");
            }}
          >
            {t("account.signOut")}
          </button>
        </section>

      </main>
    </div>
  );
}
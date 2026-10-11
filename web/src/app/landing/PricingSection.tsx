"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { FadeInOnScroll } from "./FadeInOnScroll";
import { CREDIT_PLANS, PLAN_IDS } from "@/lib/plans";

const BADGE_KEYS: Record<string, string | undefined> = {
  plus: "badgePopular",
  ultra: "badgeBestValue",
};

export function PricingSection() {
  const t = useTranslations("landing");
  return (
    <section className="relative px-6 py-24">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[400px] w-[600px] -translate-x-1/2 rounded-full bg-emerald-500/8 blur-[140px]" />

      <div className="mx-auto max-w-6xl">
        <FadeInOnScroll className="text-center">
          <h2
            className="text-3xl font-bold tracking-tight text-white sm:text-4xl"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            {t("pricingTitle")}
          </h2>
          <p className="mt-3 text-zinc-400">{t("pricingSubtitle")}</p>
        </FadeInOnScroll>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_IDS.map((planId, i) => {
            const plan = CREDIT_PLANS[planId];
            const badgeKey = BADGE_KEYS[planId];
            return (
              <FadeInOnScroll key={planId} delay={i * 0.08}>
                <div
                  className={`relative flex flex-col rounded-2xl border p-6 backdrop-blur-xl transition-all hover:shadow-lg hover:shadow-emerald-500/5 ${
                    badgeKey
                      ? "border-emerald-400/30 bg-emerald-500/5"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  {badgeKey && (
                    <span
                      className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-0.5 text-xs font-semibold"
                      style={{
                        background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)",
                        color: "#002e1f",
                      }}
                    >
                      {t(badgeKey)}
                    </span>
                  )}
                  <h3 className="text-base font-semibold text-white">{plan.name}</h3>
                  <div className="mt-3">
                    <span className="text-3xl font-bold text-white">${plan.priceUsd}</span>
                    <span className="text-sm text-zinc-500"> {t("perMonth")}</span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-400">
                    {t("creditsPerMonth", { count: plan.credits.toLocaleString() })}
                  </p>
                  <div className="mt-4 flex-1 space-y-2 border-t border-white/10 pt-4">
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <span className="text-emerald-400">✓</span>
                      {t("scriptRegenPerClip", { count: plan.scriptGenerateLimitPerClip })}
                    </div>
                    {plan.canSelectVoiceManually && (
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <span className="text-emerald-400">✓</span>
                        {t("manualVoiceSelection")}
                      </div>
                    )}
                    {plan.canExportVideo && (
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <span className="text-emerald-400">✓</span>
                        {plan.noWatermark ? t("videoExportNoWatermark") : t("videoExportWatermark")}
                      </div>
                    )}
                    {plan.canCreatePrivateAgent && (
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <span className="text-emerald-400">✓</span>
                        {t("privateAgents")}
                      </div>
                    )}
                  </div>
                </div>
              </FadeInOnScroll>
            );
          })}
        </div>

        <FadeInOnScroll delay={0.3} className="mt-10 text-center">
          <Link
            href="/credits"
            className="text-sm font-medium text-emerald-400 transition-colors hover:text-emerald-300"
          >
            {t("viewPlans")}
          </Link>
        </FadeInOnScroll>
      </div>
    </section>
  );
}

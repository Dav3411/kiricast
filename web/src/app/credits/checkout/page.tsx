"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

function CreditsCheckoutPageContent() {
  const t = useTranslations("credits");
  const tc = useTranslations("common");
  const params = useSearchParams();
  const planId = params.get("planId") ?? "starter";
  const credits = params.get("credits") ?? "0";
  const amountUsd = params.get("amountUsd") ?? "";

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      <div className="max-w-2xl mx-auto px-6 py-12">
        <div className="text-2xl font-semibold">{t("checkout")}</div>
        <div className="mt-2 text-sm text-zinc-500">
          {t("checkoutSetupNote")}
        </div>

        <div className="mt-6 rounded-2xl p-6 green-card">
          <div className="text-xs uppercase tracking-widest text-white">{t("selectedPlan")}</div>
          <div className="mt-1 text-lg font-semibold">
            {t("checkoutCredits", { planId, credits })}
          </div>
          <div className="text-sm text-zinc-100/80">
            {amountUsd ? t("amount", { amount: amountUsd }) : t("amountNone")}
          </div>
        </div>

        <div className="mt-6 flex gap-2">
          <Link
            href="/credits"
            className="inline-flex items-center px-3 py-2 rounded-lg green-button text-sm"
          >
            {t("backToPlans")}
          </Link>
          <Link
            href="/series/create"
            className="inline-flex items-center px-3 py-2 rounded-lg green-button text-sm"
          >
            {t("createSeries")}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function CreditsCheckoutPage() {
  const tc = useTranslations("common");
  return (
    <Suspense fallback={<div className="min-h-screen bg-white flex items-center justify-center text-zinc-500">{tc("loading")}</div>}>
      <CreditsCheckoutPageContent />
    </Suspense>
  );
}

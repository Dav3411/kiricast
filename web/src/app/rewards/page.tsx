"use client";

import { useTranslations } from "next-intl";

export default function RewardsPage() {
  const t = useTranslations("rewards");
  const tc = useTranslations("common");

  return (
    <div className="h-dvh overflow-x-hidden overflow-y-auto text-zinc-100 relative" style={{ background: "#0a0a0b" }}>
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-[500px] h-[500px] bg-emerald-500/15 rounded-full blur-[120px]" />
        <div className="absolute -bottom-40 -left-40 w-[400px] h-[400px] bg-teal-500/10 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-400/5 rounded-full blur-[150px]" />
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12 relative z-10">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="mb-6 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg backdrop-blur-xl bg-white/5 border border-white/10 hover:bg-white/10 text-zinc-400 hover:text-zinc-200 text-sm transition-all"
        >
          {tc("back")}
        </button>

        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl" style={{ color: "#A4F4CF" }}>
          {t("pageTitle")}
        </h1>
        <p className="mt-4 text-zinc-400 leading-relaxed">
          {t("pageDescription")}
        </p>

        <div className="mt-10 space-y-8">
          {/* How it works */}
          <section
            className="rounded-2xl border border-emerald-300/20 p-6 sm:p-8"
            style={{ background: "linear-gradient(135deg, #064e3b, #065f46)" }}
          >
            <h2 className="text-xl font-semibold text-white">{t("howItWorks")}</h2>
            <ul className="mt-4 space-y-3 text-sm leading-relaxed text-emerald-100/80">
              <li className="flex gap-3">
                <span className="mt-0.5 shrink-0 text-base" style={{ color: "#A4F4CF" }}>1.</span>
                <span>{t("step1")}</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 shrink-0 text-base" style={{ color: "#A4F4CF" }}>2.</span>
                <span>{t("step2")}</span>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 shrink-0 text-base" style={{ color: "#A4F4CF" }}>3.</span>
                <span>{t("step3")}</span>
              </li>
            </ul>
          </section>

          {/* Eligibility */}
          <section className="rounded-2xl border border-white/10 backdrop-blur-xl p-6 sm:p-8" style={{ background: "rgba(255,255,255,0.04)" }}>
            <h2 className="text-xl font-semibold text-white">{t("eligibility")}</h2>
            <ul className="mt-4 space-y-2.5 text-sm text-zinc-300">
              <li className="flex items-center gap-2">
                <span style={{ color: "#A4F4CF" }}>✓</span>
                {t("eligibility1")}
              </li>
              <li className="flex items-center gap-2">
                <span style={{ color: "#A4F4CF" }}>✓</span>
                {t("eligibility2")}
              </li>
              <li className="flex items-center gap-2">
                <span style={{ color: "#A4F4CF" }}>✓</span>
                {t("eligibility3")}
              </li>
            </ul>
          </section>

          {/* FAQ */}
          <section className="rounded-2xl border border-white/10 backdrop-blur-xl p-6 sm:p-8" style={{ background: "rgba(255,255,255,0.04)" }}>
            <h2 className="text-xl font-semibold text-white">{t("faq")}</h2>
            <div className="mt-4 space-y-4 text-sm">
              <div>
                <div className="font-medium text-zinc-200">{t("faq1q")}</div>
                <div className="mt-1 text-zinc-400">{t("faq1a")}</div>
              </div>
              <div>
                <div className="font-medium text-zinc-200">{t("faq2q")}</div>
                <div className="mt-1 text-zinc-400">{t("faq2a")}</div>
              </div>
              <div>
                <div className="font-medium text-zinc-200">{t("faq3q")}</div>
                <div className="mt-1 text-zinc-400">{t("faq3a")}</div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

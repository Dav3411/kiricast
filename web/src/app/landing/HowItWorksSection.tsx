"use client";

import { useTranslations } from "next-intl";
import { FadeInOnScroll } from "./FadeInOnScroll";

const STEP_ICONS = [
  (
    <svg key="icon1" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7CEDA3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="7" r="4" />
      <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M21 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
  ),
  (
    <svg key="icon2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7CEDA3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
    </svg>
  ),
  (
    <svg key="icon3" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7CEDA3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  ),
];

const STEP_KEYS = [
  { titleKey: "step1Title", descKey: "step1Desc" },
  { titleKey: "step2Title", descKey: "step2Desc" },
  { titleKey: "step3Title", descKey: "step3Desc" },
] as const;

export function HowItWorksSection() {
  const t = useTranslations("landing");
  return (
    <section className="relative px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <FadeInOnScroll className="text-center">
          <h2
            className="text-3xl font-bold tracking-tight text-white sm:text-4xl"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            {t("howItWorksTitle")}
          </h2>
          <p className="mt-3 text-zinc-400">{t("howItWorksSubtitle")}</p>
        </FadeInOnScroll>

        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          {STEP_KEYS.map((step, i) => (
            <FadeInOnScroll key={step.titleKey} delay={i * 0.1}>
              <div className="group relative rounded-2xl border border-white/10 bg-white/5 p-8 backdrop-blur-xl transition-all hover:border-emerald-400/30 hover:shadow-lg hover:shadow-emerald-500/5">
                <div
                  className="mb-4 flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold"
                  style={{
                    background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)",
                    color: "#002e1f",
                  }}
                >
                  {i + 1}
                </div>
                <div className="mb-3">{STEP_ICONS[i]}</div>
                <h3 className="text-lg font-semibold text-white">{t(step.titleKey)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{t(step.descKey)}</p>
              </div>
            </FadeInOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}

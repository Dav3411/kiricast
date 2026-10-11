"use client";

import { useTranslations } from "next-intl";
import { FadeInOnScroll } from "./FadeInOnScroll";

const FEATURE_ICONS = [
  (
    <svg key="heart" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7CEDA3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  ),
  (
    <svg key="star" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7CEDA3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  (
    <svg key="share" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7CEDA3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" x2="12" y1="2" y2="15" />
    </svg>
  ),
];

const FEATURE_KEYS = [
  { titleKey: "socialLikesTitle", descKey: "socialLikesDesc" },
  { titleKey: "socialSubscribeTitle", descKey: "socialSubscribeDesc" },
  { titleKey: "socialShareTitle", descKey: "socialShareDesc" },
] as const;

export function SocialSection() {
  const t = useTranslations("landing");
  return (
    <section className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <FadeInOnScroll className="text-center">
          <h2
            className="text-3xl font-bold tracking-tight text-white sm:text-4xl"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            {t("socialTitle")}
          </h2>
          <p className="mt-3 text-zinc-400">{t("socialSubtitle")}</p>
        </FadeInOnScroll>

        <div className="mt-14 grid gap-6 sm:grid-cols-3">
          {FEATURE_KEYS.map((f, i) => (
            <FadeInOnScroll key={f.titleKey} delay={i * 0.1}>
              <div className="flex h-full flex-col items-center rounded-2xl border border-white/10 bg-white/5 p-8 text-center backdrop-blur-xl transition-all hover:border-emerald-400/30">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
                  {FEATURE_ICONS[i]}
                </div>
                <h3 className="mt-4 text-base font-semibold text-white">{t(f.titleKey)}</h3>
                <p className="mt-2 text-sm text-zinc-400">{t(f.descKey)}</p>
              </div>
            </FadeInOnScroll>
          ))}
        </div>
      </div>
    </section>
  );
}

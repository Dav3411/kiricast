"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { FadeInOnScroll } from "./FadeInOnScroll";

export function HeroSection() {
  const t = useTranslations("landing");
  return (
    <section className="relative flex min-h-[90vh] flex-col items-center justify-center px-6 pt-16 text-center">
      {/* Background blurs */}
      <div className="pointer-events-none absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-emerald-500/15 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-[400px] w-[400px] rounded-full bg-teal-500/10 blur-[100px]" />
      <div className="pointer-events-none absolute top-1/3 left-1/2 h-[300px] w-[300px] -translate-x-1/2 rounded-full bg-emerald-600/10 blur-[100px]" />

      <FadeInOnScroll>
        <h1
          className="text-5xl font-bold leading-tight tracking-tight sm:text-6xl md:text-7xl"
          style={{ fontFamily: "var(--font-space-grotesk)" }}
        >
          <span
            style={{
              backgroundImage: "linear-gradient(135deg, #A4F4CF, #7CEDA3)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            {t("heroTitle1")}
          </span>
          <br />
          <span className="text-white">{t("heroTitle2")}</span>
        </h1>
      </FadeInOnScroll>

      <FadeInOnScroll delay={0.15}>
        <p className="mx-auto mt-6 max-w-xl text-lg text-zinc-400 sm:text-xl">
          {t("heroSubtitle")}
        </p>
      </FadeInOnScroll>

      <FadeInOnScroll delay={0.3}>
        <div className="mt-10">
          <Link
            href="/login?mode=signup"
            className="rounded-2xl px-8 py-3.5 text-base font-semibold transition-all hover:shadow-lg hover:shadow-emerald-400/25"
            style={{
              background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)",
              color: "#002e1f",
            }}
          >
            {t("getStartedFree")}
          </Link>
        </div>
      </FadeInOnScroll>

      <FadeInOnScroll delay={0.45} className="w-full max-w-3xl">
        <Link
          href="/home"
          className="group relative mt-16 block w-full overflow-hidden rounded-2xl border border-emerald-400/40 px-8 py-8 text-center transition-all hover:scale-[1.06] hover:border-emerald-400/70"
          style={{
            background: "linear-gradient(135deg, rgba(164,244,207,0.08), rgba(124,237,163,0.04))",
          }}
        >
          <div className="relative">
            <div className="text-sm text-zinc-400">{t("exploreWithoutSignup")}</div>
            <div
              className="mt-2 text-2xl font-bold sm:text-3xl"
              style={{
                backgroundImage: "linear-gradient(135deg, #A4F4CF, #7CEDA3)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              {t("browse")} <span className="inline-block transition-transform group-hover:translate-x-1" style={{ WebkitTextFillColor: "#A4F4CF" }}>→</span>
            </div>
          </div>
        </Link>
      </FadeInOnScroll>
    </section>
  );
}

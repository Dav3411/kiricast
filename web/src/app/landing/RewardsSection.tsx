"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { FadeInOnScroll } from "./FadeInOnScroll";

export function RewardsSection() {
  const t = useTranslations("landing");
  return (
    <section className="px-6 py-24">
      <div className="mx-auto max-w-6xl">
        <FadeInOnScroll>
          <Link
            href="/rewards"
            className="group relative block overflow-hidden rounded-3xl border border-emerald-500/20 p-10 sm:p-14 transition-all hover:border-emerald-500/40 hover:shadow-lg hover:shadow-emerald-500/10"
            style={{
              background: "linear-gradient(135deg, rgba(4, 120, 87, 0.3), rgba(5, 150, 105, 0.15))",
            }}
          >
            <div className="pointer-events-none absolute -right-20 -top-20 h-[300px] w-[300px] rounded-full bg-emerald-400/10 blur-[80px]" />

            <div className="relative flex flex-col items-start gap-8 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2
                  className="text-3xl font-bold tracking-tight text-white sm:text-4xl"
                  style={{ fontFamily: "var(--font-space-grotesk)" }}
                >
                  {t("rewardsTitle")}
                </h2>
                <p className="mt-4 max-w-lg text-sm leading-relaxed text-zinc-300">
                  {t("rewardsDesc1")}
                  <br className="hidden sm:block" />
                  {t("rewardsDesc2")}
                </p>
                <div className="mt-6 flex flex-col gap-2 text-sm text-zinc-300 sm:flex-row sm:gap-x-6">
                  <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> {t("rewardsBullet1")}</span>
                  <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> {t("rewardsBullet2")}</span>
                  <span className="flex items-center gap-1.5"><span className="text-emerald-400">✓</span> {t("rewardsBullet3")}</span>
                </div>
              </div>
              <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-4xl transition-transform group-hover:scale-110">
                💰
              </div>
            </div>
            <span className="absolute right-8 top-1/2 -translate-y-1/2 text-emerald-400/50 text-xl transition-transform group-hover:translate-x-1 hidden sm:block">→</span>
          </Link>
        </FadeInOnScroll>
      </div>
    </section>
  );
}

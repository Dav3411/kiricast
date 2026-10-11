"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/Logo";
import { FadeInOnScroll } from "./FadeInOnScroll";

export function FooterSection() {
  const t = useTranslations("landing");
  return (
    <>
      {/* Final CTA */}
      <section className="relative px-6 py-24">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[400px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/12 blur-[120px]" />
        <FadeInOnScroll className="relative text-center">
          <h2
            className="text-3xl font-bold tracking-tight text-white sm:text-4xl"
            style={{ fontFamily: "var(--font-space-grotesk)" }}
          >
            {t("ctaTitle")}
          </h2>
          <p className="mt-4 text-zinc-400">
            {t("ctaSubtitle")}
          </p>
          <div className="mt-8">
            <Link
              href="/login?mode=signup"
              className="inline-block rounded-2xl px-10 py-4 text-base font-semibold transition-all hover:shadow-lg hover:shadow-emerald-400/25"
              style={{
                background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)",
                color: "#002e1f",
              }}
            >
              {t("signUpFree")}
            </Link>
          </div>
        </FadeInOnScroll>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
          <Logo width={100} height={24} textOnly />
          <div className="flex items-center gap-6 text-xs text-zinc-500">
            <Link href="/terms" className="transition-colors hover:text-zinc-300">
              {t("footerTerms")}
            </Link>
            <Link href="/privacy" className="transition-colors hover:text-zinc-300">
              {t("footerPrivacy")}
            </Link>
          </div>
          <span className="text-xs text-zinc-600">
            {t("footerCopyright")}
          </span>
        </div>
      </footer>
    </>
  );
}

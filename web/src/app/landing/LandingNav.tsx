"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/Logo";

export function LandingNav() {
  const t = useTranslations("landing");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled
          ? "backdrop-blur-xl bg-zinc-950/80 border-b border-white/10"
          : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center">
          <Logo width={120} height={28} textOnly />
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:text-white"
          >
            {t("navSignIn")}
          </Link>
          <Link
            href="/login?mode=signup"
            className="rounded-lg px-5 py-2 text-sm font-semibold transition-all hover:shadow-lg hover:shadow-emerald-400/25"
            style={{
              background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)",
              color: "#002e1f",
            }}
          >
            {t("navGetStarted")}
          </Link>
        </div>
      </div>
    </nav>
  );
}

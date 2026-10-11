"use client";

import { useTranslations } from "next-intl";
import { FadeInOnScroll } from "./FadeInOnScroll";

const FEATURE_ICONS = ["🎭", "🖼️", "🎙️", "🌐"];
const FEATURE_KEYS = [
  "agentsFeature1",
  "agentsFeature2",
  "agentsFeature3",
  "agentsFeature4",
] as const;

export function AgentsSection() {
  const t = useTranslations("landing");
  return (
    <section className="relative px-6 py-24">
      <div className="pointer-events-none absolute -right-40 bottom-0 h-[350px] w-[350px] rounded-full bg-emerald-600/8 blur-[100px]" />
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-12 lg:flex-row lg:gap-16">
        {/* Left: Text */}
        <div className="flex-1">
          <FadeInOnScroll>
            <h2
              className="text-3xl font-bold tracking-tight text-white sm:text-4xl"
              style={{ fontFamily: "var(--font-space-grotesk)" }}
            >
              {t("agentsTitle1")}
              <br />
              <span
                style={{
                  backgroundImage: "linear-gradient(135deg, #A4F4CF, #7CEDA3)",
                  WebkitBackgroundClip: "text",
                  WebkitTextFillColor: "transparent",
                }}
              >
                {t("agentsTitle2")}
              </span>
            </h2>
            <p className="mt-4 text-zinc-400">
              {t("agentsDescription")}
            </p>
          </FadeInOnScroll>

          <div className="mt-8 space-y-4">
            {FEATURE_KEYS.map((key, i) => (
              <FadeInOnScroll key={key} delay={i * 0.08}>
                <div className="flex items-center gap-3">
                  <span className="text-lg">{FEATURE_ICONS[i]}</span>
                  <span className="text-sm text-zinc-300">{t(key)}</span>
                </div>
              </FadeInOnScroll>
            ))}
          </div>
        </div>

        {/* Right: Agent card mockup */}
        <FadeInOnScroll delay={0.15} className="flex-1">
          <div className="mx-auto w-full max-w-xs">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-xl">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/20 text-3xl">
                🤖
              </div>
              <div className="mt-4 text-center">
                <div className="text-base font-semibold text-white">{t("agentCardName")}</div>
                <div className="mt-1 text-xs text-zinc-500">{t("agentCardTraits")}</div>
              </div>
              <div className="mt-4 space-y-2">
                <div className="rounded-lg bg-white/5 p-3">
                  <span className="text-xs text-zinc-400">{t("agentCardPersonality")}</span>
                  <p className="mt-1 text-xs text-zinc-300">{t("agentCardPersonalityDesc")}</p>
                </div>
                <div className="rounded-lg bg-white/5 p-3">
                  <span className="text-xs text-zinc-400">{t("agentCardSpeakingStyle")}</span>
                  <p className="mt-1 text-xs text-zinc-300">{t("agentCardSpeakingStyleDesc")}</p>
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
                <span>⭐ {t("agentCardSubscribers", { count: 128 })}</span>
                <span>🎙️ {t("agentCardClips", { count: 42 })}</span>
              </div>
            </div>
          </div>
        </FadeInOnScroll>
      </div>
    </section>
  );
}

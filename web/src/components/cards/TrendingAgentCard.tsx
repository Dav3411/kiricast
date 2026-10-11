"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Agent } from "@/types/agent";
import { LANG_FLAGS } from "@/lib/langFlags";

type TrendingAgentCardProps = {
  agent: Agent;
  isSubscribed?: boolean;
  isLoggedIn?: boolean;
  onToggleSubscribe?: () => void;
  onHover?: (rect: DOMRect) => void;
  onHoverEnd?: () => void;
  className?: string;
};

export function TrendingAgentCard({
  agent,
  isSubscribed = false,
  isLoggedIn = false,
  onToggleSubscribe,
  onHover,
  onHoverEnd,
  className,
}: TrendingAgentCardProps) {
  const router = useRouter();
  const t = useTranslations("common");
  const [toggling, setToggling] = useState(false);
  const profileHref = `/agents/${encodeURIComponent(agent.id)}`;
  const createHref = `/series/create`;

  async function handleSubscribeClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!isLoggedIn || toggling || !onToggleSubscribe) return;
    setToggling(true);
    try { await onToggleSubscribe(); } finally { setToggling(false); }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(profileHref)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(profileHref); }
      }}
      onMouseEnter={(e) => onHover?.(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => onHoverEnd?.()}
      className={`flex-shrink-0 cursor-pointer group ${className ?? "w-36"}`}
      style={{ aspectRatio: "9/16" }}
    >
      <div className="relative w-full h-full rounded-2xl overflow-hidden shadow-xl border border-white/20 hover:border-emerald-400/40 transition">
        {agent.image_url ? (
          <img
            src={agent.image_url}
            alt={agent.name}
            className="absolute inset-0 w-full h-full object-cover transition group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-900/60 to-zinc-900" />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

        {agent.is_public !== false ? (
          <Link
            href={createHref}
            onClick={(e) => e.stopPropagation()}
            className="absolute top-3 right-3 px-2 py-1 rounded-lg backdrop-blur-sm bg-black/40 border border-white/20 text-white text-xs hover:bg-emerald-500/30 hover:border-emerald-400/50 transition"
          >
            {t("useInSeries")}
          </Link>
        ) : null}

        {agent.language && agent.language !== "en" && LANG_FLAGS[agent.language] ? (
          <div className="absolute top-3 left-3 px-1.5 py-0.5 rounded-md backdrop-blur-sm bg-black/40 border border-white/20 text-xs leading-none">
            {LANG_FLAGS[agent.language]}
          </div>
        ) : null}

        <div className="absolute bottom-0 left-0 right-0 p-2.5 flex flex-col gap-1">
          <div className="text-xs uppercase tracking-widest text-emerald-300">{t("agent")}</div>
          <div className="text-xs font-bold text-white line-clamp-1">{agent.name}</div>
          {agent.source === "user" && agent.is_public !== false && isLoggedIn && onToggleSubscribe ? (
            <div className="flex items-center justify-end mt-0.5">
              <button
                type="button"
                disabled={toggling}
                onClick={handleSubscribeClick}
                className={`shrink-0 min-w-[4.75rem] flex items-center justify-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition disabled:opacity-50 ${
                  isSubscribed
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/40"
                    : "bg-emerald-500 text-white hover:bg-emerald-400"
                }`}
              >
                <span>{isSubscribed ? "★" : "☆"}</span>
                {isSubscribed ? t("subscribed") : t("subscribe")}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { Agent } from "@/types/agent";
import { LANG_FLAGS } from "@/lib/langFlags";

type SubscribedAgentCardProps = {
  agent: Agent;
  onHover?: (rect: DOMRect) => void;
  onHoverEnd?: () => void;
};

export function SubscribedAgentCard({
  agent,
  onHover,
  onHoverEnd,
}: SubscribedAgentCardProps) {
  const router = useRouter();
  const t = useTranslations("common");
  const profileHref = `/agents/${encodeURIComponent(agent.id)}`;
  const createHref = `/series/create`;

  return (
    <div
      className="flex-shrink-0 w-28 flex flex-col items-center gap-2 cursor-pointer group"
      role="button"
      tabIndex={0}
      onClick={() => router.push(profileHref)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(profileHref);
        }
      }}
      onMouseEnter={(e) => onHover?.(e.currentTarget.getBoundingClientRect())}
      onMouseLeave={() => onHoverEnd?.()}
    >
      <div className="relative">
        {agent.image_url ? (
          <img
            src={agent.image_url}
            alt={agent.name}
            className="w-24 h-24 rounded-full object-cover ring-2 ring-white/20 group-hover:ring-emerald-400/60 transition"
          />
        ) : (
          <div className="w-24 h-24 rounded-full bg-emerald-100/20 border-2 border-white/20 group-hover:border-emerald-400/60 transition" />
        )}
        {agent.language && agent.language !== "en" && LANG_FLAGS[agent.language] ? (
          <span className="absolute -bottom-0.5 -right-0.5 text-xs leading-none bg-black/60 rounded-full px-1 py-0.5 border border-white/10">
            {LANG_FLAGS[agent.language]}
          </span>
        ) : null}
      </div>

      <div className="text-sm font-semibold text-gray-100 text-center line-clamp-1 w-full px-1">
        {agent.name}
      </div>

      {agent.is_public !== false ? (
        <Link
          href={createHref}
          className="w-full text-center px-2 py-1.5 rounded-lg border border-emerald-400/40 text-emerald-200 text-xs hover:bg-emerald-500/10 transition"
          onClick={(e) => e.stopPropagation()}
        >
          {t("useInSeries")}
        </Link>
      ) : null}
    </div>
  );
}

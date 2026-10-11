"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ClipPayload } from "@/types/clip";
import { formatDuration } from "@/lib/clipUtils";

type ClipCardProps = {
  clip: ClipPayload;
  showLikeCount?: boolean;
};

export function ClipCard({ clip, showLikeCount = false }: ClipCardProps) {
  const t = useTranslations("common");
  return (
    <Link
      href={`/clips/${encodeURIComponent(clip.id)}`}
      className="block rounded-2xl p-4 backdrop-blur-xl bg-white/5 border border-white/10 hover:border-white/20 hover:shadow-lg hover:shadow-emerald-500/10 transition"
    >
      <div className="text-sm font-medium text-zinc-100 line-clamp-2">
        {clip.title ?? t("untitled")}
      </div>
      <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
        {clip.durationSec != null ? (
          <span>{formatDuration(clip.durationSec)}</span>
        ) : null}
        {showLikeCount && (clip.likeCount ?? 0) > 0 ? (
          <span>&#9829; {clip.likeCount}</span>
        ) : null}
      </div>
    </Link>
  );
}

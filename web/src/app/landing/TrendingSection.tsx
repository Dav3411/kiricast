"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { FadeInOnScroll } from "./FadeInOnScroll";
import { useDominantColor } from "@/hooks/useDominantColor";
import { applyColorTransform } from "@/lib/colorUtils";
import type { ClipPayload, TimingLine } from "@/types/clip";
import type { Agent } from "@/types/agent";

const VIVID_COLOR_OPTS = { saturationBoost: 15.0, lighten: 0.65 };

const FALLBACK_COLORS = [
  "164, 244, 207", "255, 179, 179", "179, 212, 255", "255, 218, 163", "200, 179, 255",
  "164, 244, 232", "255, 179, 218", "179, 240, 179", "255, 230, 163", "179, 232, 255",
];
function fallbackColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[((hash % FALLBACK_COLORS.length) + FALLBACK_COLORS.length) % FALLBACK_COLORS.length];
}

function ensureContrast(a: string, b: string): [string, string] {
  const parse = (s: string) => s.split(",").map((v) => parseInt(v.trim(), 10)) as [number, number, number];
  const lum = (r: number, g: number, b: number) => r * 0.299 + g * 0.587 + b * 0.114;
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const dist = Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
  if (dist > 90) return [a, b];
  const lift = 0.6;
  if (lum(r1, g1, b1) >= lum(r2, g2, b2)) {
    const nr = Math.round(r1 + (255 - r1) * lift);
    const ng = Math.round(g1 + (255 - g1) * lift);
    const nb = Math.round(b1 + (255 - b1) * lift);
    return [`${nr}, ${ng}, ${nb}`, b];
  } else {
    const nr = Math.round(r2 + (255 - r2) * lift);
    const ng = Math.round(g2 + (255 - g2) * lift);
    const nb = Math.round(b2 + (255 - b2) * lift);
    return [a, `${nr}, ${ng}, ${nb}`];
  }
}

function getAgentImageUrl(id: string, agentsById: Map<string, Agent>): string {
  const agent = agentsById.get(id);
  if (agent?.image_url) return agent.image_url;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return `/api/agents/${encodeURIComponent(id)}/avatar`;
  }
  return `/agents/images/${id}.png`;
}

export function TrendingSection() {
  const t = useTranslations("landing");
  const [clips, setClips] = useState<ClipPayload[]>([]);
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [topAgents, setTopAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const [clipTimings, setClipTimings] = useState<Record<string, TimingLine[]>>({});

  const agentsById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of allAgents) map.set(a.id, a);
    return map;
  }, [allAgents]);

  const getClipSpeakers = useCallback(
    (clipId: string) => {
      const lines = clipTimings[clipId] ?? [];
      const seen = new Set<string>();
      const result: string[] = [];
      for (const line of lines) {
        const speaker = line.speaker;
        if (speaker && speaker !== "sfx" && speaker !== "narration" && !seen.has(speaker)) {
          seen.add(speaker);
          result.push(speaker);
        }
      }
      return result;
    },
    [clipTimings],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [resClips, resAgents] = await Promise.all([
          fetch("/api/clips?sort=trending&limit=6"),
          fetch("/api/agents"),
        ]);
        const clipsData = (await resClips.json()) as { clips?: ClipPayload[] };
        const agentsData = (await resAgents.json()) as { agents?: Agent[] };
        if (cancelled) return;
        const loadedClips = Array.isArray(clipsData.clips) ? clipsData.clips.slice(0, 6) : [];
        setClips(loadedClips);
        const all = Array.isArray(agentsData.agents) ? agentsData.agents : [];
        setAllAgents(all);
        setTopAgents(
          [...all].sort((a, b) => (b.subscriber_count ?? 0) - (a.subscriber_count ?? 0)).slice(0, 6),
        );

        // Load timing data to extract speaker IDs (same approach as home page)
        const timingEntries = await Promise.all(
          loadedClips.map(async (clip) => {
            if (!clip.timingUrl) return { id: clip.id, lines: [] as TimingLine[] };
            try {
              const res = await fetch(clip.timingUrl);
              if (!res.ok) return { id: clip.id, lines: [] as TimingLine[] };
              const payload = (await res.json()) as
                | TimingLine[]
                | { lines?: TimingLine[]; [k: string]: unknown };
              let lines: TimingLine[];
              if (Array.isArray(payload)) {
                lines = payload;
              } else if (Array.isArray((payload as { lines?: TimingLine[] }).lines)) {
                lines = (payload as { lines: TimingLine[] }).lines;
              } else {
                lines = [];
              }
              return { id: clip.id, lines };
            } catch {
              return { id: clip.id, lines: [] as TimingLine[] };
            }
          }),
        );
        if (!cancelled) {
          const timings: Record<string, TimingLine[]> = {};
          for (const e of timingEntries) timings[e.id] = e.lines;
          setClipTimings(timings);
        }
      } catch {
        // Silently fail — section will just not show
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <section className="px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="text-center">
            <div className="mx-auto h-8 w-48 animate-pulse rounded-lg bg-white/5" />
            <div className="mx-auto mt-3 h-4 w-64 animate-pulse rounded bg-white/5" />
          </div>
          <div className="mt-14 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl bg-white/5" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (clips.length === 0 && topAgents.length === 0) return null;

  return (
    <section className="relative px-6 py-24">
      <div className="pointer-events-none absolute -left-40 top-1/2 h-[400px] w-[400px] rounded-full bg-teal-500/8 blur-[120px]" />
      <div className="mx-auto max-w-6xl">
        {/* Trending Clips */}
        {clips.length > 0 && (
          <>
            <FadeInOnScroll className="text-center">
              <h2
                className="text-3xl font-bold tracking-tight text-white sm:text-4xl"
                style={{ fontFamily: "var(--font-space-grotesk)" }}
              >
                {t("trendingTitle")}
              </h2>
              <p className="mt-3 text-zinc-400">{t("trendingSubtitle")}</p>
            </FadeInOnScroll>

            <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {clips.map((clip, i) => (
                <FadeInOnScroll key={clip.id} delay={i * 0.05}>
                  <TrendingClipCard clip={clip} speakerIds={getClipSpeakers(clip.id).slice(0, 2)} agentsById={agentsById} untitledLabel={t("untitledClip")} />
                </FadeInOnScroll>
              ))}
            </div>
          </>
        )}

        {/* Popular Agents */}
        {topAgents.length > 0 && (
          <div className={clips.length > 0 ? "mt-20" : ""}>
            <FadeInOnScroll className="text-center">
              <h2
                className="text-3xl font-bold tracking-tight text-white sm:text-4xl"
                style={{ fontFamily: "var(--font-space-grotesk)" }}
              >
                {t("popularAgentsTitle")}
              </h2>
              <p className="mt-3 text-zinc-400">{t("popularAgentsSubtitle")}</p>
            </FadeInOnScroll>

            <div className="mt-14 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {topAgents.map((agent, i) => (
                <FadeInOnScroll key={agent.id} delay={i * 0.05}>
                  <Link
                    href={`/agents/${agent.id}`}
                    className="group relative block overflow-hidden rounded-2xl border border-white/10 hover:border-emerald-400/40 transition-all"
                    style={{ aspectRatio: "3/4" }}
                  >
                    {agent.image_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={agent.image_url}
                        alt={agent.name}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-emerald-900/60 to-zinc-900 text-4xl font-bold text-white/30">
                        {agent.name.charAt(0)}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-4">
                      <h3 className="text-sm font-bold text-white line-clamp-1">{agent.name}</h3>
                      {(agent.intro_line || agent.personality) ? (
                        <p className="mt-1 text-[11px] leading-relaxed text-zinc-300 line-clamp-2">
                          {agent.intro_line || agent.personality}
                        </p>
                      ) : null}
                      {(agent.subscriber_count ?? 0) > 0 && (
                        <p className="mt-1.5 text-[10px] text-zinc-400">
                          {t("subscriberCount", { count: agent.subscriber_count ?? 0 })}
                        </p>
                      )}
                    </div>
                  </Link>
                </FadeInOnScroll>
              ))}
            </div>

            <FadeInOnScroll delay={0.3} className="mt-8 text-center">
              <Link
                href="/agents"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-sm font-medium text-zinc-200 backdrop-blur-xl transition-all hover:border-emerald-400/30 hover:text-white"
              >
                {t("viewAllAgents")}
                <span className="text-emerald-400">→</span>
              </Link>
            </FadeInOnScroll>
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Trending clip card with agent-color gradient background ── */

function TrendingClipCard({ clip, speakerIds, agentsById, untitledLabel }: { clip: ClipPayload; speakerIds: string[]; agentsById: Map<string, Agent>; untitledLabel: string }) {
  const agent1 = speakerIds[0] ? agentsById.get(speakerIds[0]) : undefined;
  const agent2 = speakerIds[1] ? agentsById.get(speakerIds[1]) : undefined;
  const stored1 = agent1?.dominant_color ? applyColorTransform(agent1.dominant_color, VIVID_COLOR_OPTS) : null;
  const stored2 = agent2?.dominant_color ? applyColorTransform(agent2.dominant_color, VIVID_COLOR_OPTS) : null;
  const img1 = stored1 ? undefined : (speakerIds[0] ? getAgentImageUrl(speakerIds[0], agentsById) : undefined);
  const img2 = stored2 ? undefined : (speakerIds[1] ? getAgentImageUrl(speakerIds[1], agentsById) : undefined);
  const extracted1 = useDominantColor(img1, VIVID_COLOR_OPTS);
  const extracted2 = useDominantColor(img2, VIVID_COLOR_OPTS);
  const color1 = stored1 ?? extracted1;
  const color2 = stored2 ?? extracted2;
  const ready = color1 !== null || color2 !== null;
  const [c1, c2] = ensureContrast(color1 ?? fallbackColor(clip.id), color2 ?? fallbackColor(clip.id + "x"));

  return (
    <Link
      href={`/clips/${clip.id}`}
      className="relative overflow-hidden rounded-3xl clip-card flex flex-col p-5 min-h-[14rem]"
      style={{ background: "rgba(255,255,255,0.93)" }}
    >
      <div
        style={{
          position: "absolute", inset: 0, borderRadius: "inherit",
          background: `linear-gradient(135deg, rgba(${c1}, 0.8), rgba(${c2}, 0.8))`,
          opacity: ready ? 1 : 0,
          transition: "opacity 0.6s ease",
        }}
      />
      <div className="relative z-10 flex flex-col flex-1">
        <div className="text-lg font-extrabold clip-card-text line-clamp-2 min-h-[3.5rem]">
          {clip.title || untitledLabel}
        </div>
        <div className="mt-1.5 text-xs font-semibold clip-card-muted truncate">
          {speakerIds.map((sid) => agentsById.get(sid)?.name ?? sid).join(" & ")}
        </div>
        <div className="flex-1" />
        <div className="mt-auto flex items-end justify-end gap-2">
          {speakerIds.map((sid) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={sid}
              className="h-20 w-20 sm:h-24 sm:w-24 rounded-xl object-cover ring-1 ring-zinc-300/80 shadow-sm"
              src={getAgentImageUrl(sid, agentsById)}
              alt={agentsById.get(sid)?.name ?? sid}
              loading="lazy"
            />
          ))}
        </div>
      </div>
    </Link>
  );
}

"use client";

/* eslint-disable @next/next/no-img-element */

import { useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Agent } from "@/types/agent";
import { useAgentSearch } from "@/hooks/useAgentSearch";

type AgentTab = "my" | "subscribed" | "community";

type Variant = "emerald" | "purple";

type AgentSelectorPanelProps = {
  label: string;
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  myAgents: Agent[];
  subscribedAgents: Agent[];
  communityAgents: Agent[];
  selectedAgent: Agent | null;
  variant?: Variant;
};

// 전역 오디오 — 한 번에 하나만 재생
let globalAudio: HTMLAudioElement | null = null;
let globalAudioCleanup: (() => void) | null = null;

const variantStyles = {
  emerald: {
    listSelected: "bg-emerald-50 border-emerald-500 border-l-2",
    listHover: "bg-white/70 border-white/40 hover:bg-emerald-50/50",
    imgBorder: "border-emerald-200",
    imgFallbackBg: "bg-emerald-100 border-emerald-200",
    tabActive: { background: "linear-gradient(135deg, #A4F4CF, #7CEDA3)", color: "#006949" },
    inputFocus: "focus:ring-[#00BC7D]/50 focus:border-[#00BC7D]",
    selectedBox: "border-emerald-500 bg-emerald-50",
    linkColor: "text-emerald-600",
    detailLabel: "text-emerald-700",
    chevronColor: "text-emerald-500",
    scrollClass: "soft-scroll",
  },
  purple: {
    listSelected: "bg-purple-500/15 border-purple-500 border-l-2",
    listHover: "bg-white/70 border-white/40 hover:bg-purple-500/10",
    imgBorder: "border-purple-200",
    imgFallbackBg: "bg-purple-100 border-purple-200",
    tabActive: { background: "linear-gradient(135deg, #C4B5FD, #A78BFA)", color: "#3B0764" },
    inputFocus: "focus:ring-purple-500/50 focus:border-purple-500",
    selectedBox: "border-purple-500 bg-purple-500/10",
    linkColor: "text-purple-600",
    detailLabel: "text-purple-700",
    chevronColor: "text-purple-500",
    scrollClass: "soft-scroll-purple",
  },
};

function AgentListItem({
  agent,
  isSelected,
  onClick,
  showIntroLine,
  variant = "emerald",
}: {
  agent: Agent;
  isSelected: boolean;
  onClick: () => void;
  showIntroLine?: boolean;
  variant?: Variant;
}) {
  const v = variantStyles[variant];
  const t = useTranslations("agentSelector");
  const [playing, setPlaying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showImage, setShowImage] = useState(false);

  const handlePlayIntro = (e: React.MouseEvent) => {
    e.stopPropagation();
    // 현재 이 항목이 재생 중이면 정지
    if (playing && globalAudio) {
      globalAudio.pause();
      globalAudio.currentTime = 0;
      globalAudio = null;
      globalAudioCleanup = null;
      setPlaying(false);
      return;
    }
    // 다른 항목이 재생 중이면 먼저 정지
    if (globalAudio) {
      globalAudio.pause();
      globalAudio.currentTime = 0;
      globalAudioCleanup?.();
      globalAudio = null;
      globalAudioCleanup = null;
    }
    if (agent.intro_mp3_url) {
      const audio = new Audio(agent.intro_mp3_url);
      const cleanup = () => setPlaying(false);
      audio.onended = () => { globalAudio = null; globalAudioCleanup = null; cleanup(); };
      audio.play().catch(() => {});
      globalAudio = audio;
      globalAudioCleanup = cleanup;
      setPlaying(true);
    }
  };

  const hasDetails = !!(agent.intro_line || agent.concept || agent.personality || agent.speaking_style);

  return (
    <div
      className={`w-full text-left rounded-xl transition border overflow-hidden ${
        isSelected ? v.listSelected : v.listHover
      }`}
    >
      {/* Collapsed row — always visible */}
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
        className="w-full text-left px-4 py-2 cursor-pointer"
      >
        <div className="flex items-center gap-3">
          {agent.image_url ? (
            <div
              className="shrink-0 cursor-pointer"
              onClick={(e) => { e.stopPropagation(); setShowImage(true); }}
              role="button"
              tabIndex={0}
            >
              <img src={agent.image_url} alt={agent.name} className={`w-10 h-10 rounded-full object-cover border hover:brightness-110 transition ${v.imgBorder}`} />
            </div>
          ) : (
            <div className={`w-10 h-10 rounded-full shrink-0 ${v.imgFallbackBg}`} />
          )}
          <div className="min-w-0 flex-1">
            <div className={`text-base font-semibold ${isSelected ? "text-white" : "text-gray-800"}`}>{agent.name}</div>
            {!isSelected && (
              <div className="text-sm mt-0.5 line-clamp-1 text-gray-500">
                {showIntroLine
                  ? agent.intro_line?.trim() || (agent.personality ?? "").slice(0, 120)
                  : (agent.personality ?? "").slice(0, 120)}
              </div>
            )}
          </div>
          {/* Play intro — 아이콘만 */}
          {agent.intro_mp3_url && (
            <button
              type="button"
              onClick={handlePlayIntro}
              className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-gray-500 hover:text-gray-800 hover:bg-white/40 transition"
              aria-label={playing ? "Stop" : "Play intro"}
            >
              {playing ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="5" width="4" height="14" rx="1" />
                  <rect x="14" y="5" width="4" height="14" rx="1" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* 선택 시 — 모든 정보를 높이 제한으로 표시, expanded 시 전체 */}
      {isSelected && hasDetails && (
        <div className="px-4 pb-3">
          <div className="border-t border-white/20 pt-2.5" />
          <div className="relative">
            <div
              className={`space-y-1.5 text-xs text-gray-600 overflow-hidden transition-all ${expanded ? "" : "max-h-20"}`}
            >
              {agent.intro_line && (
                <p className="text-sm italic text-gray-500">&ldquo;{agent.intro_line.trim()}&rdquo;</p>
              )}
              {agent.concept && (
                <p><span className={`font-medium ${v.detailLabel}`}>{t("concept")}</span> {agent.concept}</p>
              )}
              {agent.personality && (
                <p><span className={`font-medium ${v.detailLabel}`}>{t("personality")}</span> {agent.personality}</p>
              )}
              {agent.speaking_style && (
                <p><span className={`font-medium ${v.detailLabel}`}>{t("speakingStyle")}</span> {agent.speaking_style}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
            className={`inline-flex items-center gap-1 text-xs font-medium ${v.detailLabel} hover:underline transition mt-1.5`}
          >
            {expanded ? t("less") : t("viewMore")}
            <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      )}

      {/* Image lightbox */}
      {showImage && agent.image_url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowImage(false)}
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <img
              src={agent.image_url}
              alt={agent.name}
              className="max-w-[80vw] max-h-[80vh] rounded-2xl object-contain shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setShowImage(false)}
              className="absolute -top-3 -right-3 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <div className="absolute bottom-0 left-0 right-0 bg-black/50 rounded-b-2xl px-4 py-2 text-center">
              <span className="text-sm font-semibold text-white">{agent.name}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentSelectorPanel({
  label,
  selectedAgentId,
  onSelectAgent,
  myAgents,
  subscribedAgents,
  communityAgents,
  selectedAgent,
  variant = "emerald",
}: AgentSelectorPanelProps) {
  const t = useTranslations("agentSelector");
  const [activeTab, setActiveTab] = useState<AgentTab>("community");
  const [mySearch, setMySearch] = useState("");
  const [subscribedSearch, setSubscribedSearch] = useState("");
  const [communitySearch, setCommunitySearch] = useState("");

  const filteredMy = useAgentSearch(myAgents, mySearch);
  const filteredSubscribed = useAgentSearch(subscribedAgents, subscribedSearch);
  const filteredCommunity = useAgentSearch(communityAgents, communitySearch);

  const v = variantStyles[variant];

  return (
    <div className="rounded-2xl backdrop-blur-xl bg-white/70 border border-white/40 shadow-xl p-6">
      <h2 className="text-2xl font-bold text-gray-800">{label}</h2>
      <div className="mt-5 space-y-4">
        {/* Tab switcher */}
        <div className="flex items-center gap-1 rounded-xl border border-zinc-700/50 bg-zinc-900/60 p-1">
          {(["community", "subscribed", "my"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab ? "" : "text-gray-400 hover:text-gray-200"
              }`}
              style={activeTab === tab ? v.tabActive : {}}
            >
              {tab === "my" ? t("tabMy") : tab === "subscribed" ? t("tabSubscribed") : t("tabCommunity")}
            </button>
          ))}
        </div>

        {/* My agents */}
        {activeTab === "my" ? (
          <div>
            <input
              type="text"
              className={`w-full h-10 rounded-xl backdrop-blur-xl bg-white/50 border border-white/40 px-3 text-sm outline-none focus:ring-2 focus:border-2 text-gray-800 placeholder:text-gray-400 ${v.inputFocus}`}
              value={mySearch}
              onChange={(e) => setMySearch(e.target.value)}
              placeholder={t("searchMy")}
            />
            <div className="mt-3 rounded-xl border border-white/40 overflow-hidden bg-white/50">
              <div className={`max-h-72 overflow-y-auto space-y-2 p-3 pr-1 ${v.scrollClass}`}>
                {filteredMy.map((a) => (
                  <AgentListItem
                    key={a.id}
                    agent={a}
                    isSelected={selectedAgentId === a.id}
                    onClick={() => onSelectAgent(a.id)}
                    showIntroLine
                    variant={variant}
                  />
                ))}
                {myAgents.length === 0 ? (
                  <div className="text-sm text-gray-500">{t("noAgentsYet")}</div>
                ) : filteredMy.length === 0 ? (
                  <div className="text-sm text-gray-500">{t("noMatchingAgents")}</div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* Subscribed agents */}
        {activeTab === "subscribed" ? (
          <div>
            <input
              type="text"
              className={`w-full h-10 rounded-xl backdrop-blur-xl bg-white/50 border border-white/40 px-3 text-sm outline-none focus:ring-2 focus:border-2 text-gray-800 placeholder:text-gray-400 ${v.inputFocus}`}
              value={subscribedSearch}
              onChange={(e) => setSubscribedSearch(e.target.value)}
              placeholder={t("searchSubscribed")}
            />
            <div className="mt-3 rounded-xl border border-white/40 overflow-hidden bg-white/50">
              <div className={`max-h-72 overflow-y-auto space-y-2 p-3 pr-1 ${v.scrollClass}`}>
                {filteredSubscribed.map((a) => (
                  <AgentListItem
                    key={a.id}
                    agent={a}
                    isSelected={selectedAgentId === a.id}
                    onClick={() => onSelectAgent(a.id)}
                    variant={variant}
                  />
                ))}
                {subscribedAgents.length === 0 ? (
                  <div className="text-sm text-gray-500">{t.rich("noSubscribedYet", { link: (chunks) => <Link href="/agents" className={`${v.linkColor} hover:underline`}>{chunks}</Link> })}</div>
                ) : filteredSubscribed.length === 0 ? (
                  <div className="text-sm text-gray-500">{t("noMatchingAgents")}</div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* Community agents */}
        {activeTab === "community" ? (
          <div>
            <input
              type="text"
              className={`w-full h-10 rounded-xl backdrop-blur-xl bg-white/50 border border-white/40 px-3 text-sm outline-none focus:ring-2 focus:border-2 text-gray-800 placeholder:text-gray-400 ${v.inputFocus}`}
              value={communitySearch}
              onChange={(e) => setCommunitySearch(e.target.value)}
              placeholder={t("searchCommunity")}
            />
            <div className="mt-3 rounded-xl border border-white/40 overflow-hidden bg-white/50">
              <div className={`max-h-72 overflow-y-auto space-y-2 p-3 pr-1 ${v.scrollClass}`}>
                {filteredCommunity.map((a) => (
                  <AgentListItem
                    key={a.id}
                    agent={a}
                    isSelected={selectedAgentId === a.id}
                    onClick={() => onSelectAgent(a.id)}
                    showIntroLine
                    variant={variant}
                  />
                ))}
                {communityAgents.length === 0 ? (
                  <div className="text-sm text-gray-500">{t("noCommunityYet")}</div>
                ) : filteredCommunity.length === 0 ? (
                  <div className="text-sm text-gray-500">{t("noMatchingAgents")}</div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* Selected Agent — highlighted confirmation */}
        {selectedAgent && (
          <div className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 ${v.selectedBox}`}>
            {selectedAgent.image_url ? (
              <img src={selectedAgent.image_url} alt={selectedAgent.name} className={`w-10 h-10 rounded-full object-cover border-2 shrink-0 ${v.imgBorder}`} />
            ) : (
              <div className={`w-10 h-10 rounded-full shrink-0 ${v.imgFallbackBg}`} />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-gray-800 truncate">{selectedAgent.name}</div>
              {selectedAgent.concept && (
                <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">{selectedAgent.concept}</div>
              )}
            </div>
            <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${variant === "purple" ? "bg-purple-500" : "bg-emerald-500"}`}>
              <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useLayoutEffect, useState, useRef, useMemo } from "react";
import type { TimingLine } from "@/types/clip";

type SubtitlesProps = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  timingLines: TimingLine[];
  agentNames?: Record<string, string>;
  speakerColor?: string;
};

const MAX_CHUNK_WORDS = 7;

/** Split a sentence into readable chunks by punctuation or word count. */
function splitIntoChunks(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= MAX_CHUNK_WORDS) return [text];

  const chunks: string[] = [];
  let buf: string[] = [];

  for (const word of words) {
    buf.push(word);
    // Break after punctuation at end of word, or when buffer is full
    const endsWithPunct = /[,;.!?]$/.test(word);
    if (endsWithPunct || buf.length >= MAX_CHUNK_WORDS) {
      chunks.push(buf.join(" "));
      buf = [];
    }
  }
  if (buf.length > 0) {
    chunks.push(buf.join(" "));
  }

  return chunks.length > 0 ? chunks : [text];
}

const BOUNDARY_EPS = 0.05;

export function Subtitles({ audioRef, timingLines, agentNames, speakerColor }: SubtitlesProps) {
  const [currentLine, setCurrentLine] = useState<TimingLine | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const rafRef = useRef<number | null>(null);
  const linesRef = useRef<TimingLine[]>([]);
  linesRef.current = timingLines ?? [];

  // ref가 나중에 붙어도 구독 재실행 (마운트 시 audioRef.current가 null이면 effect가 안 돌아가는 문제 방지)
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(() => audioRef.current);
  useLayoutEffect(() => {
    const next = audioRef.current;
    setAudioEl((prev) => (prev !== next ? next : prev));
  });
  useEffect(() => {
    if (audioEl != null || (timingLines?.length ?? 0) === 0) return;
    const id = setInterval(() => {
      const next = audioRef.current;
      if (next) {
        setAudioEl(next);
      }
    }, 80);
    return () => clearInterval(id);
  }, [audioEl, audioRef, timingLines?.length]);

  // timing 데이터 로드 시 즉시 자막 갱신 (remount 직후 play 이벤트를 놓친 경우 대비)
  useEffect(() => {
    if (!audioEl || (timingLines?.length ?? 0) === 0) return;
    audioEl.dispatchEvent(new Event("timeupdate"));
  }, [audioEl, timingLines]);

  useEffect(() => {
    const audio = audioEl;
    const lines = timingLines ?? [];
    if (!audio || lines.length === 0) {
      setCurrentLine(null);
      setCurrentTime(0);
      return;
    }

    const update = () => {
      const latest = linesRef.current;
      if (latest.length === 0) return;
      const t = audio.currentTime;
      setCurrentTime(t);
      const start = (l: TimingLine) => Number(l?.start);
      const end = (l: TimingLine) => Number(l?.end);
      // start 기준 오름차순 정렬 후, "이미 시작한 줄 중 가장 늦게 시작한 줄" 하나만 선택 → 첫 자막에서 멈춤 방지
      const sorted = [...latest].filter((l) => Number.isFinite(start(l))).sort((a, b) => start(a) - start(b));
      let line: TimingLine | null = null;
      for (let i = sorted.length - 1; i >= 0; i--) {
        const l = sorted[i]!;
        if (t >= start(l) - BOUNDARY_EPS) {
          line = l;
          break;
        }
      }
      setCurrentLine(line);
    };

    const loop = () => {
      update();
      rafRef.current = requestAnimationFrame(loop);
    };

    let intervalId: ReturnType<typeof setInterval> | null = null;
    const startDrivers = () => {
      update();
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(loop);
      if (intervalId == null) {
        intervalId = setInterval(update, 100);
      }
    };
    const stopDrivers = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (intervalId != null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const onPlay = () => {
      startDrivers();
    };
    const onPause = () => {
      stopDrivers();
      update();
    };
    const onEnded = () => {
      setCurrentLine(null);
      setCurrentTime(0);
      stopDrivers();
    };

    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", update);

    // Start drivers immediately if audio is already playing
    if (!audio.paused) startDrivers();

    // Fallback: re-check after a short delay in case play event was missed
    const fallbackTimer = setTimeout(() => {
      if (!audio.paused && rafRef.current == null) startDrivers();
    }, 150);

    return () => {
      clearTimeout(fallbackTimer);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", update);
      stopDrivers();
    };
  }, [audioEl, timingLines]);

  const chunks = useMemo(() => {
    if (!currentLine?.text) return [];
    return splitIntoChunks(currentLine.text);
  }, [currentLine]);

  if (!currentLine?.text) return null;

  const isSfx = currentLine.type === "sfx" || currentLine.speaker === "sfx";
  const lineStart = Number(currentLine.start ?? 0);
  const lineEnd = Number(currentLine.end ?? 0);
  const lineDuration = lineEnd - lineStart;
  const elapsed = currentTime - lineStart;

  // Current chunk index based on time
  const chunkIndex = lineDuration > 0 && chunks.length > 1
    ? Math.min(chunks.length - 1, Math.floor((elapsed / lineDuration) * chunks.length))
    : 0;

  const displayText = isSfx ? currentLine.text : (chunks[chunkIndex] ?? currentLine.text);

  return (
    <div className="mb-4 rounded-2xl bg-black/70 px-5 py-3 text-center min-h-[3.5rem] flex items-center justify-center">
      {isSfx ? (
        <span className="font-noto-sans italic text-amber-300 text-2xl leading-relaxed">
          {displayText}
        </span>
      ) : (
        <span
          key={`${lineStart}-${chunkIndex}`}
          className="font-noto-sans text-2xl leading-relaxed animate-fade-in"
          style={{ color: speakerColor ?? "#ffffff" }}
        >
          {displayText}
        </span>
      )}
    </div>
  );
}

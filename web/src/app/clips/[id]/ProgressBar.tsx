"use client";

import { useCallback } from "react";

type ProgressBarProps = {
  progress: number;
  onSeek: (percent: number) => void;
  onSeekStart?: () => void;
  onSeekEnd?: () => void;
};

export function ProgressBar({ progress, onSeek, onSeekStart, onSeekEnd }: ProgressBarProps) {
  const seekFromEvent = useCallback(
    (bar: HTMLElement, clientX: number) => {
      const rect = bar.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      onSeek(ratio * 100);
    },
    [onSeek]
  );

  return (
    <div
      role="slider"
      aria-label="Audio progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
      className="group relative block w-full h-3 cursor-pointer bg-black touch-none"
      onPointerDown={(e) => {
        e.stopPropagation();
        e.preventDefault();
        const bar = e.currentTarget;
        bar.setPointerCapture(e.pointerId);
        onSeekStart?.();

        seekFromEvent(bar, e.clientX);

        const onMove = (ev: PointerEvent) => {
          ev.preventDefault();
          seekFromEvent(bar, ev.clientX);
        };
        const onUp = (ev: PointerEvent) => {
          bar.releasePointerCapture(ev.pointerId);
          bar.removeEventListener("pointermove", onMove);
          bar.removeEventListener("pointerup", onUp);
          onSeekEnd?.();
        };
        bar.addEventListener("pointermove", onMove);
        bar.addEventListener("pointerup", onUp);
      }}
    >
      <div
        className="h-full bg-emerald-500 transition-none"
        style={{ width: `${progress}%` }}
      >
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-4 w-4 rounded-full bg-white shadow opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: `${progress}%` }}
        />
      </div>
    </div>
  );
}
